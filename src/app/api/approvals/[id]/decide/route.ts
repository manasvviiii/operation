// src/app/api/admin/approve/[workflowId]/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { runAgentLoop } from '@/lib/orchestra';

export async function POST(
  req: Request,
  { params }: { params: { workflowId: string } }
) {
  const { workflowId } = params;

  try {
    // 1. Update the state to transition out of PENDING_APPROVAL
    const updatedWorkflow = await prisma.workflow.update({
      where: { id: workflowId },
      data: { state: 'WRITING_ERP' },
    });

    // 2. Trigger the orchestrator to resume the loop
    // This forces the agent to realize the state has changed and trigger the erp_agent
    await runAgentLoop(workflowId);

    return NextResponse.json({ success: true, newState: 'WRITING_ERP' });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to approve workflow' }, { status: 500 });
  }
}