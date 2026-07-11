import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('../prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (cb) => cb(mockTx)),
    agentEvent: {
      findMany: vi.fn(),
    },
  },
}));

const mockTx = {
  agentEvent: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
};

import { appendAgentEvent, getAgentTimeline } from './agentTimeline';
import { prisma } from '../prisma';

describe('agentTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('appendAgentEvent appends event with deterministic sequence number', async () => {
    mockTx.agentEvent.findFirst.mockResolvedValueOnce({ sequenceNumber: 5 });
    
    await appendAgentEvent({
      workflowId: 'wf-1',
      eventType: 'LOOP_STARTED',
      status: 'success',
      reasoningSummary: 'No hidden chain-of-thought, just operational summary',
    });

    expect(mockTx.agentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workflowId: 'wf-1',
        eventType: 'LOOP_STARTED',
        sequenceNumber: 6,
        status: 'success',
        reasoningSummary: 'No hidden chain-of-thought, just operational summary',
      }),
    });
  });

  it('appendAgentEvent starts at sequence 1 if no prior events', async () => {
    mockTx.agentEvent.findFirst.mockResolvedValueOnce(null);
    
    await appendAgentEvent({
      workflowId: 'wf-1',
      eventType: 'PLAN_CREATED',
      status: 'success',
    });

    expect(mockTx.agentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sequenceNumber: 1,
        eventType: 'PLAN_CREATED',
      }),
    });
  });

  it('P2002 sequence collision retries allocation and obtains newer sequence', async () => {
    // Attempt 1: gets sequence 5 -> tries to create 6, throws P2002
    mockTx.agentEvent.findFirst.mockResolvedValueOnce({ sequenceNumber: 5 });
    const p2002Error = new Prisma.PrismaClientKnownRequestError('collision', {
      code: 'P2002',
      clientVersion: '7.8.0',
    });
    mockTx.agentEvent.create.mockRejectedValueOnce(p2002Error);
    
    // Attempt 2: gets sequence 6 -> tries to create 7, succeeds
    mockTx.agentEvent.findFirst.mockResolvedValueOnce({ sequenceNumber: 6 });
    mockTx.agentEvent.create.mockResolvedValueOnce({ id: 'new-event' });

    await appendAgentEvent({
      workflowId: 'wf-retry',
      eventType: 'WORKER_DISPATCHED',
      status: 'success',
    });

    // It should have queried latest sequence twice
    expect(mockTx.agentEvent.findFirst).toHaveBeenCalledTimes(2);
    // It should have attempted creation twice, second time with sequenceNumber 7
    expect(mockTx.agentEvent.create).toHaveBeenCalledTimes(2);
    expect(mockTx.agentEvent.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        workflowId: 'wf-retry',
        sequenceNumber: 7,
      }),
    });
  });

  it('exhausted retry attempts are logged and swallowed', async () => {
    mockTx.agentEvent.findFirst.mockResolvedValue({ sequenceNumber: 1 });
    const p2002Error = new Prisma.PrismaClientKnownRequestError('collision', {
      code: 'P2002',
      clientVersion: '7.8.0',
    });
    mockTx.agentEvent.create.mockRejectedValue(p2002Error);

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(appendAgentEvent({
      workflowId: 'wf-exhaust',
      eventType: 'WORKER_RESULT',
      status: 'success',
    })).resolves.not.toThrow();

    expect(mockTx.agentEvent.findFirst).toHaveBeenCalledTimes(5);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[agentTimeline] Exhausted retries appending agent event:',
      p2002Error
    );
  });

  it('unrelated Prisma errors are not retried and are swallowed', async () => {
    mockTx.agentEvent.findFirst.mockResolvedValue({ sequenceNumber: 1 });
    const otherError = new Error('Database connection failed');
    mockTx.agentEvent.create.mockRejectedValueOnce(otherError);

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(appendAgentEvent({
      workflowId: 'wf-other',
      eventType: 'LOOP_COMPLETED',
      status: 'success',
    })).resolves.not.toThrow();

    // Should only attempt once since it's not P2002
    expect(mockTx.agentEvent.findFirst).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[agentTimeline] Failed to append agent event:',
      otherError
    );
  });

  it('getAgentTimeline retrieves events in chronological order', async () => {
    await getAgentTimeline('wf-1');
    expect(prisma.agentEvent.findMany).toHaveBeenCalledWith({
      where: { workflowId: 'wf-1' },
      orderBy: { sequenceNumber: 'asc' },
    });
  });
});
