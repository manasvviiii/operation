import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAgentLoop } from './runAgentLoop';
import { planNext } from './agents/planner';
import { dispatchWorker } from './agents/workers';

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
    document: {
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
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('./agents/planner', () => ({
  planNext: vi.fn(),
}));

vi.mock('./agents/workers', () => ({
  dispatchWorker: vi.fn(),
}));

vi.mock('./observability/agentTimeline', () => ({
  appendAgentEvent: vi.fn(),
}));

const mockSendMessage = vi
  .fn()
  .mockResolvedValue({ success: true });

vi.mock('./connectors/registry', () => {
  return {
    getConnector: vi.fn(() => ({
      sendMessage: mockSendMessage,
      handleInbound: vi.fn(),
      downloadAttachment: vi.fn(),
    })),
  };
});

import { prisma } from './prisma';

const mockPrisma = prisma as any;
const mockDispatchWorker = dispatchWorker as any;
const mockPlanNext = planNext as any;

function createWorkflow(
  overrides: Record<string, unknown> = {}
) {
  return {
    id: 'test-workflow-id',
    state: 'INITIATED',
    currentStep: 'test-step',
    vendorId: 'vendor-id',
    chatId: null,
    primaryChannel: 'telegram',
    extractedFields: {},
    vendor: {
      id: 'vendor-id',
      legalName: 'Test Vendor',
      contactEmail: 'test@example.com',
      status: 'PROSPECT',
    },
    ...overrides,
  };
}

function createVerifiedDocument(
  overrides: Record<string, unknown> = {}
) {
  return {
    id: 'document-id',
    type: 'document',
    category: 'GST_CERTIFICATE',
    originalFilename: 'document.pdf',
    fileSize: 1024,
    mime: 'application/pdf',
    storageUrl: 'https://example.com/document.pdf',
    validationStatus: 'passed',
    verified: true,
    extractedFields: {},
    confidence: 0.95,
    uploadedAt: new Date(),
    ...overrides,
  };
}

describe('runAgentLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma.message.findMany.mockResolvedValue([]);
    mockPrisma.document.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);

    mockPrisma.execution.create.mockResolvedValue({
      id: 'execution-id',
    });

    mockPrisma.execution.update.mockResolvedValue({});
    mockPrisma.workflow.update.mockResolvedValue({});
    mockPrisma.agentRun.create.mockResolvedValue({});

    mockPrisma.approval.findFirst.mockResolvedValue(null);
    mockPrisma.approval.create.mockResolvedValue({});

    mockDispatchWorker.mockResolvedValue({
      success: true,
      validationPassed: true,
    });
  });

  it('should create Execution row with status "running"', async () => {
    const workflowId = 'test-workflow-id';

    mockPrisma.workflow.findUnique.mockResolvedValue(
      createWorkflow()
    );

    mockPlanNext.mockResolvedValue({
      nextWorker: 'gst_collector',
      targetState: 'AWAITING_GST',
      reasoningSummary: 'Test reasoning',
    });

    await runAgentLoop(workflowId, 'test');

    expect(
      mockPrisma.execution.create
    ).toHaveBeenCalledWith({
      data: {
        workflowId,
        triggerSource: 'test',
        status: 'running',
        startedAt: expect.any(Date),
      },
    });
  });

  it('should create AgentRun row with planner agent name', async () => {
    mockPrisma.workflow.findUnique.mockResolvedValue(
      createWorkflow()
    );

    mockPlanNext.mockResolvedValue({
      nextWorker: 'gst_collector',
      targetState: 'AWAITING_GST',
      reasoningSummary: 'Test reasoning',
    });

    await runAgentLoop('test-workflow-id', 'test');

    expect(
      mockPrisma.agentRun.create
    ).toHaveBeenCalledWith({
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
    mockPrisma.workflow.findUnique.mockResolvedValue(
      createWorkflow()
    );

    mockPlanNext.mockResolvedValue({
      nextWorker: 'gst_collector',
      targetState: 'AWAITING_GST',
      reasoningSummary: 'Test reasoning',
    });

    await runAgentLoop('test-workflow-id', 'test');

    expect(
      mockPrisma.auditLog.create
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workflowId: 'test-workflow-id',
          actor: 'system',
          action: 'state_transition',
          fromState: 'INITIATED',
          toState: 'AWAITING_GST',
        }),
      })
    );
  });

  it('should create Approval row when validated workflow transitions to PENDING_APPROVAL', async () => {
    const workflowId = 'test-workflow-id';

    mockPrisma.workflow.findUnique.mockResolvedValue(
      createWorkflow({
        state: 'VALIDATING',
        currentStep: 'validation-step',
        extractedFields: {
          gstin: '22AAAAA0000A1Z5',
          panNumber: 'ABCDE1234F',
          ifsc: 'SBIN0001234',
          accountNumber: '123456789012',
          companyNameMatch: true,
        },
      })
    );

    mockPrisma.document.findMany.mockResolvedValue([
      createVerifiedDocument({
        id: 'gst-document',
        category: 'GST_CERTIFICATE',
      }),
      createVerifiedDocument({
        id: 'bank-document',
        category: 'BANK_PROOF',
      }),
      createVerifiedDocument({
        id: 'incorporation-document',
        category: 'INCORPORATION_PROOF',
      }),
      createVerifiedDocument({
        id: 'agreement-document',
        category: 'VENDOR_AGREEMENT',
      }),
    ]);

    mockDispatchWorker.mockResolvedValue({
      success: true,
      validationPassed: true,
    });
    mockPlanNext.mockResolvedValue({
      nextWorker: 'approver',
      targetState: 'PENDING_APPROVAL',
      reasoningSummary: 'Validation complete',
    });

    await runAgentLoop(workflowId, 'test');

    const { appendAgentEvent } = await import('./observability/agentTimeline');
    const calls = (appendAgentEvent as any).mock.calls;
    const eventTypes = calls.map((c: any) => c[0].eventType);
    
    expect(eventTypes).toEqual([
      'LOOP_STARTED',
      'PLAN_CREATED',
      'WORKER_DISPATCHED',
      'WORKER_RESULT',
      'VALIDATION_PASSED',
      'STATE_TRANSITION',
      'LOOP_COMPLETED'
    ]);

    expect(
      mockPrisma.approval.create
    ).toHaveBeenCalledWith({
      data: {
        workflowId,
        step: 'validation-step',
        decision: 'PENDING',
      },
    });

    expect(
      mockPrisma.execution.update
    ).toHaveBeenCalledWith({
      where: {
        id: 'execution-id',
      },
      data: {
        status: 'done',
        endedAt: expect.any(Date),
      },
    });
  });

  it('should set Execution status to "failed" on error', async () => {
    const workflowId = 'test-workflow-id';

    mockPrisma.workflow.findUnique.mockResolvedValue(
      createWorkflow()
    );

    mockPlanNext.mockRejectedValue(
      new Error('Test error')
    );

    await expect(
      runAgentLoop(workflowId, 'test')
    ).rejects.toThrow('Test error');

    expect(
      mockPrisma.execution.update
    ).toHaveBeenCalledWith({
      where: {
        id: 'execution-id',
      },
      data: {
        status: 'failed',
        endedAt: expect.any(Date),
        errorMessage: 'Test error',
      },
    });
  });

  it('should throw error if workflow not found', async () => {
    const workflowId = 'non-existent-workflow';

    mockPrisma.workflow.findUnique.mockResolvedValue(
      null
    );

    await expect(
      runAgentLoop(workflowId, 'test')
    ).rejects.toThrow(
      `Workflow ${workflowId} not found`
    );
  });

  it('does not apply state transition when worker returns success false', async () => {
    const workflowId = 'test-workflow-id';

    mockPrisma.workflow.findUnique.mockResolvedValue(
      createWorkflow()
    );

    mockDispatchWorker.mockResolvedValue({
      success: false,
      validationPassed: false,
      error: 'no GST number found',
      retryable: true,
    });

    mockPlanNext.mockResolvedValue({
      nextWorker: 'gst_agent',
      targetState: 'AWAITING_GST',
      reasoningSummary: 'Need GST',
    });

    await runAgentLoop(workflowId, 'test');

    expect(
      mockPrisma.workflow.update
    ).not.toHaveBeenCalled();

    expect(
      mockPrisma.auditLog.create
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workflowId,
          actor: 'system',
          action: 'transition_blocked_by_worker',
          fromState: 'INITIATED',
          toState: 'INITIATED',
          metadata: expect.objectContaining({
            attemptedTargetState: 'AWAITING_GST',
            worker: 'gst_agent',
            error: 'no GST number found',
            retryable: true,
            workerException: false,
          }),
        }),
      })
    );

    expect(
      mockPrisma.execution.update
    ).toHaveBeenCalledWith({
      where: {
        id: 'execution-id',
      },
      data: {
        status: 'failed',
        endedAt: expect.any(Date),
        errorMessage: 'no GST number found',
      },
    });
  });

  it('blocks transition when worker validation fails', async () => {
    const workflowId = 'test-workflow-id';

    mockPrisma.workflow.findUnique.mockResolvedValue(
      createWorkflow({
        state: 'AWAITING_GST',
        chatId: 'test-chat-id',
      })
    );

    mockDispatchWorker.mockResolvedValue({
      success: true,
      validationPassed: false,
      outboundMessage:
        'Please upload a valid GST certificate.',
      retryable: true,
    });

    mockPlanNext.mockResolvedValue({
      nextWorker: 'gst_agent',
      targetState: 'AWAITING_PAN',
      reasoningSummary: 'Validate GST',
    });

    await runAgentLoop(workflowId, 'test');

    expect(
      mockPrisma.workflow.update
    ).not.toHaveBeenCalled();

    expect(
      mockPrisma.auditLog.create
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workflowId,
          action:
            'transition_blocked_by_validation',
          fromState: 'AWAITING_GST',
          toState: 'AWAITING_GST',
        }),
      })
    );

    expect(
      mockSendMessage
    ).toHaveBeenCalledWith({
      channelId: 'test-chat-id',
      text:
        'Please upload a valid GST certificate.',
    });

    expect(
      mockPrisma.execution.update
    ).toHaveBeenCalledWith({
      where: {
        id: 'execution-id',
      },
      data: {
        status: 'done',
        endedAt: expect.any(Date),
      },
    });
  });

  it('blocks runAgentLoop when workflow is PENDING_APPROVAL and trigger is not approval_decided', async () => {
    const workflowId =
      'test-workflow-id-pending';

    mockPrisma.workflow.findUnique.mockResolvedValue(
      createWorkflow({
        id: workflowId,
        state: 'PENDING_APPROVAL',
        chatId: 'test-chat-id',
      })
    );

    await runAgentLoop(
      workflowId,
      'inbound_message'
    );

    expect(planNext).not.toHaveBeenCalled();

    expect(dispatchWorker).not.toHaveBeenCalled();

    expect(
      mockPrisma.workflow.update
    ).not.toHaveBeenCalled();

    expect(
      mockPrisma.auditLog.create
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workflowId,
          actor: 'system',
          action: 'blocked_pending_approval',
          fromState: 'PENDING_APPROVAL',
          toState: 'PENDING_APPROVAL',
        }),
      })
    );

    expect(
      mockSendMessage
    ).toHaveBeenCalledWith({
      channelId: 'test-chat-id',
      text:
        "Your onboarding packet is under review. You don't need to do anything — I'll message you here when there's an update.",
    });
  });

  it('should unconditionally create planner AgentRun even if worker fails', async () => {
    mockPrisma.workflow.findUnique.mockResolvedValue(
      createWorkflow()
    );

    mockDispatchWorker.mockResolvedValue({
      success: false,
      validationPassed: false,
      error: 'no GST number found',
      retryable: true,
    });

    mockPlanNext.mockResolvedValue({
      nextWorker: 'gst_agent',
      targetState: 'AWAITING_GST',
      reasoningSummary: 'Need GST',
    });

    await runAgentLoop(
      'test-workflow-id',
      'test'
    );

    expect(
      mockPrisma.agentRun.create
    ).toHaveBeenCalledWith(
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

    mockPrisma.workflow.findUnique.mockResolvedValue(
      createWorkflow({
        state: 'VALIDATING',
        currentStep: 'validation-step',
        chatId: 'test-chat-id',
      })
    );

    mockPrisma.approval.findFirst.mockResolvedValue({ id: 'appr-1' });

    mockDispatchWorker.mockResolvedValue({
      success: true,
      validationPassed: true,
      outboundMessage:
        "Thanks — we're finishing up validation on your details. You'll hear from us shortly.",
    });

    mockPlanNext.mockResolvedValue({
      nextWorker: 'erp_agent',
      targetState: 'WRITING_ERP',
      reasoningSummary:
        'Validation complete, proceeding to ERP',
    });

    await runAgentLoop(workflowId, 'test');

    expect(
      mockDispatchWorker
    ).toHaveBeenCalled();

    expect(
      mockPrisma.workflow.update
    ).toHaveBeenCalledWith({
      where: {
        id: workflowId,
      },
      data: {
        state: 'VALIDATING',
        extractedFields: {},
      },
    });

    expect(
      mockPrisma.execution.update
    ).toHaveBeenCalledWith({
      where: {
        id: 'execution-id',
      },
      data: {
        status: 'done',
        endedAt: expect.any(Date),
      },
    });

    expect(
      mockPrisma.auditLog.create
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workflowId,
          actor: 'system',
          action:
            'planner_proposed_illegal_transition',
          fromState: 'VALIDATING',
          toState: 'VALIDATING',
          metadata: expect.objectContaining({
            attemptedTargetState: 'WRITING_ERP',
            nextWorker: 'erp_agent',
            reasoning:
              'Validation complete, proceeding to ERP',
          }),
        }),
      })
    );

    expect(
      mockSendMessage
    ).toHaveBeenCalledWith({
      channelId: 'test-chat-id',
      text:
        "Thanks — we're finishing up validation on your details. You'll hear from us shortly.",
    });
  });

  it('COMPLETED workflow does not call planner or dispatch workers', async () => {
    mockPrisma.workflow.findUnique.mockResolvedValue(
      createWorkflow({
        state: 'COMPLETED',
        chatId: 'chat-999',
      })
    );

    await runAgentLoop('test-workflow-id', 'inbound_message');

    expect(mockPlanNext).not.toHaveBeenCalled();
    expect(mockDispatchWorker).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith({
      channelId: 'chat-999',
      text: expect.stringContaining('already complete'),
    });
  });

  it('ERP worker rejects execution without APPROVED approval (hard guard)', async () => {
    mockPrisma.workflow.findUnique.mockResolvedValue(
      createWorkflow({
        state: 'WRITING_ERP',
      })
    );

    mockPrisma.approval.findFirst.mockResolvedValue(null); // No approval

    await expect(runAgentLoop('test-workflow-id', 'test')).rejects.toThrow(/APPROVED human decision/);
    expect(mockDispatchWorker).not.toHaveBeenCalled();
  });

  describe('Deterministic ERP execution after approval', () => {
    it('approving PENDING_APPROVAL triggers ERP processing and advances to COMPLETED', async () => {
      mockPrisma.workflow.findUnique.mockResolvedValue(
        createWorkflow({
          state: 'WRITING_ERP',
        })
      );

      mockPrisma.approval.findFirst.mockResolvedValue({ id: 'appr-1', decision: 'APPROVED' });

      mockDispatchWorker.mockResolvedValue({
        success: true,
        validationPassed: true,
        extractedData: { vendorCode: 'ABC-VND-123' },
      });

      await runAgentLoop('test-workflow-id', 'approval_decided');

      // The loop must deterministically bypass planner and dispatch erp_agent
      expect(mockPlanNext).not.toHaveBeenCalled();
      expect(mockDispatchWorker).toHaveBeenCalledWith('erp_agent', expect.any(Object));

      // The loop must transition state to COMPLETED
      expect(mockPrisma.workflow.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'test-workflow-id' },
          data: expect.objectContaining({
            state: 'COMPLETED',
            extractedFields: expect.objectContaining({ vendorCode: 'ABC-VND-123' }),
          }),
        })
      );
    });

    it('ERP failure does not mark workflow COMPLETED and is recoverable/retryable', async () => {
      mockPrisma.workflow.findUnique.mockResolvedValue(
        createWorkflow({
          state: 'WRITING_ERP',
        })
      );

      mockPrisma.approval.findFirst.mockResolvedValue({ id: 'appr-1', decision: 'APPROVED' });

      mockDispatchWorker.mockResolvedValue({
        success: false,
        validationPassed: false,
        retryable: true,
        error: 'ERP system timeout',
      });

      await runAgentLoop('test-workflow-id', 'approval_decided');

      // Dispatch happens
      expect(mockDispatchWorker).toHaveBeenCalledWith('erp_agent', expect.any(Object));

      // Workflow remains in WRITING_ERP (the test mock returns undefined for the final workflow.update if validation fails earlier)
      expect(mockPrisma.workflow.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ state: 'COMPLETED' }),
        })
      );
    });
  });

  it('Test A & B: Pending GST document fast-forwards INITIATED to AWAITING_GST and advances to AWAITING_PAN on success', async () => {
    mockPrisma.workflow.findUnique.mockResolvedValue(
      createWorkflow({
        state: 'INITIATED',
      })
    );

    mockPrisma.document.findMany
      .mockResolvedValueOnce([
        createVerifiedDocument({
          id: 'pending-gst',
          verified: false,
          validationStatus: 'pending',
        }),
      ])
      .mockResolvedValueOnce([
        createVerifiedDocument({
          id: 'pending-gst',
          verified: true,
          validationStatus: 'passed',
        }),
      ]);

    mockDispatchWorker.mockResolvedValue({
      success: true,
      validationPassed: true,
      extractedData: { gstin: '27ABCDE1234F1Z5' },
    });

    await runAgentLoop('test-workflow-id', 'test');

    // Fast-forward check
    expect(mockPrisma.workflow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'test-workflow-id' },
        data: expect.objectContaining({ state: 'AWAITING_GST' }),
      })
    );

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'state_transition_fast_forward',
          fromState: 'INITIATED',
          toState: 'AWAITING_GST',
        }),
      })
    );

    // Final state check
    expect(mockPrisma.workflow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'test-workflow-id' },
        data: expect.objectContaining({
          state: 'AWAITING_PAN',
          extractedFields: expect.any(Object),
        }),
      })
    );

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'state_transition',
          fromState: 'AWAITING_GST',
          toState: 'AWAITING_PAN',
        }),
      })
    );
  });

  it('Test C: GST validation failure must not advance to AWAITING_PAN', async () => {
    mockPrisma.workflow.findUnique.mockResolvedValue(
      createWorkflow({
        state: 'AWAITING_GST',
      })
    );

    mockPrisma.document.findMany.mockResolvedValue([
      createVerifiedDocument({
        id: 'pending-gst',
        verified: false,
        validationStatus: 'pending',
      }),
    ]);

    mockDispatchWorker.mockResolvedValue({
      success: true,
      validationPassed: false,
      outboundMessage: 'Invalid GST',
    });

    await runAgentLoop('test-workflow-id', 'test');

    expect(mockPrisma.workflow.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'AWAITING_PAN' }),
      })
    );
  });

  it('Test: Deterministic recovery of stale AWAITING_GST state with verified document', async () => {
    mockPrisma.workflow.findUnique.mockResolvedValue(
      createWorkflow({
        state: 'AWAITING_GST',
        extractedFields: { gstin: '27ABCDE1234F1Z5' },
      })
    );

    mockPrisma.document.findMany.mockResolvedValue([
      createVerifiedDocument({
        id: 'verified-gst',
        verified: true,
        validationStatus: 'passed',
        category: 'GST_CERTIFICATE',
      }),
    ]);

    mockPlanNext.mockResolvedValue({
      nextWorker: 'pan_agent',
      targetState: 'AWAITING_BANK',
      reasoningSummary: 'Test',
    });

    await runAgentLoop('test-workflow-id', 'test');

    // Recovery check
    expect(mockPrisma.workflow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'test-workflow-id' },
        data: { state: 'AWAITING_PAN' },
      })
    );

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'state_transition',
          fromState: 'AWAITING_GST',
          toState: 'AWAITING_PAN',
          metadata: expect.objectContaining({
            triggerSource: 'system_recovery',
          }),
        }),
      })
    );

    // Planner called with updated context state
    expect(mockPrisma.agentRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agentName: 'planner',
          input: expect.objectContaining({
            workflow: expect.objectContaining({
              state: 'AWAITING_PAN',
            }),
          }),
        }),
      })
    );
  });

  it('Test: Valid PAN text automatically routes to pan_agent and transitions to AWAITING_BANK', async () => {
    mockPrisma.workflow.findUnique.mockResolvedValue(
      createWorkflow({
        state: 'AWAITING_PAN',
        extractedFields: { gstin: '27ABCDE1234F1Z5' },
      })
    );

    mockPrisma.message.findMany.mockResolvedValue([
      { id: 'msg1', role: 'user', content: 'abcde1234f', createdAt: new Date() },
      { id: 'msg2', role: 'assistant', content: 'Please provide PAN', createdAt: new Date(Date.now() - 1000) },
    ]);

    mockDispatchWorker.mockResolvedValue({
      success: true,
      validationPassed: true,
      extractedData: { panNumber: 'ABCDE1234F' },
    });

    await runAgentLoop('test-workflow-id', 'test');

    // Planner called with override
    expect(mockPrisma.agentRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agentName: 'planner',
          output: expect.objectContaining({
            nextWorker: 'pan_agent',
            targetState: 'AWAITING_BANK',
          }),
        }),
      })
    );

    // Final state check
    expect(mockPrisma.workflow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'test-workflow-id' },
        data: expect.objectContaining({
          state: 'AWAITING_BANK',
          extractedFields: expect.objectContaining({
            gstin: '27ABCDE1234F1Z5',
            panNumber: 'ABCDE1234F',
          }),
        }),
      })
    );
  });

  it('Test: Invalid PAN text does not route to AWAITING_BANK', async () => {
    mockPrisma.workflow.findUnique.mockResolvedValue(
      createWorkflow({
        state: 'AWAITING_PAN',
      })
    );

    mockPrisma.message.findMany.mockResolvedValue([
      { id: 'msg1', role: 'user', content: 'hello', createdAt: new Date() },
    ]);

    mockPlanNext.mockResolvedValue({
      nextWorker: 'doc_agent',
      targetState: 'AWAITING_PAN',
      reasoningSummary: 'No valid PAN found',
    });

    await runAgentLoop('test-workflow-id', 'test');

    expect(mockPrisma.workflow.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'AWAITING_BANK' }),
      })
    );
  });

  it('Test: Integration regression with timestamp-ordered messages for PAN extraction', async () => {
    mockPrisma.workflow.findUnique.mockResolvedValue(
      createWorkflow({
        state: 'AWAITING_PAN',
        extractedFields: { gstin: '27ABCDE1234F1Z5' },
      })
    );

    const now = Date.now();

    mockPrisma.message.findMany.mockResolvedValue([
      { id: 'msg4', role: 'user', content: 'ABCDE1234F', createdAt: new Date(now) },
      { id: 'msg3', role: 'assistant', content: 'Please share PAN', createdAt: new Date(now - 1000) },
      { id: 'msg2', role: 'user', content: 'continue', createdAt: new Date(now - 2000) },
      { id: 'msg1', role: 'user', content: 'AAAAA9999A', createdAt: new Date(now - 5000) }, // old valid PAN but not latest
    ]);

    mockDispatchWorker.mockResolvedValue({
      success: true,
      validationPassed: true,
      extractedData: { panNumber: 'ABCDE1234F' },
    });

    await runAgentLoop('test-workflow-id', 'inbound_message');

    // Planner called with override
    expect(mockPrisma.agentRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agentName: 'planner',
          output: expect.objectContaining({
            nextWorker: 'pan_agent',
            targetState: 'AWAITING_BANK',
          }),
        }),
      })
    );

    // Final state check
    expect(mockPrisma.workflow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'test-workflow-id' },
        data: expect.objectContaining({
          state: 'AWAITING_BANK',
          extractedFields: expect.objectContaining({
            gstin: '27ABCDE1234F1Z5',
            panNumber: 'ABCDE1234F',
          }),
        }),
      })
    );
  });

  it('Test: "continue" in VALIDATING deterministically routes to none and advances to PENDING_APPROVAL for valid packet', async () => {
    mockPrisma.workflow.findUnique.mockResolvedValue(
      createWorkflow({
        state: 'VALIDATING',
        extractedFields: {
          gstin: '27ABCDE1234F1Z5',
          panNumber: 'ABCDE1234F',
          ifsc: 'SBIN0001234',
          accountNumber: '1234567890',
          companyNameMatch: true,
          incorporationCompanyName: 'ABC PRIVATE LIMITED',
        },
      })
    );

    const now = Date.now();

    mockPrisma.message.findMany.mockResolvedValue([
      { id: 'msg1', role: 'user', content: 'continue', createdAt: new Date(now) },
    ]);

    mockPrisma.document.findMany.mockResolvedValue([
      { id: 'doc1', category: 'GST_CERTIFICATE', verified: true },
      { id: 'doc2', category: 'BANK_PROOF', verified: true },
      { id: 'doc3', category: 'INCORPORATION_PROOF', verified: true },
      { id: 'doc4', category: 'VENDOR_AGREEMENT', verified: true },
    ]);

    await runAgentLoop('test-workflow-id', 'inbound_message');

    // Planner called with override
    expect(mockPrisma.agentRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agentName: 'planner',
          output: expect.objectContaining({
            nextWorker: 'none',
            targetState: 'PENDING_APPROVAL',
          }),
        }),
      })
    );

    // Final state check
    expect(mockPrisma.workflow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'test-workflow-id' },
        data: expect.objectContaining({
          state: 'PENDING_APPROVAL',
        }),
      })
    );
  });

  it('Test: VALIDATING deterministically blocks progression if companyNameMatch is false', async () => {
    mockPrisma.workflow.findUnique.mockResolvedValue(
      createWorkflow({
        state: 'VALIDATING',
        extractedFields: {
          gstin: '27ABCDE1234F1Z5',
          panNumber: 'ABCDE1234F',
          ifsc: 'SBIN0001234',
          accountNumber: '1234567890',
          companyNameMatch: false,
          incorporationCompanyName: null,
        },
      })
    );

    const now = Date.now();

    mockPrisma.message.findMany.mockResolvedValue([
      { id: 'msg1', role: 'user', content: 'continue', createdAt: new Date(now) },
    ]);

    mockPrisma.document.findMany.mockResolvedValue([
      { id: 'doc1', category: 'GST_CERTIFICATE', verified: true },
      { id: 'doc2', category: 'BANK_PROOF', verified: true },
      { id: 'doc3', category: 'INCORPORATION_PROOF', verified: true },
      { id: 'doc4', category: 'VENDOR_AGREEMENT', verified: true },
    ]);

    await runAgentLoop('test-workflow-id', 'inbound_message');

    // Planner called with override
    expect(mockPrisma.agentRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agentName: 'planner',
          output: expect.objectContaining({
            nextWorker: 'none',
            targetState: 'PENDING_APPROVAL',
          }),
        }),
      })
    );

    // Workflow state should not have changed to PENDING_APPROVAL
    expect(mockPrisma.workflow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'test-workflow-id' },
        data: expect.objectContaining({
          state: 'VALIDATING',
        }),
      })
    );
  });

  it('Test: VALIDATING with pending document routes to remediation worker (incorporation_agent) and not none', async () => {
    mockPrisma.workflow.findUnique.mockResolvedValue(
      createWorkflow({
        state: 'VALIDATING',
        extractedFields: {
          gstin: '27ABCDE1234F1Z5',
          panNumber: 'ABCDE1234F',
          ifsc: 'SBIN0001234',
          accountNumber: '1234567890',
          companyNameMatch: false,
          incorporationCompanyName: null,
        },
      })
    );

    const now = Date.now();

    mockPrisma.message.findMany.mockResolvedValue([
      { id: 'msg1', role: 'user', content: '', createdAt: new Date(now), attachments: {} }, // Simulated attachment
    ]);

    mockPrisma.document.findMany.mockResolvedValue([
      { id: 'doc-new-incorp', category: undefined, verified: false, validationStatus: 'pending' }, // newly uploaded pending document
      { id: 'doc1', category: 'GST_CERTIFICATE', verified: true },
      { id: 'doc2', category: 'BANK_PROOF', verified: true },
      { id: 'doc3', category: 'INCORPORATION_PROOF', verified: true, validationStatus: 'failed' }, // old failed incorporation proof
      { id: 'doc4', category: 'VENDOR_AGREEMENT', verified: true },
    ]);

    mockDispatchWorker.mockResolvedValue({
      success: true,
      validationPassed: true,
      extractedData: {
        incorporationCompanyName: 'ABC PRIVATE LIMITED',
        companyNameMatch: true,
        incorporationProofType: 'CERTIFICATE_OF_INCORPORATION'
      },
    });

    await runAgentLoop('test-workflow-id', 'inbound_message');

    // Planner called with override for remediation
    expect(mockPrisma.agentRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agentName: 'planner',
          output: expect.objectContaining({
            nextWorker: 'incorporation_agent',
            targetState: 'VALIDATING',
          }),
        }),
      })
    );

    // Final state check: updates workflow fields
    expect(mockPrisma.workflow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'test-workflow-id' },
        data: expect.objectContaining({
          state: 'VALIDATING',
          extractedFields: expect.objectContaining({
            incorporationCompanyName: 'ABC PRIVATE LIMITED',
            companyNameMatch: true,
          }),
        }),
      })
    );
  });
});