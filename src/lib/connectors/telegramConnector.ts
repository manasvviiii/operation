import { Connector, ConnectorResponse, NormalizedOutboundMessage, NormalizedInboundEvent } from './types';
import { sendMessage, normalizeUpdate } from './telegram';
import { downloadTelegramFile } from './telegramAttachment';
import { withRetry, RetryEvent } from '../retry';
import { appendAgentEvent } from '../observability/agentTimeline';
import { prisma } from '../prisma';

export class TelegramConnector implements Connector {
  id = 'telegram';
  kind = 'telegram';

  async sendMessage(input: NormalizedOutboundMessage): Promise<ConnectorResponse> {
    const startTime = Date.now();
    const workflowId = input.workflowId ?? input.channelId;
    const idempotencyKey = input.idempotencyKey;
    
    if (idempotencyKey && input.workflowId) {
      try {
        await prisma.message.create({
          data: {
            id: idempotencyKey,
            workflowId: input.workflowId,
            direction: 'OUTBOUND',
            content: input.text,
            channel: 'telegram',
            connectorId: 'telegram',
          }
        });
      } catch (e: any) {
        if (e.code === 'P2002') {
          await appendAgentEvent({
            workflowId: input.workflowId,
            eventType: 'DUPLICATE_OUTBOUND_SKIPPED',
            status: 'duplicate_suppressed',
            agentName: 'telegramConnector',
            input: {
              connectorId: 'telegram',
              operation: 'sendMessage',
              idempotencyKey,
            }
          }).catch(() => {});
          return { success: true, duplicate_suppressed: true };
        }
        throw e;
      }
    }
    
    try {
      await appendAgentEvent({
        workflowId,
        eventType: 'CONNECTOR_CALL_STARTED',
        status: 'pending',
        agentName: 'telegramConnector',
        toolName: 'sendMessage',
        input: { operation: 'sendMessage', connectorId: 'telegram' },
      }).catch(() => {});

      let tgMessageId: number | undefined;

      await withRetry(
        async () => {
          const msg = await sendMessage(input.channelId, input.text);
          tgMessageId = msg.message_id;
        },
        {
          maxAttempts: 3,
          baseDelayMs: 500,
          context: {
            connectorId: 'telegram',
            workflowId: input.channelId, // Close enough, used for tracking if available
          },
          onRetryEvent: (event: RetryEvent) => {
            // Find a way to link to workflow if possible, otherwise it logs a generic error.
            // But we actually do not strictly know workflowId here, so we'll log what we have.
            // The PRD says "Ensure connector retries are observable". 
            // Inbound handling usually tracks this, outbound usually has it in scope but here we only have channelId.
            // But let's log it anyway. If we don't have a valid workflowId, appendAgentEvent might fail constraints.
            // Let's wrap appendAgentEvent in a try-catch.
            try {
              appendAgentEvent({
                workflowId: input.workflowId ?? input.channelId,
                eventType: event.eventType,
                agentName: 'telegramConnector',
                status: event.eventType === 'retry_succeeded' ? 'success' : 'failed',
                attemptNumber: event.attemptNumber,
                maxAttempts: event.maxAttempts,
                backoffMs: event.backoffMs,
                taxonomy: event.taxonomy,
                error: event.error,
              }).catch(() => {});
            } catch (e) {}
          }
        }
      );
      const latencyMs = Date.now() - startTime;
      await appendAgentEvent({
        workflowId,
        eventType: 'CONNECTOR_CALL_COMPLETED',
        status: 'success',
        agentName: 'telegramConnector',
        toolName: 'sendMessage',
        latencyMs,
      }).catch(() => {});

      if (idempotencyKey && tgMessageId) {
        await prisma.message.update({
          where: { id: idempotencyKey },
          data: { externalMessageId: String(tgMessageId) }
        }).catch(() => {});
      }

      return { success: true };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      await appendAgentEvent({
        workflowId,
        eventType: 'CONNECTOR_CALL_FAILED',
        status: 'failed',
        agentName: 'telegramConnector',
        toolName: 'sendMessage',
        latencyMs,
        error: errorMessage,
      }).catch(() => {});
      
      return { success: false, error: errorMessage };
    }
  }

  async handleInbound(input: unknown): Promise<NormalizedInboundEvent | null> {
    const inbound = normalizeUpdate(input);
    if (!inbound) return null;
    return {
      connectorId: this.id,
      channelId: inbound.chatId,
      senderId: inbound.senderId,
      body: inbound.body,
      externalMessageId: inbound.externalMessageId,
      ts: inbound.ts,
      workflowId: inbound.workflowId,
    };
  }

  async downloadAttachment(attachmentId: string): Promise<{ data: Buffer; mime: string }> {
    const result = await downloadTelegramFile(attachmentId);
    return { data: result.data, mime: result.mime || 'application/octet-stream' };
  }
}
