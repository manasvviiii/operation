import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { redactForObservability } from './redaction';

export type AppendAgentEventParams = {
  workflowId: string;
  eventType: string;
  agentName?: string | null;
  workerName?: string | null;
  toolName?: string | null;
  input?: any;
  output?: any;
  reasoningSummary?: string | null;
  stateBefore?: string | null;
  stateAfter?: string | null;
  status: string;
  latencyMs?: number | null;
  error?: string | null;
  attemptNumber?: number | null;
  maxAttempts?: number | null;
  backoffMs?: number | null;
  taxonomy?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  estimatedCost?: number | null;
  promptVersion?: string | null;
};

export async function appendAgentEvent(data: AppendAgentEventParams): Promise<void> {
  const MAX_RETRIES = 5;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      // 7. Ensure timeline persistence failures do not corrupt the workflow transaction
      await prisma.$transaction(async (tx) => {
        const lastEvent = await tx.agentEvent.findFirst({
          where: { workflowId: data.workflowId },
          orderBy: { sequenceNumber: 'desc' },
          select: { sequenceNumber: true },
        });

        const sequenceNumber = (lastEvent?.sequenceNumber ?? 0) + 1;

        await tx.agentEvent.create({
          data: {
            workflowId: data.workflowId,
            sequenceNumber,
            eventType: data.eventType,
            agentName: data.agentName ?? null,
            workerName: data.workerName ?? null,
            toolName: data.toolName ?? null,
            input: data.input ? (redactForObservability(data.input) as Prisma.InputJsonValue) : Prisma.JsonNull,
            output: data.output ? (redactForObservability(data.output) as Prisma.InputJsonValue) : Prisma.JsonNull,
            stateBefore: data.stateBefore ?? null,
            stateAfter: data.stateAfter ?? null,
            reasoningSummary: data.reasoningSummary ?? null,
            status: data.status,
            latencyMs: data.latencyMs ?? null,
            error: data.error ? (redactForObservability(data.error) as string) : null,
            attemptNumber: data.attemptNumber ?? null,
            maxAttempts: data.maxAttempts ?? null,
            backoffMs: data.backoffMs ?? null,
            taxonomy: data.taxonomy ?? null,
            promptTokens: data.promptTokens ?? null,
            completionTokens: data.completionTokens ?? null,
            totalTokens: data.totalTokens ?? null,
            estimatedCost: data.estimatedCost ?? null,
            promptVersion: data.promptVersion ?? null,
          },
        });
      });
      return; // Success, exit loop
    } catch (err: any) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        attempt++;
        if (attempt >= MAX_RETRIES) {
          console.error('[agentTimeline] Exhausted retries appending agent event:', err);
          return;
        }
        // Retry on sequence collision
        continue;
      }
      
      console.error('[agentTimeline] Failed to append agent event:', err);
      return;
    }
  }
}

export async function getAgentTimeline(workflowId: string) {
  return prisma.agentEvent.findMany({
    where: { workflowId },
    orderBy: { sequenceNumber: 'asc' },
  });
}
