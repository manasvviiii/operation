import { describe, it, expect, vi, beforeEach } from 'vitest';
import { run } from './erp_agent';
import type { WorkerContext } from './types';

const mockPrisma = vi.hoisted(() => ({
  approval: { findFirst: vi.fn() },
  vendor: { findUnique: vi.fn(), update: vi.fn() },
}));

vi.mock('../../prisma', () => ({
  prisma: mockPrisma,
}));

const mockExecute = vi.hoisted(() => vi.fn());
vi.mock('../../connectors/erpConnector', () => ({
  ErpConnector: class {
    execute = mockExecute;
  },
}));

function createContext(): WorkerContext {
  return {
    workflowId: 'wf-1',
    vendor: { id: 'vendor-12345678-abc', legalName: 'ABC Corp', status: 'PROSPECT', contactEmail: null },
    messages: [],
    documents: [],
    plan: { nextWorker: 'erp_agent', targetState: 'COMPLETED', reasoningSummary: 'Test' },
    extractedFields: {},
  };
}

describe('erp_agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails if no APPROVED approval exists', async () => {
    mockPrisma.approval.findFirst.mockResolvedValue(null);
    const result = await run(createContext());
    expect(result.success).toBe(false);
    expect(result.error).toContain('APPROVED human decision');
  });

  it('generates vendor code and calls ERP connector on success', async () => {
    mockPrisma.approval.findFirst.mockResolvedValue({ id: 'appr-1' });
    mockPrisma.vendor.findUnique.mockResolvedValue({ id: 'vendor-12345678-abc', vendorCode: null });
    mockPrisma.vendor.update.mockResolvedValue({ id: 'vendor-12345678-abc', vendorCode: 'ABC-VND-VENDOR-1' });
    mockExecute.mockResolvedValue({ success: true, data: { recordId: '123' } });

    const result = await run(createContext());
    expect(mockPrisma.vendor.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { vendorCode: 'ABC-VND-VENDOR-1' } })
    );
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'createVendorRecord' })
    );
    expect(result.success).toBe(true);
    expect(result.validationPassed).toBe(true);
    expect(result.extractedData?.vendorCode).toBe('ABC-VND-VENDOR-1');
  });

  it('reuses existing vendor code if present', async () => {
    mockPrisma.approval.findFirst.mockResolvedValue({ id: 'appr-1' });
    mockPrisma.vendor.findUnique.mockResolvedValue({ id: 'vendor-12345678-abc', vendorCode: 'EXISTING-CODE' });
    mockExecute.mockResolvedValue({ success: true, data: { recordId: '123' } });

    const result = await run(createContext());
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ vendorCode: 'EXISTING-CODE' }) })
    );
    expect(result.success).toBe(true);
  });
});
