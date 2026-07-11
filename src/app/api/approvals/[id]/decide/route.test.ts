import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    approval: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    workflow: {
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/stateMachine', () => ({
  validateTransition: vi.fn(),
}));

vi.mock('@/lib/auditLog', () => ({
  writeAuditLog: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { validateTransition } from '@/lib/stateMachine';
import { writeAuditLog } from '@/lib/auditLog';
import { POST } from './route';

const mockPrisma = prisma as any;
const mockValidateTransition = validateTransition as any;
const mockWriteAuditLog = writeAuditLog as any;

function makeRequest(body: any) {
  return {
    json: async () => body,
  } as any;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/approvals/[id]/decide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for an invalid decision value', async () => {
    const req = makeRequest({ decision: 'MAYBE', decidedBy: 'ops-user' });
    const res = await POST(req, makeParams('appr-1'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when decidedBy is missing', async () => {
    const req = makeRequest({ decision: 'APPROVED' });
    const res = await POST(req, makeParams('appr-1'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when the approval does not exist', async () => {
    mockPrisma.approval.findUnique.mockResolvedValue(null);
    const req = makeRequest({ decision: 'APPROVED', decidedBy: 'ops-user' });
    const res = await POST(req, makeParams('appr-missing'));
    expect(res.status).toBe(404);
  });

  it('returns 400 when the approval was already decided', async () => {
    mockPrisma.approval.findUnique.mockResolvedValue({
      id: 'appr-1',
      decision: 'APPROVED',
      workflowId: 'wf-1',
      workflow: { state: 'PENDING_APPROVAL' },
    });
    const req = makeRequest({ decision: 'APPROVED', decidedBy: 'ops-user' });
    const res = await POST(req, makeParams('appr-1'));
    expect(res.status).toBe(400);
  });

  it('approves: updates Approval, validates + advances Workflow to WRITING_ERP, writes AuditLog', async () => {
    mockPrisma.approval.findUnique.mockResolvedValue({
      id: 'appr-1',
      decision: 'PENDING',
      workflowId: 'wf-1',
      workflow: { state: 'PENDING_APPROVAL' },
    });
    mockPrisma.approval.update.mockResolvedValue({ id: 'appr-1', decision: 'APPROVED' });
    mockPrisma.workflow.update.mockResolvedValue({});
    mockValidateTransition.mockReturnValue(undefined);

    const req = makeRequest({ decision: 'APPROVED', decidedBy: 'ops-user' });
    const res = await POST(req, makeParams('appr-1'));

    expect(mockPrisma.approval.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appr-1' },
        data: expect.objectContaining({ decision: 'APPROVED', decidedBy: 'ops-user' }),
      })
    );

    expect(mockValidateTransition).toHaveBeenCalledWith('PENDING_APPROVAL', 'WRITING_ERP');

    expect(mockPrisma.workflow.update).toHaveBeenCalledWith({
      where: { id: 'wf-1' },
      data: { state: 'WRITING_ERP' },
    });

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'wf-1',
        actor: 'human',
        action: 'approval_approved',
        fromState: 'PENDING_APPROVAL',
        toState: 'WRITING_ERP',
      })
    );

    expect(res.status).toBe(200);
  });

  it('rejects: updates Approval, validates + moves Workflow to PAUSED, writes AuditLog', async () => {
    mockPrisma.approval.findUnique.mockResolvedValue({
      id: 'appr-2',
      decision: 'PENDING',
      workflowId: 'wf-2',
      workflow: { state: 'PENDING_APPROVAL' },
    });
    mockPrisma.approval.update.mockResolvedValue({ id: 'appr-2', decision: 'REJECTED' });
    mockPrisma.workflow.update.mockResolvedValue({});
    mockValidateTransition.mockReturnValue(undefined);

    const req = makeRequest({ decision: 'REJECTED', decidedBy: 'ops-user', reason: 'bad docs' });
    const res = await POST(req, makeParams('appr-2'));

    expect(mockValidateTransition).toHaveBeenCalledWith('PENDING_APPROVAL', 'PAUSED');

    expect(mockPrisma.workflow.update).toHaveBeenCalledWith({
      where: { id: 'wf-2' },
      data: { state: 'PAUSED' },
    });

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'human',
        action: 'approval_rejected',
        toState: 'PAUSED',
      })
    );

    expect(res.status).toBe(200);
  });

  it('returns 500 if validateTransition throws (invalid transition attempted)', async () => {
    mockPrisma.approval.findUnique.mockResolvedValue({
      id: 'appr-3',
      decision: 'PENDING',
      workflowId: 'wf-3',
      workflow: { state: 'COMPLETED' },
    });
    mockValidateTransition.mockImplementation(() => {
      throw new Error('Invalid state transition');
    });

    const req = makeRequest({ decision: 'APPROVED', decidedBy: 'ops-user' });
    const res = await POST(req, makeParams('appr-3'));

    expect(res.status).toBe(500);
    expect(mockPrisma.workflow.update).not.toHaveBeenCalled();
  });
});