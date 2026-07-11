import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { validateTransition } from './stateMachine';
import { writeAuditLog } from './auditLog';
import {
  planNext,
  type PlanContext,
} from './agents/planner';
import { dispatchWorker } from './agents/workers';
import type {
  WorkerContext,
  WorkerResult,
} from './agents/workers/types';
import { TelegramConnector } from './connectors/telegramConnector';
import { checkPrerequisites } from './validation/prerequisiteGuard';

function toJsonValue(
  value: unknown
): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function getExtractedFields(
  value: unknown
): Record<string, unknown> {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    return {
      ...(value as Record<string, unknown>),
    };
  }

  return {};
}

export async function runAgentLoop(
  workflowId: string,
  triggerSource: string
): Promise<void> {
  const telegramConnector = new TelegramConnector();

  let executionId: string | null = null;

  try {
    const workflow = await prisma.workflow.findUnique({
      where: {
        id: workflowId,
      },
      include: {
        vendor: true,
      },
    });

    if (!workflow) {
      throw new Error(
        `Workflow ${workflowId} not found`
      );
    }

    /*
     * COMPLETED is a terminal state.
     *
     * Never invoke the planner or workers again.
     */
    if (workflow.state === 'COMPLETED') {
      console.log(
        '[runAgentLoop] Workflow already completed'
      );

      if (workflow.chatId) {
        await telegramConnector.execute({
          operation: 'sendMessage',
          payload: {
            chatId: workflow.chatId,
            text:
              '✅ Your onboarding is already complete. No further action is required.',
          },
        });
      }

      return;
    }

    console.log(
      '[runAgentLoop] loaded workflow',
      workflowId,
      'state:',
      workflow.state,
      'trigger:',
      triggerSource
    );

    /*
     * Structural human approval gate.
     *
     * Telegram/user messages cannot restart planning while
     * approval is pending.
     */
    if (
      workflow.state === 'PENDING_APPROVAL' &&
      triggerSource !== 'approval_decided'
    ) {
      console.log(
        '[runAgentLoop] BLOCKED — workflow is PENDING_APPROVAL'
      );

      await writeAuditLog({
        workflowId,
        actor: 'system',
        action: 'blocked_pending_approval',
        fromState: 'PENDING_APPROVAL',
        toState: 'PENDING_APPROVAL',
      });

      if (workflow.chatId) {
        await telegramConnector.execute({
          operation: 'sendMessage',
          payload: {
            chatId: workflow.chatId,
            text:
              "Your onboarding packet is under review. You don't need to do anything — I'll message you here when there's an update.",
          },
        });
      }

      return;
    }

    const messages = await prisma.message.findMany({
      where: {
        workflowId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 10,
    });

    const documents = await prisma.document.findMany({
      where: {
        workflowId,
      },
      orderBy: {
        uploadedAt: 'desc',
      },
    });

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        workflowId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 10,
    });

    const context: PlanContext = {
      workflow: {
        id: workflow.id,
        state: workflow.state,
        currentStep: workflow.currentStep,
        vendorId: workflow.vendorId,
      },

      vendor: {
        id: workflow.vendor.id,
        legalName: workflow.vendor.legalName,
        contactEmail:
          workflow.vendor.contactEmail,
        status: workflow.vendor.status,
      },

      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      })),

      auditLogs: auditLogs.map((auditLog) => ({
        id: auditLog.id,
        actor: auditLog.actor,
        action: auditLog.action,
        fromState:
          auditLog.fromState ?? undefined,
        toState: auditLog.toState ?? undefined,
        createdAt: auditLog.createdAt,
      })),
    };

    const execution = await prisma.execution.create({
      data: {
        workflowId,
        triggerSource,
        status: 'running',
        startedAt: new Date(),
      },
    });

    executionId = execution.id;

    console.log(
      '[runAgentLoop] calling planner with state:',
      context.workflow.state
    );

    const planResult = await planNext(context);

    const plan =
      'plan' in planResult
        ? planResult.plan
        : planResult;

    const tokensUsed =
      'tokensUsed' in planResult &&
      typeof planResult.tokensUsed === 'number'
        ? planResult.tokensUsed
        : 0;

    console.log(
      '[runAgentLoop] plan received:',
      JSON.stringify(plan)
    );

    await prisma.agentRun.create({
      data: {
        executionId: execution.id,
        agentName: 'planner',
        input: toJsonValue(context),
        output: toJsonValue({
          ...plan,
          promptVersion: 'v1',
        }),
        tokens: tokensUsed,
      },
    });

    const workerContext: WorkerContext = {
      workflowId: workflow.id,

      vendor: {
        id: workflow.vendor.id,
        legalName: workflow.vendor.legalName,
        contactEmail:
          workflow.vendor.contactEmail,
        status: workflow.vendor.status,
      },

      messages: context.messages,

      documents: documents.map((document) => ({
        id: document.id,
        type: document.type,
        category: document.category,
        originalFilename:
          document.originalFilename,
        fileSize: document.fileSize,
        mime: document.mime,
        storageUrl: document.storageUrl,
        validationStatus:
          document.validationStatus,
        verified: document.verified,
        extractedFields:
          document.extractedFields,
        confidence: document.confidence,
      })),

      plan: {
        nextWorker: plan.nextWorker,
        targetState: plan.targetState,
        reasoningSummary:
          plan.reasoningSummary,
      },

      extractedFields: getExtractedFields(
        workflow.extractedFields
      ),
    };

    console.log(
      '[runAgentLoop] dispatching worker:',
      plan.nextWorker
    );

    let workerResult: WorkerResult;
    let workerException = false;

    if (plan.nextWorker === 'erp_agent') {
      const approved = await prisma.approval.findFirst({
        where: {
          workflowId: workflow.id,
          decision: 'APPROVED',
        },
      });

      if (!approved) {
        throw new Error('Illegal transition: Cannot execute ERP worker without an APPROVED human decision.');
      }
    }

    try {
      workerResult = await dispatchWorker(
        plan.nextWorker,
        workerContext
      );

      console.log(
        '[runAgentLoop] worker result:',
        JSON.stringify(workerResult)
      );
    } catch (workerError) {
      workerException = true;

      console.error(
        '[runAgentLoop] worker exception:',
        workerError
      );

      workerResult = {
        success: false,
        validationPassed: false,
        retryable: true,
        error:
          workerError instanceof Error
            ? workerError.message
            : String(workerError),
      };
    }

    await prisma.agentRun.create({
      data: {
        executionId: execution.id,
        agentName: plan.nextWorker,
        status: workerResult.success
          ? 'done'
          : 'failed',
        input: toJsonValue(workerContext),
        output: toJsonValue(workerResult),
        tokens: 0,
      },
    });

    /*
     * TECHNICAL FAILURE GATE
     */
    if (!workerResult.success) {
      await writeAuditLog({
        workflowId,
        actor: 'system',
        action: 'transition_blocked_by_worker',
        fromState: workflow.state,
        toState: workflow.state,
        metadata: {
          attemptedTargetState:
            plan.targetState,
          worker: plan.nextWorker,
          error: workerResult.error,
          retryable: workerResult.retryable,
          workerException,
        },
      });

      if (
        workerResult.outboundMessage &&
        workflow.chatId
      ) {
        await telegramConnector.execute({
          operation: 'sendMessage',
          payload: {
            chatId: workflow.chatId,
            text: workerResult.outboundMessage,
          },
        });
      }

      await prisma.execution.update({
        where: {
          id: execution.id,
        },
        data: {
          status: 'failed',
          endedAt: new Date(),
          errorMessage:
            workerResult.error ??
            'Worker execution failed.',
        },
      });

      return;
    }

    /*
     * BUSINESS VALIDATION GATE
     *
     * A worker executing normally does NOT mean the
     * onboarding requirement passed.
     */
    if (!workerResult.validationPassed) {
      await writeAuditLog({
        workflowId,
        actor: 'system',
        action:
          'transition_blocked_by_validation',
        fromState: workflow.state,
        toState: workflow.state,
        metadata: {
          attemptedTargetState:
            plan.targetState,
          worker: plan.nextWorker,
          confidence: workerResult.confidence,
          retryable: workerResult.retryable,
          validationError:
            workerResult.error,
        },
      });

      if (
        workerResult.outboundMessage &&
        workflow.chatId
      ) {
        console.log(
          '[runAgentLoop] sending validation correction'
        );

        await telegramConnector.execute({
          operation: 'sendMessage',
          payload: {
            chatId: workflow.chatId,
            text: workerResult.outboundMessage,
          },
        });
      }

      await prisma.execution.update({
        where: {
          id: execution.id,
        },
        data: {
          status: 'done',
          endedAt: new Date(),
        },
      });

      console.log(
        '[runAgentLoop] validation failed; workflow remains in',
        workflow.state
      );

      return;
    }

    /*
     * Only validated worker output reaches this point.
     */
    const mergedExtractedFields = {
      ...getExtractedFields(
        workflow.extractedFields
      ),
      ...(workerResult.extractedData ?? {}),
    };

    /*
     * Legal transition topology gate.
     */
    let transitionIsLegal =
      plan.targetState === workflow.state;

    if (!transitionIsLegal) {
      try {
        validateTransition(
          workflow.state,
          plan.targetState
        );

        transitionIsLegal = true;
      } catch (transitionError) {
        console.error(
          '[runAgentLoop] illegal planner transition:',
          transitionError
        );

        await writeAuditLog({
          workflowId,
          actor: 'system',
          action:
            'planner_proposed_illegal_transition',
          fromState: workflow.state,
          toState: workflow.state,
          metadata: {
            attemptedTargetState:
              plan.targetState,
            nextWorker: plan.nextWorker,
            reasoning:
              plan.reasoningSummary,
            error:
              transitionError instanceof Error
                ? transitionError.message
                : String(transitionError),
          },
        });
      }
    }

    /*
     * Re-fetch documents AFTER the worker.
     *
     * GST/bank workers may have changed:
     * - verified
     * - validationStatus
     * - category
     * - extractedFields
     */
    const refreshedDocuments =
      await prisma.document.findMany({
        where: {
          workflowId,
        },
        orderBy: {
          uploadedAt: 'desc',
        },
      });

    let prerequisitesPassed = true;
    let prerequisiteReason: string | undefined;

    if (
      transitionIsLegal &&
      plan.targetState !== workflow.state
    ) {
      const prerequisiteCheck = checkPrerequisites(
        plan.targetState,
        mergedExtractedFields,
        refreshedDocuments.map((document) => ({
          id: document.id,
          category: document.category,
          verified: document.verified,
        }))
      );

      prerequisitesPassed =
        prerequisiteCheck.passed;

      prerequisiteReason =
        prerequisiteCheck.reason;

      if (!prerequisitesPassed) {
        console.error(
          '[runAgentLoop] prerequisite blocked transition:',
          prerequisiteReason
        );

        await writeAuditLog({
          workflowId,
          actor: 'system',
          action:
            'transition_blocked_by_prerequisites',
          fromState: workflow.state,
          toState: workflow.state,
          metadata: {
            attemptedTargetState:
              plan.targetState,
            reason: prerequisiteReason,
            nextWorker: plan.nextWorker,
            reasoning:
              plan.reasoningSummary,
          },
        });
      }
    }

    const mayTransition =
      transitionIsLegal && prerequisitesPassed;

    const finalState = mayTransition
      ? plan.targetState
      : workflow.state;

    await prisma.workflow.update({
      where: {
        id: workflowId,
      },
      data: {
        state: finalState,
        extractedFields: toJsonValue(
          mergedExtractedFields
        ),
      },
    });

    if (
      mayTransition &&
      plan.targetState !== workflow.state
    ) {
      await writeAuditLog({
        workflowId,
        actor: 'system',
        action: 'state_transition',
        fromState: workflow.state,
        toState: plan.targetState,
        metadata: {
          triggerSource,
          reasoning: plan.reasoningSummary,
          nextWorker: plan.nextWorker,
        },
      });
    }

    if (
      workerResult.outboundMessage &&
      workflow.chatId
    ) {
      await telegramConnector.execute({
        operation: 'sendMessage',
        payload: {
          chatId: workflow.chatId,
          text: workerResult.outboundMessage,
        },
      });
    }

    /*
     * Create approval only when the transition to
     * PENDING_APPROVAL actually occurred.
     */
    if (
      mayTransition &&
      plan.targetState ===
        'PENDING_APPROVAL' &&
      workflow.state !== 'PENDING_APPROVAL'
    ) {
      const existingApproval =
        await prisma.approval.findFirst({
          where: {
            workflowId,
            decision: 'PENDING',
          },
        });

      if (!existingApproval) {
        await prisma.approval.create({
          data: {
            workflowId,
            step: workflow.currentStep,
            decision: 'PENDING',
          },
        });
      }
    }

    await prisma.execution.update({
      where: {
        id: execution.id,
      },
      data: {
        status: 'done',
        endedAt: new Date(),
      },
    });

    console.log(
      '[runAgentLoop] execution completed for workflow',
      workflowId,
      'final state:',
      finalState
    );
  } catch (error) {
    console.error(
      '[runAgentLoop] CAUGHT ERROR:',
      error
    );

    if (executionId) {
      await prisma.execution.update({
        where: {
          id: executionId,
        },
        data: {
          status: 'failed',
          endedAt: new Date(),
          errorMessage:
            error instanceof Error
              ? error.message
              : String(error),
        },
      });
    }

    throw error;
  }
}