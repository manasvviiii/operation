// src/lib/orchestra.ts
import { planNext } from './prompts/planner';
import * as workers from './workers'; 
import { getFullContext } from './context';
import { prisma } from './prisma';

export async function runAgentLoop(workflowId: string, depth = 0) {
  // Prevent infinite loops (Safety Limit)
  if (depth > 10) return;

  const context = await getFullContext(workflowId);
  if (!context) return;

  // 1. Pause if we are waiting for user input
  if (['AWAITING_GST', 'AWAITING_PAN', 'AWAITING_BANK'].includes(context.workflow.state)) {
    console.log(`[Orchestrator] Waiting for user input. Loop paused.`);
    return;
  }

  // 2. Plan
  const plan = await planNext(context);
  console.log(`[Orchestrator] Plan: ${plan.nextWorker} -> ${plan.targetState}`);

  // 3. Dispatch
  const workerFn = (workers as any)[plan.nextWorker];
  
  if (workerFn) {
    await workerFn(workflowId, context);
    
    // 4. Update State
    await prisma.workflow.update({
        where: { id: workflowId },
        data: { state: plan.targetState }
    });

    // 5. Recursive Step
    if (!['COMPLETED', 'PENDING_APPROVAL'].includes(plan.targetState)) {
        await runAgentLoop(workflowId, depth + 1);
    }
  } else {
    console.error(`[Orchestrator] No worker found for: ${plan.nextWorker}`);
  }
}