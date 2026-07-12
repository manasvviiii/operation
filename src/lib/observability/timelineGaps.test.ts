import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAgentLoop } from '../runAgentLoop';
import { planNext } from '../agents/planner';
import { dispatchWorker } from '../agents/workers';
import { POST } from '../../app/api/approvals/[id]/decide/route';
import { TelegramConnector } from '../connectors/telegramConnector';
import { ErpConnector } from '../connectors/erpConnector';
import { withRetry } from '../retry';

import * as agentTimeline from './agentTimeline';
const appendAgentEventSpy = vi.spyOn(agentTimeline, 'appendAgentEvent').mockResolvedValue(undefined);

vi.mock('../prisma', () => ({
  prisma: {
    workflow: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    message: { findMany: vi.fn().mockResolvedValue([]) },
    document: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
    execution: { create: vi.fn().mockResolvedValue({ id: 'exec-1' }), update: vi.fn() },
    agentRun: { create: vi.fn() },
    approval: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  }
}));

vi.mock('../agents/planner', () => ({
  planNext: vi.fn(),
  loadPrompt: vi.fn(),
}));

vi.mock('../agents/workers', () => ({
  dispatchWorker: vi.fn(),
}));

vi.mock('@vercel/functions', () => ({
  waitUntil: vi.fn(),
}));

vi.mock('../retry', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    withRetry: vi.fn(actual.withRetry),
  };
});

vi.mock('../connectors/telegram', () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  normalizeUpdate: vi.fn(),
}));

import { prisma } from '../prisma';
const mockPrisma = prisma as any;

