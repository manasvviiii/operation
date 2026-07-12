
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock TelegramConnector (must be before imports that use it)
const mockSendMessage = vi.fn().mockResolvedValue({ success: true });
const mockHandleInbound = vi.fn();
const mockDownloadAttachment = vi.fn();
vi.mock('./connectors/registry', () => ({
  getConnector: vi.fn(() => ({
    sendMessage: mockSendMessage,
    handleInbound: mockHandleInbound,
    downloadAttachment: mockDownloadAttachment
  }))
}));

import { handleInboundUpdate } from './inboundHandler';
import { normalizeUpdate } from './connectors/telegram';
import { runAgentLoop } from './runAgentLoop';

// Mock prisma
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

// Mock normalizeUpdate
vi.mock('./connectors/telegram', () => ({
  normalizeUpdate: vi.fn(),
}));

// Mock runAgentLoop
vi.mock('./runAgentLoop', () => ({
  runAgentLoop: vi.fn(),
}));

import { prisma } from './prisma';

const mockPrisma = prisma as any;
const mockNormalizeUpdate = normalizeUpdate as any;
const mockRunAgentLoop = runAgentLoop as any;

describe('handleInboundUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early and does nothing when normalizeUpdate returns null', async () => {
    mockHandleInbound.mockResolvedValue(null);

    await handleInboundUpdate({
      some: 'raw update',
    });

    expect(
      mockPrisma.workflow.findUnique
    ).not.toHaveBeenCalled();

    expect(
      mockPrisma.workflow.findFirst
    ).not.toHaveBeenCalled();

    expect(
      mockRunAgentLoop
    ).not.toHaveBeenCalled();
  });

  it('resolves workflow via /start deep link, binds chatId when not already set, and calls runAgentLoop', async () => {
    mockHandleInbound.mockResolvedValue({
      channelId: 'chat-1',
      senderId: 'sender-1',
      body: '/start wf-1',
      externalMessageId: 'ext-1',
      ts: new Date('2026-07-11T00:00:00Z'),
      workflowId: 'wf-1',
    });

    mockPrisma.workflow.findUnique.mockResolvedValue({
      id: 'wf-1',
      chatId: null,
      state: 'INITIATED',
    });

    mockPrisma.workflow.update.mockResolvedValue({
      id: 'wf-1',
      chatId: 'chat-1',
      state: 'INITIATED',
    });

    mockPrisma.message.create.mockResolvedValue({});

    mockRunAgentLoop.mockResolvedValue(undefined);

    await handleInboundUpdate('telegram', {
      message: {},
    });

    expect(
      mockPrisma.workflow.update
    ).toHaveBeenCalledWith({
      where: {
        id: 'wf-1',
      },
      data: { chatId: 'chat-1',
      },
    });

    expect(
      mockPrisma.message.create
    ).toHaveBeenCalledWith({
      data: {
        workflowId: 'wf-1',
        connectorId: 'telegram',
        direction: 'INBOUND',
        role: 'user',
        channel: 'telegram',
        senderId: 'sender-1',
        content: '/start wf-1',
        externalMessageId: 'ext-1',
        createdAt: new Date(
          '2026-07-11T00:00:00Z'
        ),
      },
    });

    expect(
      mockRunAgentLoop
    ).toHaveBeenCalledWith(
      'wf-1',
      'inbound_message'
    );
  });

  it('does not re-bind chatId when the workflow already has one set', async () => {
    mockHandleInbound.mockResolvedValue({
      channelId: 'chat-1',
      senderId: 'sender-1',
      body: '/start wf-1',
      externalMessageId: 'ext-2',
      ts: new Date(),
      workflowId: 'wf-1',
    });

    mockPrisma.workflow.findUnique.mockResolvedValue({
      id: 'wf-1',
      chatId: 'chat-1',
      state: 'AWAITING_GST',
    });

    mockPrisma.message.create.mockResolvedValue({});

    mockRunAgentLoop.mockResolvedValue(undefined);

    await handleInboundUpdate('telegram', {
      message: {},
    });

    expect(
      mockPrisma.workflow.update
    ).not.toHaveBeenCalled();

    expect(
      mockRunAgentLoop
    ).toHaveBeenCalledWith(
      'wf-1',
      'inbound_message'
    );
  });

  it('logs a warning and returns early for an unknown workflowId from a /start link', async () => {
    mockHandleInbound.mockResolvedValue({
      channelId: 'chat-1',
      senderId: 'sender-1',
      body: '/start wf-does-not-exist',
      externalMessageId: 'ext-3',
      ts: new Date(),
      workflowId: 'wf-does-not-exist',
    });

    mockPrisma.workflow.findUnique.mockResolvedValue(
      null
    );

    await handleInboundUpdate('telegram', {
      message: {},
    });

    expect(
      mockPrisma.message.create
    ).not.toHaveBeenCalled();

    expect(
      mockRunAgentLoop
    ).not.toHaveBeenCalled();
  });

  it('resolves an already-bound chatId with no workflowId and calls runAgentLoop', async () => {
    mockHandleInbound.mockResolvedValue({
      channelId: 'chat-2',
      senderId: 'sender-2',
      body: 'ABCDE1234F',
      externalMessageId: 'ext-4',
      ts: new Date(),
      workflowId: undefined,
    });

    mockPrisma.workflow.findFirst.mockResolvedValue({
      id: 'wf-2',
      chatId: 'chat-2',
      state: 'AWAITING_PAN',
    });

    mockPrisma.message.create.mockResolvedValue({});

    mockRunAgentLoop.mockResolvedValue(undefined);

    await handleInboundUpdate('telegram', {
      message: {},
    });

    expect(
      mockPrisma.workflow.findFirst
    ).toHaveBeenCalledWith({
      where: { chatId: 'chat-2',
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    expect(
      mockRunAgentLoop
    ).toHaveBeenCalledWith(
      'wf-2',
      'inbound_message'
    );
  });

  it('sends a fallback message and does not call runAgentLoop for an unrecognized chatId with no workflowId', async () => {
    mockHandleInbound.mockResolvedValue({
      channelId: 'chat-unknown',
      senderId: 'sender-3',
      body: 'hello',
      externalMessageId: 'ext-5',
      ts: new Date(),
      workflowId: undefined,
    });

    mockPrisma.workflow.findFirst.mockResolvedValue(
      null
    );

    await handleInboundUpdate('telegram', {
      message: {},
    });

    expect(mockSendMessage).toHaveBeenCalledWith({
      channelId: 'chat-unknown',
      text: "I don't recognize this chat — please use your onboarding link to start.",
    });

    expect(
      mockPrisma.message.create
    ).not.toHaveBeenCalled();

    expect(
      mockRunAgentLoop
    ).not.toHaveBeenCalled();
  });

  it('does not rethrow when runAgentLoop throws — catches and logs instead', async () => {
    mockHandleInbound.mockResolvedValue({
      channelId: 'chat-3',
      senderId: 'sender-4',
      body: 'some message',
      externalMessageId: 'ext-6',
      ts: new Date(),
      workflowId: undefined,
    });

    mockPrisma.workflow.findFirst.mockResolvedValue({
      id: 'wf-3',
      chatId: 'chat-3',
      state: 'VALIDATING',
    });

    mockPrisma.message.create.mockResolvedValue({});

    mockRunAgentLoop.mockRejectedValue(
      new Error('agent loop exploded')
    );

    await expect(
      handleInboundUpdate('telegram', {
      message: {},
      })
    ).resolves.not.toThrow();
  });

  it('does not rethrow when message.create itself throws', async () => {
    mockHandleInbound.mockResolvedValue({
      channelId: 'chat-4',
      senderId: 'sender-5',
      body: 'some message',
      externalMessageId: 'ext-7',
      ts: new Date(),
      workflowId: undefined,
    });

    mockPrisma.workflow.findFirst.mockResolvedValue({
      id: 'wf-4',
      chatId: 'chat-4',
      state: 'AWAITING_BANK',
    });

    mockPrisma.message.create.mockRejectedValue(
      new Error('db write failed')
    );

    await expect(
      handleInboundUpdate('telegram', {
      message: {},
      })
    ).resolves.not.toThrow();

    expect(
      mockRunAgentLoop
    ).not.toHaveBeenCalled();
  });
});

