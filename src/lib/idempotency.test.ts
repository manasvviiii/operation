import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleInboundUpdate } from './inboundHandler';
import { getConnector } from './connectors/registry';
import { prisma } from './prisma';
import { runAgentLoop } from './runAgentLoop';
import { appendAgentEvent } from './observability/agentTimeline';
import { TelegramConnector } from './connectors/telegramConnector';
import { sendMessage as tgSendMessage } from './connectors/telegram';

vi.mock('./connectors/telegram', () => ({
  sendMessage: vi.fn().mockResolvedValue({ message_id: 999 }),
  normalizeUpdate: vi.fn(),
}));

vi.mock('./connectors/registry', () => ({
  getConnector: vi.fn(),
}));
vi.mock('./runAgentLoop', () => ({
  runAgentLoop: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./observability/agentTimeline', () => ({
  appendAgentEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./prisma', () => ({
  prisma: {
    workflow: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    message: {
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({ id: 'mock' }),
      findUnique: vi.fn(),
    },
  },
}));

describe('Idempotency', () => {
  let mockConnector: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnector = {
      handleInbound: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
      downloadAttachment: vi.fn(),
    };
    (getConnector as any).mockReturnValue(mockConnector);
  });

  describe('Inbound Deduplication', () => {
    it('1. same Telegram update_id twice executes workflow once', async () => {
      mockConnector.handleInbound.mockResolvedValue({
        channelId: 'chat1',
        senderId: 'sender1',
        body: 'hello',
        externalMessageId: 'inbound:telegram:123',
        ts: new Date(),
        workflowId: 'w1',
      });
      (prisma.workflow.findUnique as any).mockResolvedValue({ id: 'w1', chatId: 'chat1' });
      
      // First call succeeds
      (prisma.message.create as any).mockResolvedValueOnce({ id: 'msg1' });
      await handleInboundUpdate('telegram', { update_id: 123 });
      expect(runAgentLoop).toHaveBeenCalledTimes(1);

      // Second call fails with P2002
      (prisma.message.create as any).mockRejectedValueOnce({ code: 'P2002' });
      await handleInboundUpdate('telegram', { update_id: 123 });
      expect(runAgentLoop).toHaveBeenCalledTimes(1); // Still 1!
    });

    it('2. concurrent duplicate inbound claims result in one processing owner', async () => {
      mockConnector.handleInbound.mockResolvedValue({
        channelId: 'chat2',
        senderId: 'sender1',
        body: 'hello',
        externalMessageId: 'inbound:telegram:456',
        ts: new Date(),
        workflowId: 'w1',
      });
      (prisma.workflow.findUnique as any).mockResolvedValue({ id: 'w1', chatId: 'chat1' });
      
      let createCallCount = 0;
      (prisma.message.create as any).mockImplementation(async () => {
        createCallCount++;
        if (createCallCount === 1) return { id: 'msg1' };
        throw { code: 'P2002' };
      });

      await Promise.all([
        handleInboundUpdate('telegram', { update_id: 456 }),
        handleInboundUpdate('telegram', { update_id: 456 }),
      ]);

      expect(runAgentLoop).toHaveBeenCalledTimes(1);
    });

    it('6. duplicate events appear safely in timeline metadata', async () => {
      mockConnector.handleInbound.mockResolvedValue({
        channelId: 'chat2',
        senderId: 'sender1',
        body: 'hello',
        externalMessageId: 'inbound:telegram:789',
        ts: new Date(),
        workflowId: 'w1',
      });
      (prisma.workflow.findUnique as any).mockResolvedValue({ id: 'w1', chatId: 'chat1' });
      (prisma.message.create as any).mockRejectedValueOnce({ code: 'P2002' });

      await handleInboundUpdate('telegram', { update_id: 789 });

      expect(appendAgentEvent).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'DUPLICATE_INBOUND_SKIPPED',
        input: { externalMessageId: 'inbound:telegram:789' }
      }));
    });
  });

  describe('Outbound Idempotency', () => {
    it('concurrent duplicate outbound claims result in one Telegram send', async () => {
      const connector = new TelegramConnector();
      
      let createCallCount = 0;
      (prisma.message.create as any).mockImplementation(async () => {
        createCallCount++;
        if (createCallCount === 1) return { id: 'outbound-key-1' };
        throw { code: 'P2002' }; // Simulate duplicate claim failure
      });

      const [res1, res2] = await Promise.all([
        connector.sendMessage({
          channelId: 'chat1',
          text: 'test',
          workflowId: 'w1',
          idempotencyKey: 'outbound-key-1'
        }),
        connector.sendMessage({
          channelId: 'chat1',
          text: 'test',
          workflowId: 'w1',
          idempotencyKey: 'outbound-key-1'
        })
      ]);

      // Exactly one network call!
      expect(tgSendMessage).toHaveBeenCalledTimes(1);
      
      // Both return success
      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);
      
      // Loser emits DUPLICATE_OUTBOUND_SKIPPED
      expect(appendAgentEvent).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'DUPLICATE_OUTBOUND_SKIPPED',
        status: 'duplicate_suppressed'
      }));
    });

    it('existing Message with externalMessageId null + P2002 on claim does NOT permit the new invocation to send', async () => {
      const connector = new TelegramConnector();
      
      // Simulate P2002 on create
      (prisma.message.create as any).mockRejectedValueOnce({ code: 'P2002' });
      
      const res = await connector.sendMessage({
        channelId: 'chat1',
        text: 'test',
        workflowId: 'w1',
        idempotencyKey: 'outbound-key-2'
      });

      expect(tgSendMessage).not.toHaveBeenCalled();
      expect(res).toEqual({ success: true, duplicate_suppressed: true });
    });
  });
});
