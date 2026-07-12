import { Connector, ConnectorResponse, NormalizedOutboundMessage, NormalizedInboundEvent } from './types';
import { sendMessage, normalizeUpdate } from './telegram';
import { downloadTelegramFile } from './telegramAttachment';
import { withRetry, RetryEvent } from '../retry';
import { appendAgentEvent } from '../observability/agentTimeline';

export class TelegramConnector implements Connector {
  id = 'telegram';
  kind = 'telegram';

  async sendMessage(input: NormalizedOutboundMessage): Promise<ConnectorResponse> {
    try {
      await withRetry(
        async () => {
          await sendMessage(input.channelId, input.text);
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
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
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