describe('Timeline Gaps Implementation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. existing flow unchanged', () => {
    it('emits LOOP_STARTED -> PLAN_CREATED -> WORKER_DISPATCHED in sequence', async () => {
      mockPrisma.workflow.findUnique.mockResolvedValue({ id: 'w1', state: 'INITIATED', currentStep: 'step', vendorId: 'v1', primaryChannel: 'telegram', vendor: {} });
      mockPrisma.approval.findFirst.mockResolvedValue(null);
      (planNext as any).mockResolvedValue({
        plan: { nextWorker: 'gst_agent', targetState: 'AWAITING_GST', reasoningSummary: 'reason' },
        tokensUsed: 10,
        promptTokens: null,
        completionTokens: null,
        totalTokens: 10,
        estimatedCost: null,
        promptVersion: 'v1',
      });
      (dispatchWorker as any).mockResolvedValue({ success: true, validationPassed: true });

      await runAgentLoop('w1', 'trigger');

      const calls = appendAgentEventSpy.mock.calls;
      const events = calls.map((c: any) => c[0].eventType);
      
      expect(events[0]).toBe('LOOP_STARTED');
      expect(events[1]).toBe('PLAN_CREATED');
      expect(events[2]).toBe('WORKER_DISPATCHED');
    });
  });

  describe('2 & 3. approval emits timeline events', () => {
    it('emits APPROVAL_APPROVED on approval', async () => {
      mockPrisma.approval.findUnique.mockResolvedValue({
        id: 'appr-1', decision: 'PENDING', workflowId: 'w1', workflow: { state: 'PENDING_APPROVAL' }
      });
      
      const req = { json: async () => ({ decision: 'APPROVED', decidedBy: 'admin', reason: 'looks good' }) } as any;
      await POST(req, { params: Promise.resolve({ id: 'appr-1' }) });

      const calls = appendAgentEventSpy.mock.calls;
      expect(calls.some((c: any) => c[0].eventType === 'APPROVAL_APPROVED' && c[0].workflowId === 'w1')).toBe(true);
    });

    it('emits APPROVAL_REJECTED on rejection', async () => {
      mockPrisma.approval.findUnique.mockResolvedValue({
        id: 'appr-1', decision: 'PENDING', workflowId: 'w1', workflow: { state: 'PENDING_APPROVAL' }
      });
      
      const req = { json: async () => ({ decision: 'REJECTED', decidedBy: 'admin', reason: 'nope' }) } as any;
      await POST(req, { params: Promise.resolve({ id: 'appr-1' }) });

      const calls = appendAgentEventSpy.mock.calls;
      expect(calls.some((c: any) => c[0].eventType === 'APPROVAL_REJECTED' && c[0].workflowId === 'w1')).toBe(true);
    });
  });

  describe('4, 5, 8. Connector observability', () => {
    it('emits CONNECTOR_CALL_STARTED and COMPLETED for successful telegram message', async () => {
      (withRetry as any).mockResolvedValue(undefined);
      
      const connector = new TelegramConnector();
      await connector.sendMessage({ channelId: 'c1', text: 'hello', workflowId: 'w1' });

      const calls = appendAgentEventSpy.mock.calls;
      const startEvent = calls.find((c: any) => c[0].eventType === 'CONNECTOR_CALL_STARTED');
      const completeEvent = calls.find((c: any) => c[0].eventType === 'CONNECTOR_CALL_COMPLETED');
      
      expect(startEvent).toBeDefined();
      expect(completeEvent).toBeDefined();
      expect(completeEvent[0].latencyMs).toBeTypeOf('number');
      
      const allArgs = JSON.stringify(calls);
      expect(allArgs).not.toContain('BOT_TOKEN');
    });

    it('emits CONNECTOR_CALL_FAILED for failed erp execution', async () => {
      (withRetry as any).mockRejectedValue(new Error('ERP_TIMEOUT'));
      
      const { ErpConnector: MockedErpConnector } = await import('../connectors/erpConnector');
      const mockErp = new MockedErpConnector();
      await mockErp.execute({ operation: 'createVendorRecord', payload: { workflowId: 'w1' } });
      
      const calls = appendAgentEventSpy.mock.calls;
      const failedEvent = calls.find((c: any) => c[0].eventType === 'CONNECTOR_CALL_FAILED');
      expect(failedEvent).toBeDefined();
      expect(failedEvent[0].error).toBe('ERP_TIMEOUT');
    });
  });

  describe('6 & 7. Planner metadata', () => {
    it('persists token usage when supplied by planNext', async () => {
      mockPrisma.workflow.findUnique.mockResolvedValue({ id: 'w1', state: 'INITIATED', currentStep: 'step', vendorId: 'v1', primaryChannel: 'telegram', vendor: {} });
      mockPrisma.approval.findFirst.mockResolvedValue(null);
      
      (planNext as any).mockResolvedValue({
        plan: { nextWorker: 'gst_agent', targetState: 'AWAITING_GST', reasoningSummary: 'reason' },
        tokensUsed: 1500,
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        estimatedCost: null,
        promptVersion: 'v1',
      });
      (dispatchWorker as any).mockResolvedValue({ success: true, validationPassed: true });

      await runAgentLoop('w1', 'trigger');

      const calls = appendAgentEventSpy.mock.calls;
      const planEvent = calls.find((c: any) => c[0].eventType === 'PLAN_CREATED')[0];
      
      expect(planEvent.promptTokens).toBe(1000);
      expect(planEvent.estimatedCost).toBeNull();
    });

    it('cost remains null when tokens are null', async () => {
      mockPrisma.workflow.findUnique.mockResolvedValue({ id: 'w1', state: 'INITIATED', currentStep: 'step', vendorId: 'v1', primaryChannel: 'telegram', vendor: {} });
      mockPrisma.approval.findFirst.mockResolvedValue(null);
      
      (planNext as any).mockResolvedValue({
        plan: { nextWorker: 'gst_agent', targetState: 'AWAITING_GST', reasoningSummary: 'reason' },
        tokensUsed: 0,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        estimatedCost: null,
        promptVersion: 'v1',
      });
      (dispatchWorker as any).mockResolvedValue({ success: true, validationPassed: true });

      await runAgentLoop('w1', 'trigger');

      const calls = appendAgentEventSpy.mock.calls;
      const planEvent = calls.find((c: any) => c[0].eventType === 'PLAN_CREATED')[0];
      
      expect(planEvent.promptTokens).toBeNull();
      expect(planEvent.estimatedCost).toBeNull();
    });
  });
});
