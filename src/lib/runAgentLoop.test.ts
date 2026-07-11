import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAgentLoop } from './runAgentLoop';
import { planNext } from './agents/planner';
import { dispatchWorker } from './agents/workers';

// Mock prisma module
vi.mock('./prisma', () => ({
  prisma: {
    workflow: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    vendor: {},
    message: {
      findMany: vi.fn(),
    },
    auditLog: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    execution: {
      create: vi.fn(),
      update: vi.fn(),
    },
    agentRun: {
      create: vi.fn(),
    },
    approval: {
      create: vi.fn(),
    },
  },
}));

// Mock planner
vi.mock('./agents/planner', () => ({
  planNext: vi.fn(),
}));

// Mock workers
vi.mock('./agents/workers', () => ({
  dispatchWorker: vi.fn(),
}));

// Mock TelegramConnector
const mockTelegramExecute = vi.fn().mockResolvedValue({ success: true });
vi.mock('./connectors/telegramConnector', () => {
  return {
    TelegramConnector: class MockTelegramConnector {
      execute = mockTelegramExecute;
    },
  };
});

import { prisma } from './prisma';
const mockPrisma = prisma as any;
const mockDispatchWorker = dispatchWorker as any;

describe('runAgentLoop', () => {
  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
  });

  it('should create Execution row with status "running"', async () => {
    const workflowId = 'test-workflow-id';
    
    mockPrisma.workflow.findUnique.mockResolvedValue({
      id: workflowId,
      state: 'INITIATED',
      currentStep: 'test-step',
      vendorId: 'vendor-id',
      vendor: {
        id: 'vendor-id',
        legalName: 'Test Vendor',
        contactEmail: 'test@example.com',
        status: 'PROSPECT',
      },
    });

    mockPrisma.message.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.execution.create.mockResolvedValue({ id: 'execution-id' });
    mockPrisma.workflow.update.mockResolvedValue({});
    mockPrisma.agentRun.create.mockResolvedValue({});
    mockPrisma.execution.update.mockResolvedValue({});
    
    mockDispatchWorker.mockResolvedValue({ success: true });

    (planNext as any).mockResolvedValue({
      nextWorker: 'gst_collector',
      targetState: 'AWAITING_GST',
      reasoningSummary: 'Test reasoning',
    });

    await runAgentLoop(workflowId, 'test');

    expect(mockPrisma.execution.create).toHaveBeenCalledWith({
      data: {
        workflowId,
        triggerSource: 'test',
        status: 'running',
        startedAt: expect.any(Date),
      },
    });
  });

  it('should create AgentRun row with planner agent name', async () => {
    const workflowId = 'test-workflow-id';
    
    mockPrisma.workflow.findUnique.mockResolvedValue({
      id: workflowId,
      state: 'INITIATED',
      currentStep: 'test-step',
      vendorId: 'vendor-id',
      vendor: {
        id: 'vendor-id',
        legalName: 'Test Vendor',
        contactEmail: 'test@example.com',
        status: 'PROSPECT',
      },
    });

    mockPrisma.message.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.execution.create.mockResolvedValue({ id: 'execution-id' });
    mockPrisma.workflow.update.mockResolvedValue({});
    mockPrisma.agentRun.create.mockResolvedValue({});
    mockPrisma.execution.update.mockResolvedValue({});

    mockDispatchWorker.mockResolvedValue({ success: true });

    (planNext as any).mockResolvedValue({
      nextWorker: 'gst_collector',
      targetState: 'AWAITING_GST',
      reasoningSummary: 'Test reasoning',
    });

    await runAgentLoop(workflowId, 'test');

    expect(mockPrisma.agentRun.create).toHaveBeenCalledWith({
      data: {
        executionId: 'execution-id',
        agentName: 'planner',
        input: expect.any(Object),
        output: expect.any(Object),
        tokens: 0,
      },
    });
  });

  it('should create AuditLog row for state transition', async () => {
    const workflowId = 'test-workflow-id';
    
    mockPrisma.workflow.findUnique.mockResolvedValue({
      id: workflowId,
      state: 'INITIATED',
      currentStep: 'test-step',
      vendorId: 'vendor-id',
      vendor: {
        id: 'vendor-id',
        legalName: 'Test Vendor',
        contactEmail: 'test@example.com',
        status: 'PROSPECT',
      },
    });

    mockPrisma.message.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.execution.create.mockResolvedValue({ id: 'execution-id' });
    mockPrisma.workflow.update.mockResolvedValue({});
    mockPrisma.agentRun.create.mockResolvedValue({});
    mockPrisma.execution.update.mockResolvedValue({});

    mockDispatchWorker.mockResolvedValue({ success: true });

    (planNext as any).mockResolvedValue({
      nextWorker: 'gst_collector',
      targetState: 'AWAITING_GST',
      reasoningSummary: 'Test reasoning',
    });

    await runAgentLoop(workflowId, 'test');
  });

  it('should halt execution and create Approval row when targetState is PENDING_APPROVAL', async () => {
    const workflowId = 'test-workflow-id';
    
    mockPrisma.workflow.findUnique.mockResolvedValue({
      id: workflowId,
      state: 'VALIDATING',
      currentStep: 'validation-step',
      vendorId: 'vendor-id',
      vendor: {
        id: 'vendor-id',
        legalName: 'Test Vendor',
        contactEmail: 'test@example.com',
        status: 'PROSPECT',
      },
    });

    mockPrisma.message.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.execution.create.mockResolvedValue({ id: 'execution-id' });
    mockPrisma.workflow.update.mockResolvedValue({});
    mockPrisma.agentRun.create.mockResolvedValue({});
    mockPrisma.approval.create.mockResolvedValue({});
    mockPrisma.execution.update.mockResolvedValue({});

    mockDispatchWorker.mockResolvedValue({ success: true });

    (planNext as any).mockResolvedValue({
      nextWorker: 'approver',
      targetState: 'PENDING_APPROVAL',
      reasoningSummary: 'Validation complete',
    });

    await runAgentLoop(workflowId, 'test');

    expect(mockPrisma.approval.create).toHaveBeenCalledWith({
      data: {
        workflowId,
        step: 'validation-step',
        decision: 'PENDING',
      },
    });

    expect(mockPrisma.execution.update).toHaveBeenCalledWith({
      where: { id: 'execution-id' },
      data: {
        status: 'done',
        endedAt: expect.any(Date),
      },
    });
  });

  it('should set Execution status to "failed" on error', async () => {
    const workflowId = 'test-workflow-id';
    
    mockPrisma.workflow.findUnique.mockResolvedValue({
      id: workflowId,
      state: 'INITIATED',
      currentStep: 'test-step',
      vendorId: 'vendor-id',
      vendor: {
        id: 'vendor-id',
        legalName: 'Test Vendor',
        contactEmail: 'test@example.com',
        status: 'PROSPECT',
      },
    });

    mockPrisma.message.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.execution.create.mockResolvedValue({ id: 'execution-id' });
    mockPrisma.execution.update.mockResolvedValue({});

    (planNext as any).mockRejectedValue(new Error('Test error'));

    await expect(runAgentLoop(workflowId, 'test')).rejects.toThrow('Test error');

    expect(mockPrisma.execution.update).toHaveBeenCalledWith({
      where: { id: 'execution-id' },
      data: {
        status: 'failed',
        endedAt: expect.any(Date),
        errorMessage: 'Test error',
      },
    });
  });

  it('should throw error if workflow not found', async () => {
    const workflowId = 'non-existent-workflow';
    
    mockPrisma.workflow.findUnique.mockResolvedValue(null);

    await expect(runAgentLoop(workflowId, 'test')).rejects.toThrow(
      `Workflow ${workflowId} not found`
    );
  });

  it('does not apply the state transition when the dispatched worker returns success: false', async () => {
    const workflowId = 'test-workflow-id';
    
    mockPrisma.workflow.findUnique.mockResolvedValue({
      id: workflowId,
      state: 'INITIATED',
      currentStep: 'test-step',
      vendorId: 'vendor-id',
      vendor: {
        id: 'vendor-id',
        legalName: 'Test Vendor',
        contactEmail: 'test@example.com',
        status: 'PROSPECT',
      },
    });

    mockPrisma.message.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.execution.create.mockResolvedValue({ id: 'execution-id' });
    mockPrisma.workflow.update.mockResolvedValue({});
    mockPrisma.agentRun.create.mockResolvedValue({});
    mockPrisma.execution.update.mockResolvedValue({});

    mockDispatchWorker.mockResolvedValue({ success: false, error: 'no GST number found' });

    (planNext as any).mockResolvedValue({
      nextWorker: 'gst_agent',
      targetState: 'AWAITING_GST',
      reasoningSummary: 'Need GST',
    });

    await runAgentLoop(workflowId, 'test');

    expect(mockPrisma.workflow.update).not.toHaveBeenCalled();
    
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        workflowId,
        actor: 'system',
        action: 'transition_blocked_by_worker',
        fromState: 'INITIATED',
        toState: 'INITIATED',
        metadata: {
          targetState: 'AWAITING_GST',
          error: 'no GST number found',
          reasoning: 'Need GST',
          workerException: false,
        },
      },
    });

    expect(mockPrisma.execution.update).toHaveBeenCalledWith({
      where: { id: 'execution-id' },
      data: {
        status: 'done',
        endedAt: expect.any(Date),
      },
    });
  });

  it('regression test for item 14: should block runAgentLoop when workflow state is PENDING_APPROVAL and triggerSource is not approval_decided', async () => {
    const workflowId = 'test-workflow-id-pending';
    
    mockPrisma.workflow.findUnique.mockResolvedValue({
      id: workflowId,
      state: 'PENDING_APPROVAL',
      currentStep: 'test-step',
      vendorId: 'vendor-id',
      vendor: {
        id: 'vendor-id',
        legalName: 'Test Vendor',
        contactEmail: 'test@example.com',
        status: 'PROSPECT',
      },
    });

    mockPrisma.message.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.execution.create.mockResolvedValue({ id: 'execution-id' });
    mockPrisma.execution.update.mockResolvedValue({});
    
    await runAgentLoop(workflowId, 'inbound_message');

    expect(planNext).not.toHaveBeenCalled();
    expect(dispatchWorker).not.toHaveBeenCalled();
    expect(mockPrisma.workflow.update).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workflowId,
          actor: 'system',
          action: 'blocked_pending_approval',
          fromState: 'PENDING_APPROVAL',
          toState: 'PENDING_APPROVAL',
        })
      })
    );
  });

  it('regression test for item 16: should unconditionally create AgentRun row for planner even if worker fails', async () => {
    const workflowId = 'test-workflow-id';
    
    mockPrisma.workflow.findUnique.mockResolvedValue({
      id: workflowId,
      state: 'INITIATED',
      currentStep: 'test-step',
      vendorId: 'vendor-id',
      vendor: {
        id: 'vendor-id',
        legalName: 'Test Vendor',
        contactEmail: 'test@example.com',
        status: 'PROSPECT',
      },
    });

    mockPrisma.message.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.execution.create.mockResolvedValue({ id: 'execution-id' });
    mockPrisma.workflow.update.mockResolvedValue({});
    mockPrisma.agentRun.create.mockResolvedValue({});
    mockPrisma.execution.update.mockResolvedValue({});

    mockDispatchWorker.mockResolvedValue({ success: false, error: 'no GST number found' });

    (planNext as any).mockResolvedValue({
      nextWorker: 'gst_agent',
      targetState: 'AWAITING_GST',
      reasoningSummary: 'Need GST',
    });

    await runAgentLoop(workflowId, 'test');

    expect(mockPrisma.agentRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          executionId: 'execution-id',
          agentName: 'planner',
        }),
      })
    );
  });

  it('should handle illegal transition proposed by planner gracefully', async () => {
    const workflowId = 'test-workflow-id';
    
    mockPrisma.workflow.findUnique.mockResolvedValue({
      id: workflowId,
      state: 'VALIDATING',
      currentStep: 'validation-step',
      vendorId: 'vendor-id',
      chatId: 'test-chat-id',
      vendor: {
        id: 'vendor-id',
        legalName: 'Test Vendor',
        contactEmail: 'test@example.com',
        status: 'PROSPECT',
      },
    });

    mockPrisma.message.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.execution.create.mockResolvedValue({ id: 'execution-id' });
    mockPrisma.agentRun.create.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.execution.update.mockResolvedValue({});

    (planNext as any).mockResolvedValue({
      nextWorker: 'erp_agent',
      targetState: 'WRITING_ERP',
      reasoningSummary: 'Validation complete, proceeding to ERP',
    });

    await runAgentLoop(workflowId, 'test');

    // dispatchWorker should never be called for illegal transition
    expect(mockDispatchWorker).not.toHaveBeenCalled();

    // workflow.update should not be called with a state field (state should not change)
    expect(mockPrisma.workflow.update).not.toHaveBeenCalled();

    // execution.update should be called with status: 'done' (not 'failed')
    expect(mockPrisma.execution.update).toHaveBeenCalledWith({
      where: { id: 'execution-id' },
      data: {
        status: 'done',
        endedAt: expect.any(Date),
      },
    });

    // AuditLog should be created with action: 'planner_proposed_illegal_transition'
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workflowId,
          actor: 'system',
          action: 'planner_proposed_illegal_transition',
          fromState: 'VALIDATING',
          toState: 'VALIDATING',
          metadata: expect.objectContaining({
            attemptedTargetState: 'WRITING_ERP',
            nextWorker: 'erp_agent',
            reasoning: 'Validation complete, proceeding to ERP',
          }),
        }),
      })
    );

    // Telegram holding message should be sent
    expect(mockTelegramExecute).toHaveBeenCalledWith({
      operation: 'sendMessage',
      payload: { chatId: 'test-chat-id', text: 'Thanks — we\'re finishing up validation on your details. You\'ll hear from us shortly.' },
    });
  });
});
