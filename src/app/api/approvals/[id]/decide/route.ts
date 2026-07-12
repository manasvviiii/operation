import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { waitUntil } from '@vercel/functions';
import { prisma } from '../../../../../lib/prisma';
import { validateTransition } from '../../../../../lib/stateMachine';
import { writeAuditLog } from '../../../../../lib/auditLog';
import { runAgentLoop } from '../../../../../lib/runAgentLoop';
import { getConnector } from '../../../../../lib/connectors/registry';
import { appendAgentEvent } from '../../../../../lib/observability/agentTimeline';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

    const { id: approvalId } = await params;

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
      if (approval.decision === decision) {
        return NextResponse.json({ success: true, approval });
      }
      return NextResponse.json(
        { error: 'Approval has already been decided with a different decision' },
        { status: 400 }
      );
    }

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
      const currentState = approval.workflow.state;
      const targetState = 'WRITING_ERP';

      validateTransition(currentState, targetState);

      await prisma.workflow.update({
        where: { id: approval.workflowId },
        data: {
          state: targetState,
        },
      });

      await writeAuditLog({
        workflowId: approval.workflowId,
        actor: 'human',
        action: 'approval_approved',
        fromState: currentState,
        toState: targetState,
        metadata: {
          approvalId,
          decidedBy,
          reason,
        },
      });

      await appendAgentEvent({
        workflowId: approval.workflowId,
        eventType: 'APPROVAL_APPROVED',
        status: 'success',
        agentName: 'system',
        stateBefore: currentState,
        stateAfter: targetState,
        reasoningSummary: `Approval granted by ${decidedBy}${reason ? `: ${reason}` : ''}`,
      });

      // IMPORTANT: this must stay alive after the response is sent. On Vercel,
      // a plain un-awaited promise can be killed the instant the response returns
      // (the function's execution context isn't guaranteed to persist). waitUntil()
      // tells the runtime to keep this invocation alive until the promise settles,
      // so runAgentLoop (and the ERP write + final Telegram message it triggers)
      // reliably completes even though we don't want the HTTP response to wait for it.
      waitUntil(
        runAgentLoop(approval.workflowId, 'approval_decided').catch((err) => {
          console.error('Error running agent loop after approval decision:', err);
        })
      );
    } else {
      const currentState = approval.workflow.state;
      const targetState = 'PAUSED';

      validateTransition(currentState, targetState);

      await prisma.workflow.update({
        where: { id: approval.workflowId },
        data: {
          state: targetState,
        },
      });

      await writeAuditLog({
        workflowId: approval.workflowId,
        actor: 'human',
        action: 'approval_rejected',
        fromState: currentState,
        toState: targetState,
        metadata: {
          approvalId,
          decidedBy,
          reason,
        },
      });

      await appendAgentEvent({
        workflowId: approval.workflowId,
        eventType: 'APPROVAL_REJECTED',
        status: 'success',
        agentName: 'system',
        stateBefore: currentState,
        stateAfter: targetState,
        reasoningSummary: `Approval rejected by ${decidedBy}${reason ? `: ${reason}` : ''}`,
      });

      if (approval.workflow.chatId) {
        const text = `Your onboarding was not approved. Please contact the procurement team for further information.`;
        const connector = getConnector(approval.workflow.primaryChannel || 'telegram');
        await connector.sendMessage({
          channelId: approval.workflow.chatId,
          text,
        }).catch((err) => {
          console.error('Failed to send rejection message via connector:', err);
        });
      }
    }

    // Invalidate dashboard caches so navigation shows fresh data
    revalidatePath('/dashboard', 'layout');

    return NextResponse.json({ success: true, approval: updatedApproval });
  } catch (error) {
    console.error('Error processing approval decision:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}