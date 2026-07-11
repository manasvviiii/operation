import { prisma } from './prisma';
import { validateTransition } from './stateMachine';
import { writeAuditLog } from './auditLog';
import { planNext, type PlanContext } from './agents/planner';
import { dispatchWorker } from './agents/workers';
import { TelegramConnector } from './connectors/telegramConnector';

export async function runAgentLoop(workflowId: string, triggerSource: string): Promise<void> {
  const telegramConnector = new TelegramConnector();
  let executionId: string | null = null;

  try {
    // Reconstruct context: Workflow + Vendor + last 10 Messages + last 10 AuditLogs
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId },
      include: {
        vendor: true,
      },
    });

    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    console.log('[runAgentLoop] loaded workflow', workflowId, 'state:', workflow.state, 'trigger:', triggerSource);

    if (workflow.state === 'PENDING_APPROVAL' && triggerSource !== 'approval_decided') {
      console.log('[runAgentLoop] BLOCKED — workflow is PENDING_APPROVAL and trigger is not approval_decided, refusing to plan');
      await writeAuditLog({
        workflowId,
        actor: 'system',
        action: 'blocked_pending_approval',
        fromState: 'PENDING_APPROVAL',
        toState: 'PENDING_APPROVAL',
      });
      return;
    }

    console.log('[runAgentLoop] guard passed, proceeding to planner');

    const messages = await prisma.message.findMany({
      where: { workflowId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const auditLogs = await prisma.auditLog.findMany({
      where: { workflowId },
      orderBy: { createdAt: 'desc' },
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
        contactEmail: workflow.vendor.contactEmail,
        status: workflow.vendor.status,
      },
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
      auditLogs: auditLogs.map((a) => ({
        id: a.id,
        actor: a.actor,
        action: a.action,
        fromState: a.fromState || undefined,
        toState: a.toState || undefined,
        createdAt: a.createdAt,
      })),
    };

    // Create an Execution row (status: "running")
    const execution = await prisma.execution.create({
      data: {
        workflowId,
        triggerSource,
        status: 'running',
        startedAt: new Date(),
      },
    });
    executionId = execution.id;

    console.log('[runAgentLoop] calling planNext with context state:', context.workflow.state);

    // Call planNext() from planner.ts
    const planResult = await planNext(context);
    const plan = 'plan' in planResult ? planResult.plan : planResult;
    const tokensUsed = 'tokensUsed' in planResult ? (planResult as any).tokensUsed : 0;

    console.log('[runAgentLoop] plan received:', JSON.stringify(plan));

    // Create AgentRun row for the planner unconditionally
    await prisma.agentRun.create({
      data: {
        executionId: execution.id,
        agentName: 'planner',
        input: context as any,
        output: { ...plan, promptVersion: 'v1' } as any,
        tokens: tokensUsed,
      },
    });

    // Call stateMachine.validateTransition(workflow.state, plan.targetState) as a SYNTAX/LEGALITY check only
    try {
      validateTransition(workflow.state as any, plan.targetState);
    } catch (transitionError) {
      // Illegal transition proposed by planner - handle gracefully
      console.error('[runAgentLoop] Planner proposed illegal transition:', transitionError);
      
      // Write AuditLog for the illegal transition
      await writeAuditLog({
        workflowId,
        actor: 'system',
        action: 'planner_proposed_illegal_transition',
        fromState: workflow.state,
        toState: workflow.state, // unchanged - do not advance state
        metadata: {
          attemptedTargetState: plan.targetState,
          nextWorker: plan.nextWorker,
          reasoning: plan.reasoningSummary,
          error: transitionError instanceof Error ? transitionError.message : String(transitionError),
        },
      });

      // Send holding message to vendor if chatId exists
      if (workflow.chatId) {
        console.log('[runAgentLoop] sending holding message to vendor', workflow.chatId);
        await telegramConnector.execute({
          operation: 'sendMessage',
          payload: { chatId: workflow.chatId, text: 'Thanks — we\'re finishing up validation on your details. You\'ll hear from us shortly.' },
        });
      }

      // Update Execution to 'done' (not 'failed') - this was handled, not a crash
      await prisma.execution.update({
        where: { id: execution.id },
        data: {
          status: 'done',
          endedAt: new Date(),
        },
      });

      console.log('[runAgentLoop] execution marked done after illegal transition catch for workflow', workflowId);
      return; // Exit normally, do not rethrow
    }

    const workerContext = {
      workflowId: workflow.id,
      vendor: {
        id: workflow.vendor.id,
        legalName: workflow.vendor.legalName,
        contactEmail: workflow.vendor.contactEmail,
        status: workflow.vendor.status,
      },
      messages: context.messages,
      plan: {
        nextWorker: plan.nextWorker,
        targetState: plan.targetState,
        reasoningSummary: plan.reasoningSummary,
      },
      extractedFields: (workflow.extractedFields && typeof workflow.extractedFields === 'object')
        ? (workflow.extractedFields as Record<string, unknown>)
        : undefined,
    };

    console.log('[runAgentLoop] dispatching worker:', plan.nextWorker);

    let workerResult;
    let workerException = false;
    try {
      workerResult = await dispatchWorker(plan.nextWorker, workerContext);
      console.log('[runAgentLoop] worker result:', JSON.stringify(workerResult));
    } catch (workerError) {
      console.error('Worker error:', workerError);
      workerException = true;
      workerResult = {
        success: false,
        error: workerError instanceof Error ? workerError.message : String(workerError),
      };
      console.log('[runAgentLoop] worker result (from catch):', JSON.stringify(workerResult));
    }

    // Create AgentRun row for the worker
    await prisma.agentRun.create({
      data: {
        executionId: execution.id,
        agentName: plan.nextWorker,
        status: workerResult.success ? 'done' : 'failed',
        input: workerContext as any,
        output: workerResult as any,
        tokens: 0,
      },
    });

    if (workerResult.success === true) {
      // Worker succeeded, proceed with transition
      let mergedExtracted = {};
      if (workflow.extractedFields && typeof workflow.extractedFields === 'object') {
        mergedExtracted = { ...workflow.extractedFields };
      }
      if (workerResult.extractedData && typeof workerResult.extractedData === 'object') {
        mergedExtracted = { ...mergedExtracted, ...workerResult.extractedData };
      }

      await prisma.workflow.update({
        where: { id: workflowId },
        data: {
          state: plan.targetState,
          extractedFields: mergedExtracted,
        },
      });

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

      if (workerResult.outboundMessage && workflow.chatId) {
        console.log('[runAgentLoop] sending outbound telegram message to', workflow.chatId);
        await telegramConnector.execute({ operation: 'sendMessage', payload: { chatId: workflow.chatId, text: workerResult.outboundMessage } });
      }

      if (plan.targetState === 'PENDING_APPROVAL') {
        await prisma.approval.create({
          data: {
            workflowId,
            step: workflow.currentStep,
            decision: 'PENDING',
          },
        });
      }
    } else {
      // Worker returned success: false or threw an exception
      await prisma.auditLog.create({
        data: {
          workflowId,
          actor: 'system',
          action: 'transition_blocked_by_worker',
          fromState: workflow.state,
          toState: workflow.state,
          metadata: {
            targetState: plan.targetState,
            error: workerResult.error,
            reasoning: plan.reasoningSummary,
            workerException,
          },
        },
      });
      
      if (workerResult.outboundMessage && workflow.chatId) {
        console.log('[runAgentLoop] sending outbound telegram message (blocked path) to', workflow.chatId);
        await telegramConnector.execute({ operation: 'sendMessage', payload: { chatId: workflow.chatId, text: workerResult.outboundMessage } });
      }
    }

    // Update Execution status to "done" and set endedAt
    await prisma.execution.update({
      where: { id: execution.id },
      data: {
        status: 'done',
        endedAt: new Date(),
      },
    });

    console.log('[runAgentLoop] execution marked done for workflow', workflowId);
  } catch (error) {
    // On thrown error outside worker, set Execution status "failed" with the error message, then rethrow
    console.error('[runAgentLoop] CAUGHT ERROR — marking execution failed:', error);
    if (executionId) {
      await prisma.execution.update({
        where: { id: executionId },
        data: {
          status: 'failed',
          endedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
    }

    throw error;
  }
}