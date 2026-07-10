import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateTransition } from '@/lib/stateMachine';
import { writeAuditLog } from '@/lib/auditLog';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { decision, decidedBy, reason } = await request.json();

    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      return NextResponse.json(
        { error: 'Invalid decision. Must be APPROVED or REJECTED' },
        { status: 400 }
      );
    }

    if (!decidedBy) {
      return NextResponse.json(
        { error: 'decidedBy is required' },
        { status: 400 }
      );
    }

    const approvalId = params.id;

    // Get the approval record
    const approval = await prisma.approval.findUnique({
      where: { id: approvalId },
      include: {
        workflow: true,
      },
    });

    if (!approval) {
      return NextResponse.json(
        { error: 'Approval not found' },
        { status: 404 }
      );
    }

    if (approval.decision !== 'PENDING') {
      return NextResponse.json(
        { error: 'Approval has already been decided' },
        { status: 400 }
      );
    }

    // Update the Approval row
    const updatedApproval = await prisma.approval.update({
      where: { id: approvalId },
      data: {
        decision,
        decidedBy,
        reason,
        decidedAt: new Date(),
      },
    });

    if (decision === 'APPROVED') {
      // ValidateTransition and advance Workflow out of PENDING_APPROVAL
      const currentState = approval.workflow.state;
      const targetState = 'WRITING_ERP';
      
      validateTransition(currentState as any, targetState);

      await prisma.workflow.update({
        where: { id: approval.workflowId },
        data: {
          state: targetState,
        },
      });

      await writeAuditLog({
        workflowId: approval.workflowId,
        actor: decidedBy,
        action: 'approval_approved',
        fromState: currentState,
        toState: targetState,
        metadata: {
          approvalId,
          reason,
        },
      });
    } else {
      // On REJECTED: move Workflow to PAUSED
      const currentState = approval.workflow.state;
      const targetState = 'PAUSED';
      
      validateTransition(currentState as any, targetState);

      await prisma.workflow.update({
        where: { id: approval.workflowId },
        data: {
          state: targetState,
        },
      });

      await writeAuditLog({
        workflowId: approval.workflowId,
        actor: decidedBy,
        action: 'approval_rejected',
        fromState: currentState,
        toState: targetState,
        metadata: {
          approvalId,
          reason,
        },
      });
    }

    return NextResponse.json({ success: true, approval: updatedApproval });
  } catch (error) {
    console.error('Error processing approval decision:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
