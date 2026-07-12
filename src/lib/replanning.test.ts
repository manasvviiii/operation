import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAgentLoop } from './runAgentLoop';
import { prisma } from './prisma';
import { planNext } from './agents/planner';
import { dispatchWorker } from './agents/workers';
import { getConnector } from './connectors/registry';
import { appendAgentEvent } from './observability/agentTimeline';

vi.mock('./agents/planner', () => ({
  planNext: vi.fn(),
}));

vi.mock('./agents/workers', () => ({
  dispatchWorker: vi.fn(),
}));

vi.mock('./connectors/registry', () => ({
  getConnector: vi.fn(),
}));

vi.mock('./observability/agentTimeline', () => ({
  appendAgentEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./prisma', () => ({
  prisma: {
    workflow: { findUnique: vi.fn(), update: vi.fn() },
    message: { findMany: vi.fn() },
    document: { findMany: vi.fn() },
    auditLog: { findMany: vi.fn(), create: vi.fn() },
    execution: { create: vi.fn(), update: vi.fn() },
    agentRun: { create: vi.fn() },
  },
}));

describe('Bounded Failure-Aware Replanning', () => {
  let mockConnector: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConnector = { sendMessage: vi.fn() };
    (getConnector as any).mockReturnValue(mockConnector);

    (prisma.workflow.findUnique as any).mockResolvedValue({
      id: 'w1',
      state: 'INITIATED',
      currentStep: 'test',
      vendorId: 'v1',
      primaryChannel: 'telegram',
      vendor: { id: 'v1', legalName: 'Test Vendor' },
      extractedFields: {},
    });
    (prisma.message.findMany as any).mockResolvedValue([]);
    (prisma.document.findMany as any).mockResolvedValue([]);
    (prisma.auditLog.findMany as any).mockResolvedValue([]);
    (prisma.execution.create as any).mockResolvedValue({ id: 'exec1' });
    (prisma.execution.update as any).mockResolvedValue({});
    (prisma.agentRun.create as any).mockResolvedValue({});
  });

  it('1-4. Operational failure triggers EXACTLY ONE replan, passes failure context, respects timeline ordering, and executes corrected plan', async () => {
    // First plan
    (planNext as any).mockResolvedValueOnce({
      plan: { nextWorker: 'gst_agent', targetState: 'AWAITING_GST', reasoningSummary: 'First try' },
      tokensUsed: 10,
    });
    // First dispatch throws operational error
    (dispatchWorker as any).mockRejectedValueOnce(new Error('Failed due to token bot123:abc-def-ghi'));

    // Second plan (the correction)
    (planNext as any).mockResolvedValueOnce({
      plan: { nextWorker: 'doc_agent', targetState: 'AWAITING_GST', reasoningSummary: 'Recovery try' },
      tokensUsed: 15,
    });
    // Second dispatch succeeds
    (dispatchWorker as any).mockResolvedValueOnce({ success: true, validationPassed: true });

    await runAgentLoop('w1', 'trigger');

    // planNext was called twice
    expect(planNext).toHaveBeenCalledTimes(2);

    // Context passed to second planNext has failureContext
    const secondCallCtx = (planNext as any).mock.calls[1][0];
    expect(secondCallCtx.failureContext).toBeDefined();
    expect(secondCallCtx.failureContext.failedWorker).toBe('gst_agent');
    expect(secondCallCtx.failureContext.attemptNumber).toBe(1);
    
    // Timeline assertions (ignoring LOOP_STARTED)
    const events = (appendAgentEvent as any).mock.calls.map((c: any) => c[0].eventType);
    
    // Order should contain PLAN_CREATED -> WORKER_DISPATCHED -> WORKER_RESULT(failed) -> REPLAN_REQUESTED -> PLAN_CREATED
    const plan1Idx = events.indexOf('PLAN_CREATED');
    const disp1Idx = events.indexOf('WORKER_DISPATCHED');
    const res1Idx = events.indexOf('WORKER_RESULT');
    const replanIdx = events.indexOf('REPLAN_REQUESTED');
    const plan2Idx = events.lastIndexOf('PLAN_CREATED');
    const disp2Idx = events.lastIndexOf('WORKER_DISPATCHED');

    expect(plan1Idx).toBeLessThan(disp1Idx);
    expect(disp1Idx).toBeLessThan(res1Idx);
    expect(res1Idx).toBeLessThan(replanIdx);
    expect(replanIdx).toBeLessThan(plan2Idx);
    expect(plan2Idx).toBeLessThan(disp2Idx);
    
    // Check redaction boundary was used
    const replanEvent = (appendAgentEvent as any).mock.calls[replanIdx][0];
    expect(replanEvent.reasoningSummary).toBeDefined();
  });

  it('5. Happy paths do not replan', async () => {
    (planNext as any).mockResolvedValueOnce({
      plan: { nextWorker: 'gst_agent', targetState: 'AWAITING_GST', reasoningSummary: 'First try' },
      tokensUsed: 10,
    });
    (dispatchWorker as any).mockResolvedValueOnce({ success: true, validationPassed: true });

    await runAgentLoop('w1', 'trigger');

    expect(planNext).toHaveBeenCalledTimes(1);
    expect(dispatchWorker).toHaveBeenCalledTimes(1);
    const events = (appendAgentEvent as any).mock.calls.map((c: any) => c[0].eventType);
    expect(events).not.toContain('REPLAN_REQUESTED');
  });

  it('6. Normal structured document validation failure preserves existing behavior and does NOT invoke failure re-planning', async () => {
    (planNext as any).mockResolvedValueOnce({
      plan: { nextWorker: 'gst_agent', targetState: 'AWAITING_GST', reasoningSummary: 'First try' },
      tokensUsed: 10,
    });
    // Worker executes normally but validation fails!
    (dispatchWorker as any).mockResolvedValueOnce({ success: true, validationPassed: false, error: 'Document blurry' });

    await runAgentLoop('w1', 'trigger');

    expect(planNext).toHaveBeenCalledTimes(1);
    const events = (appendAgentEvent as any).mock.calls.map((c: any) => c[0].eventType);
    expect(events).not.toContain('REPLAN_REQUESTED');
    expect(events).toContain('VALIDATION_FAILED');
  });

  it('7. If the corrected worker/action fails, no third plan is requested (bounded)', async () => {
    (planNext as any).mockResolvedValue({
      plan: { nextWorker: 'gst_agent', targetState: 'AWAITING_GST', reasoningSummary: 'Try' },
      tokensUsed: 10,
    });
    // Fails twice
    (dispatchWorker as any).mockRejectedValue(new Error('Boom'));

    await runAgentLoop('w1', 'trigger');

    expect(planNext).toHaveBeenCalledTimes(2); // 1 original + 1 replan
    expect(dispatchWorker).toHaveBeenCalledTimes(2); // 1 original + 1 replan
  });

  it('8. First worker throws, corrected worker succeeds, execution is not marked failed', async () => {
    // Attempt 1: Operational failure
    (planNext as any).mockResolvedValueOnce({
      plan: { nextWorker: 'gst_agent', targetState: 'AWAITING_GST', reasoningSummary: 'First plan' },
      tokensUsed: 10,
    });
    (dispatchWorker as any).mockRejectedValueOnce(new Error('Operational hiccup'));

    // Attempt 2: Success
    (planNext as any).mockResolvedValueOnce({
      plan: { nextWorker: 'doc_agent', targetState: 'AWAITING_GST', reasoningSummary: 'Corrected plan' },
      tokensUsed: 10,
    });
    (dispatchWorker as any).mockResolvedValueOnce({ success: true, validationPassed: true });

    await runAgentLoop('w1', 'trigger');

    expect(planNext).toHaveBeenCalledTimes(2);
    expect(dispatchWorker).toHaveBeenCalledTimes(2);
    
    // Find all execution.update calls
    const updateCalls = (prisma.execution.update as any).mock.calls;
    const failedUpdates = updateCalls.filter((call: any) => call[0].data.status === 'failed');
    expect(failedUpdates.length).toBe(0); // Should not mark execution as failed!

    const events = (appendAgentEvent as any).mock.calls.map((c: any) => c[0].eventType);
    
    const plan1Idx = events.indexOf('PLAN_CREATED');
    const disp1Idx = events.indexOf('WORKER_DISPATCHED');
    const replanIdx = events.indexOf('REPLAN_REQUESTED');
    const plan2Idx = events.lastIndexOf('PLAN_CREATED');
    const disp2Idx = events.lastIndexOf('WORKER_DISPATCHED');
    const valPassedIdx = events.indexOf('VALIDATION_PASSED');

    // canonical failed worker event is WORKER_RESULT with status='failed'
    const workerResultEvents = (appendAgentEvent as any).mock.calls.filter((c: any) => c[0].eventType === 'WORKER_RESULT');
    expect(workerResultEvents.length).toBe(2);
    expect(workerResultEvents[0][0].status).toBe('failed');
    expect(workerResultEvents[1][0].status).toBe('success');

    expect(events.filter((e: string) => e === 'REPLAN_REQUESTED').length).toBe(1);
    
    expect(plan1Idx).toBeLessThan(disp1Idx);
    expect(disp1Idx).toBeLessThan(replanIdx);
    expect(replanIdx).toBeLessThan(plan2Idx);
    expect(plan2Idx).toBeLessThan(disp2Idx);
    expect(disp2Idx).toBeLessThan(valPassedIdx);
  });
});
