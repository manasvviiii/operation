import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma', () => ({
  prisma: {
    workflow: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    message: {
      create: vi.fn(),
    },
  },
}));

vi.mock('./connectors/telegram', () => ({
  normalizeUpdate: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('./runAgentLoop', () => ({
  runAgentLoop: vi.fn(),
}));

import { prisma } from './prisma';
import { normalizeUpdate, sendMessage } from './connectors/telegram';
import { runAgentLoop } from './runAgentLoop';
import { handleInboundUpdate } from './inboundHandler';

const mockPrisma = prisma as any;
const mockNormalizeUpdate = normalizeUpdate as any;
const mockSendMessage = sendMessage as any;
const mockRunAgentLoop = runAgentLoop as any;

describe('handleInboundUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early when normalizeUpdate returns null', async () => {
    mockNormalizeUpdate.mockReturnValue(null);

    await handleInboundUpdate({ raw: 'update' });

    expect(mockPrisma.workflow.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.workflow.findFirst).not.toHaveBeenCalled();
    expect(mockRunAgentLoop).not.toHaveBeenCalled();
  });

  it('binds chatId to workflow via /start link when chatId not yet set, writes Message, calls runAgentLoop', async () => {
    const ts = new Date();
    mockNormalizeUpdate.mockReturnValue({
      workflowId: 'wf-123',
      chatId: 'chat-1',
      senderId: 'user-1',
      body: '/start wf-123',
      externalMessageId: 'msg-1',
      ts,
    });

    mockPrisma.workflow.findUnique.mockResolvedValue({ id: 'wf-123', chatId: null });
    mockPrisma.workflow.update.mockResolvedValue({ id: 'wf-123', chatId: 'chat-1' });
    mockPrisma.message.create.mockResolvedValue({});
    mockRunAgentLoop.mockResolvedValue(undefined);

    await handleInboundUpdate({ raw: 'update' });

    expect(mockPrisma.workflow.update).toHaveBeenCalledWith({
      where: { id: 'wf-123' },
      data: { chatId: 'chat-1' },
    });

    expect(mockPrisma.message.create).toHaveBeenCalledWith({
      data: {
        workflowId: 'wf-123',
        connectorId: 'telegram',
        direction: 'INBOUND',
        role: 'user',
        channel: 'telegram',
        senderId: 'user-1',
        content: '/start wf-123',
        externalMessageId: 'msg-1',
        createdAt: ts,
      },
    });

    expect(mockRunAgentLoop).toHaveBeenCalledWith('wf-123', 'inbound_message');
  });

  it('does not re-bind chatId if workflow already has one', async () => {
    mockNormalizeUpdate.mockReturnValue({
      workflowId: 'wf-999',
      chatId: 'chat-new',
      senderId: 'user-1',
      body: '/start wf-999',
      externalMessageId: 'msg-x',
      ts: new Date(),
    });

    mockPrisma.workflow.findUnique.mockResolvedValue({ id: 'wf-999', chatId: 'chat-already-bound' });
    mockPrisma.message.create.mockResolvedValue({});
    mockRunAgentLoop.mockResolvedValue(undefined);

    await handleInboundUpdate({ raw: 'update' });

    expect(mockPrisma.workflow.update).not.toHaveBeenCalled();
    expect(mockRunAgentLoop).toHaveBeenCalledWith('wf-999', 'inbound_message');
  });

  it('logs a warning and returns early for an unknown workflowId', async () => {
    mockNormalizeUpdate.mockReturnValue({
      workflowId: 'wf-does-not-exist',
      chatId: 'chat-1',
      senderId: 'user-1',
      body: '/start wf-does-not-exist',
      externalMessageId: 'msg-1',
      ts: new Date(),
    });

    mockPrisma.workflow.findUnique.mockResolvedValue(null);

    await handleInboundUpdate({ raw: 'update' });

    expect(mockPrisma.message.create).not.toHaveBeenCalled();
    expect(mockRunAgentLoop).not.toHaveBeenCalled();
  });

  it('resolves an existing workflow by chatId when no workflowId is present', async () => {
    mockNormalizeUpdate.mockReturnValue({
      chatId: 'chat-2',
      senderId: 'user-2',
      body: 'just a message',
      externalMessageId: 'msg-2',
      ts: new Date(),
    });

    mockPrisma.workflow.findFirst.mockResolvedValue({ id: 'wf-456', chatId: 'chat-2' });
    mockPrisma.message.create.mockResolvedValue({});
    mockRunAgentLoop.mockResolvedValue(undefined);

    await handleInboundUpdate({ raw: 'update' });

    expect(mockPrisma.workflow.findFirst).toHaveBeenCalledWith({ where: { chatId: 'chat-2' } });
    expect(mockRunAgentLoop).toHaveBeenCalledWith('wf-456', 'inbound_message');
  });

  it('sends a fallback message and does not call runAgentLoop for an unrecognized chat', async () => {
    mockNormalizeUpdate.mockReturnValue({
      chatId: 'chat-unknown',
      senderId: 'user-3',
      body: 'hello?',
      externalMessageId: 'msg-3',
      ts: new Date(),
    });

    mockPrisma.workflow.findFirst.mockResolvedValue(null);

    await handleInboundUpdate({ raw: 'update' });

    expect(mockSendMessage).toHaveBeenCalledWith(
      'chat-unknown',
      expect.any(String)
    );
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
    expect(mockRunAgentLoop).not.toHaveBeenCalled();
  });

  it('does not throw when message.create fails', async () => {
    mockNormalizeUpdate.mockReturnValue({
      workflowId: 'wf-1',
      chatId: 'chat-1',
      senderId: 'user-1',
      body: '/start wf-1',
      externalMessageId: 'msg-1',
      ts: new Date(),
    });

    mockPrisma.workflow.findUnique.mockResolvedValue({ id: 'wf-1', chatId: 'chat-1' });
    mockPrisma.message.create.mockRejectedValue(new Error('db error'));

    await expect(handleInboundUpdate({ raw: 'update' })).resolves.not.toThrow();
    expect(mockRunAgentLoop).not.toHaveBeenCalled();
  });

  it('does not throw when runAgentLoop fails', async () => {
    mockNormalizeUpdate.mockReturnValue({
      workflowId: 'wf-2',
      chatId: 'chat-2',
      senderId: 'user-1',
      body: '/start wf-2',
      externalMessageId: 'msg-2',
      ts: new Date(),
    });

    mockPrisma.workflow.findUnique.mockResolvedValue({ id: 'wf-2', chatId: 'chat-2' });
    mockPrisma.message.create.mockResolvedValue({});
    mockRunAgentLoop.mockRejectedValue(new Error('planner failed'));

    await expect(handleInboundUpdate({ raw: 'update' })).resolves.not.toThrow();
  });
});