import { prisma } from './prisma';

export interface AuditLogInput {
  workflowId: string;
  actor: string;
  action: string;
  fromState?: string;
  toState?: string;
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(input: AuditLogInput) {
  return await prisma.auditLog.create({
    data: {
      workflowId: input.workflowId,
      actor: input.actor,
      action: input.action,
      fromState: input.fromState,
      toState: input.toState,
      metadata: input.metadata || {} as any,
    },
  });
}
