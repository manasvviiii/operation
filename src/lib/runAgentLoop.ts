import { prisma } from './prisma';
import { validateTransition } from './stateMachine';
import { writeAuditLog } from './auditLog';
import { planNext, type PlanContext } from './agents/planner';
import { dispatchWorker } from './agents/workers';
import { sendMessage } from './connectors/telegram';

export async function runAgentLoop(workflowId: string, triggerSource: string): Promise<void> {
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

    // Call planNext() from planner.ts
    const plan = await planNext(context);

    // Call stateMachine.validateTransition(workflow.state, plan.targetState)
    validateTransition(workflow.state as any, plan.targetState);

    // On valid transition: update Workflow.state, call writeAuditLog, create an AgentRun row
    const updatedWorkflow = await prisma.workflow.update({
      where: { id: workflowId },
      data: {
        state: plan.targetState,
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

    await prisma.agentRun.create({
      data: {
        executionId: execution.id,
        agentName: 'planner',
        input: context as any,
        output: plan as any,
        tokens: 0,
      },
    });

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
    };

    let workerResult;
    try {
      workerResult = await dispatchWorker(plan.nextWorker, workerContext);

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

      if (workerResult.outboundMessage && workflow.chatId) {
        await sendMessage(workflow.chatId, workerResult.outboundMessage);
      }
    } catch (workerError) {
      console.error('Worker error:', workerError);
      await prisma.agentRun.create({
        data: {
          executionId: execution.id,
          agentName: plan.nextWorker,
          status: 'failed',
          input: workerContext as any,
          output: { error: workerError instanceof Error ? workerError.message : String(workerError) },
          tokens: 0,
        },
      });
    }

    // If plan.targetState === "PENDING_APPROVAL": create an Approval row and stop
    if (plan.targetState === 'PENDING_APPROVAL') {
      await prisma.approval.create({
        data: {
          workflowId,
          step: workflow.currentStep,
          decision: 'PENDING',
        },
      });

      // Update Execution status to "done" and set endedAt
      await prisma.execution.update({
        where: { id: execution.id },
        data: {
          status: 'done',
          endedAt: new Date(),
        },
      });

      return;
    }

    // Update Execution status to "done" and set endedAt
    await prisma.execution.update({
      where: { id: execution.id },
      data: {
        status: 'done',
        endedAt: new Date(),
      },
    });
  } catch (error) {
    // On thrown error, set Execution status "failed" with the error message, then rethrow
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
