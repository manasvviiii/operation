import { describe, it, expect, vi } from 'vitest';
import { dispatchWorker } from './index';

describe('Workers', () => {
  const baseContext = {
    workflowId: 'w1',
    vendor: { id: 'v1', legalName: 'Test', contactEmail: null, status: 'PENDING' },
    messages: [],
    plan: { nextWorker: 'gst_agent', targetState: 'AWAITING_GST', reasoningSummary: '' },
  };

  it('dispatchWorker routes to gst_agent correctly', async () => {
    const result = await dispatchWorker('gst_agent', {
      ...baseContext,
      messages: [{ id: 'm1', role: 'user', content: 'Here is my GST: 22AAAAA0000A1Z5', createdAt: new Date() }]
    });
    expect(result.success).toBe(true);
    expect(result.extractedData?.gstNumber).toBe('22AAAAA0000A1Z5');
  });

  it('gst_agent prompts when GST is absent', async () => {
    const result = await dispatchWorker('gst_agent', {
      ...baseContext,
      messages: [{ id: 'm1', role: 'user', content: 'Hello there', createdAt: new Date() }]
    });
    expect(result.success).toBe(true);
    expect(result.extractedData).toBeUndefined();
    expect(result.outboundMessage).toContain('Please share your GST number');
  });

  it('pan_agent extracts PAN successfully', async () => {
    const result = await dispatchWorker('pan_agent', {
      ...baseContext,
      messages: [{ id: 'm1', role: 'user', content: 'My PAN is ABCDE1234F', createdAt: new Date() }]
    });
    expect(result.success).toBe(true);
    expect(result.extractedData?.panNumber).toBe('ABCDE1234F');
  });

  it('erp_agent returns success always', async () => {
    const result = await dispatchWorker('erp_agent', baseContext);
    expect(result.success).toBe(true);
    expect(result.outboundMessage).toBe('Vendor onboarding complete — your record has been created in our system.');
  });

  it('throws clear error for unknown worker', async () => {
    await expect(dispatchWorker('unknown_agent', baseContext)).rejects.toThrow('Unrecognized worker name: unknown_agent');
  });
});
