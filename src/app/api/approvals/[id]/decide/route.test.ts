// src/app/api/approvals/[id]/decide/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { runAgentLoop } from '@/lib/orchestra';

/**
 * Endpoint: POST /api/approvals/[id]/decide
 * Purpose: Manual human approval to bypass the PENDING_APPROVAL state.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> } // Params is a Promise in Next.js 15+
) {
  // Await the params to get the ID from the URL
  const { id } = await params;
  const workflowId = id;

  try {
    // 1. Update the workflow state to kickstart the next phase
    await prisma.workflow.update({
      where: { id: workflowId },
      data: { state: 'WRITING_ERP' },
    });

    // 2. Wake up the agent to proceed to the next step
    await runAgentLoop(workflowId);

    return NextResponse.json({ 
      success: true, 
      message: `Workflow ${workflowId} approved and sync initiated.` 
    });
  } catch (error) {
    console.error(`[Approval API] Error processing workflow ${workflowId}:`, error);
    return NextResponse.json(
      { error: 'Failed to approve workflow' }, 
      { status: 500 }
    );
  }
}