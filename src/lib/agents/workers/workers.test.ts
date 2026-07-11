import { describe, expect, it } from 'vitest';
import { dispatchWorker } from './index';
import {
  extractPan,
  isValidPan,
  normalizePan,
} from './pan_agent';
import {
  classifyGstCertificate,
  extractGstin,
  isValidGstin,
  extractLegalName,
} from './gst_agent';
import {
  classifyBankProof,
  extractAccountNumber,
  extractIfsc,
  isValidIfsc,
} from './bank_agent';
import type {
  WorkerContext,
  WorkerDocument,
} from './types';

function createContext(
  overrides: Partial<WorkerContext> = {}
): WorkerContext {
  return {
    workflowId: 'workflow-1',

    vendor: {
      id: 'vendor-1',
      legalName: 'ABC Manufacturing Pvt Ltd',
      contactEmail: null,
      status: 'PROSPECT',
    },

    messages: [],

    documents: [],

    plan: {
      nextWorker: 'none',
      targetState: 'AWAITING_GST',
      reasoningSummary: 'Test plan',
    },

    extractedFields: {},

    ...overrides,
  };
}

function createDocument(
  overrides: Partial<WorkerDocument> = {}
): WorkerDocument {
  return {
    id: 'document-1',
    type: 'document',
    category: null,
    originalFilename: 'document.pdf',
    fileSize: 1024,
    mime: 'application/pdf',
    storageUrl: 'https://example.com/document.pdf',
    validationStatus: 'pending',
    verified: false,
    extractedFields: undefined,
    confidence: null,
    ...overrides,
  };
}

describe('PAN validation', () => {
  it('normalizes PAN values', () => {
    expect(normalizePan(' abcde-1234-f ')).toBe(
      'ABCDE1234F'
    );
  });

  it('accepts a valid PAN', () => {
    expect(isValidPan('ABCDE1234F')).toBe(true);
  });

  it('rejects invalid PAN values', () => {
    expect(isValidPan('ABC123')).toBe(false);
    expect(isValidPan('ABCDE12345')).toBe(false);
    expect(isValidPan('12345ABCDZ')).toBe(false);
  });

  it('extracts PAN from user text', () => {
    expect(
      extractPan('My PAN is ABCDE1234F')
    ).toBe('ABCDE1234F');
  });

  it('pan worker passes valid PAN', async () => {
    const result = await dispatchWorker(
      'pan_agent',
      createContext({
        messages: [
          {
            id: 'message-1',
            role: 'user',
            content: 'My PAN is ABCDE1234F',
            createdAt: new Date(),
          },
        ],
      })
    );

    expect(result.success).toBe(true);
    expect(result.validationPassed).toBe(true);
    expect(result.extractedData?.panNumber).toBe(
      'ABCDE1234F'
    );
  });

  it('pan worker rejects invalid PAN', async () => {
    const result = await dispatchWorker(
      'pan_agent',
      createContext({
        messages: [
          {
            id: 'message-1',
            role: 'user',
            content: 'ABC123',
            createdAt: new Date(),
          },
        ],
      })
    );

    expect(result.success).toBe(true);
    expect(result.validationPassed).toBe(false);
    expect(result.retryable).toBe(true);
  });
});

describe('GST validation helpers', () => {
  it('accepts a structurally valid GSTIN', () => {
    expect(isValidGstin('22AAAAA0000A1Z5')).toBe(
      true
    );
  });

  it('rejects invalid GSTIN structures', () => {
    expect(isValidGstin('ABCDE1234567890')).toBe(
      false
    );

    expect(isValidGstin('22AAAAA0000A1Z')).toBe(
      false
    );
  });

  it('extracts GSTIN from certificate text', () => {
    expect(
      extractGstin(
        'GSTIN: 22AAAAA0000A1Z5'
      )
    ).toBe('22AAAAA0000A1Z5');
  });

  it('classifies GST certificate text', () => {
    const result = classifyGstCertificate(`
      GOVERNMENT OF INDIA
      GOODS AND SERVICES TAX
      REGISTRATION CERTIFICATE
      FORM GST REG-06
    `);

    expect(result.isGstCertificate).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(3);
  });

  describe('extractLegalName', () => {
    it('extracts "Legal Name of Business\nABC PRIVATE LIMITED\n2. Trade Name, if any" correctly', () => {
      const text = 'Legal Name of Business\nABC PRIVATE LIMITED\n2. Trade Name, if any\nXYZ';
      expect(extractLegalName(text)).toBe('ABC PRIVATE LIMITED');
    });

    it('handles label/value on the same line', () => {
      const text = 'Legal Name of Business: ABC PRIVATE LIMITED\n2. Trade Name, if any';
      expect(extractLegalName(text)).toBe('ABC PRIVATE LIMITED');
    });

    it('handles excessive OCR whitespace and empty lines', () => {
      const text = 'Legal Name of Business \n \n  \nABC PRIVATE LIMITED \n \n2. Trade Name, if any';
      expect(extractLegalName(text)).toBe('ABC PRIVATE LIMITED');
    });

    it('handles numbered GST field labels', () => {
      const text = '1. Legal Name of Business\nABC PRIVATE LIMITED\n2. Trade Name, if any';
      expect(extractLegalName(text)).toBe('ABC PRIVATE LIMITED');
    });

    it('Trade Name label is never returned as legalName', () => {
      const text = 'Legal Name of Business\n\n2. Trade Name, if any\nXYZ';
      expect(extractLegalName(text)).toBeNull(); // Missing value, jumps to next label
    });

    it('missing legal name returns null rather than persisting a field label', () => {
      const text = '1. Legal Name\nConstitution of Business\nPrivate Limited';
      expect(extractLegalName(text)).toBeNull();
    });
  });

  it('classifies GST certificate text', () => {
    const result = classifyGstCertificate(`
      GOVERNMENT OF INDIA
      GOODS AND SERVICES TAX
      REGISTRATION CERTIFICATE
      FORM GST REG-06
      GSTIN: 22AAAAA0000A1Z5
      Legal Name of Business: ABC Manufacturing Pvt Ltd
      Trade Name: ABC Manufacturing
    `);

    expect(result.isGstCertificate).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(3);
  });

  it('rejects invoice text as GST certificate', () => {
    const result = classifyGstCertificate(`
      TAX INVOICE
      Invoice Number: INV-1001
      GSTIN: 22AAAAA0000A1Z5
      Total Amount: 50000
      Payment Due
    `);

    expect(result.isGstCertificate).toBe(false);
  });

  it('GST worker does not accept plain-text GSTIN', async () => {
    const result = await dispatchWorker(
      'gst_agent',
      createContext({
        messages: [
          {
            id: 'message-1',
            role: 'user',
            content:
              'Here is my GST: 22AAAAA0000A1Z5',
            createdAt: new Date(),
          },
        ],
        documents: [],
      })
    );

    expect(result.success).toBe(true);
    expect(result.validationPassed).toBe(false);
    expect(result.retryable).toBe(true);
  });
});

describe('bank validation helpers', () => {
  it('accepts a valid IFSC', () => {
    expect(isValidIfsc('SBIN0001234')).toBe(true);
  });

  it('rejects invalid IFSC values', () => {
    expect(isValidIfsc('SBIN1234')).toBe(false);
    expect(isValidIfsc('12340001234')).toBe(false);
  });

  it('extracts IFSC from bank text', () => {
    expect(
      extractIfsc('IFSC: SBIN0001234')
    ).toBe('SBIN0001234');
  });

  it('extracts labelled account number', () => {
    expect(
      extractAccountNumber(
        'Account Number: 123456789012'
      )
    ).toBe('123456789012');
  });

  it('classifies cancelled cheque text', () => {
    const result = classifyBankProof(`
      CANCELLED
      PAY
      RUPEES
      A/C NUMBER: 123456789012
      IFSC: SBIN0001234
      MICR: 560002001
    `);

    expect(result.proofType).toBe(
      'CANCELLED_CHEQUE'
    );
  });

  it('rejects unrelated bank document text', () => {
    const result = classifyBankProof(`
      MONTHLY SALES REPORT
      Revenue: 500000
      Expenses: 300000
      Net Profit: 200000
    `);

    expect(result.proofType).toBe(
      'UNRECOGNIZED_DOCUMENT'
    );
  });

  it('bank worker does not accept IFSC-only text', async () => {
    const result = await dispatchWorker(
      'bank_agent',
      createContext({
        messages: [
          {
            id: 'message-1',
            role: 'user',
            content: 'My IFSC is SBIN0001234',
            createdAt: new Date(),
          },
        ],
        documents: [],
      })
    );

    expect(result.success).toBe(true);
    expect(result.validationPassed).toBe(false);
    expect(result.retryable).toBe(true);
  });
});

describe('document worker', () => {
  it('rejects missing real documents', async () => {
    const result = await dispatchWorker(
      'doc_agent',
      createContext({
        messages: [
          {
            id: 'message-1',
            role: 'user',
            content: 'Here is my attachment',
            createdAt: new Date(),
          },
        ],
        documents: [],
      })
    );

    expect(result.success).toBe(true);
    expect(result.validationPassed).toBe(false);
  });

  it('accepts an already validated document', async () => {
    const result = await dispatchWorker(
      'doc_agent',
      createContext({
        documents: [
          createDocument({
            validationStatus: 'passed',
            verified: true,
            confidence: 0.95,
          }),
        ],
      })
    );

    expect(result.success).toBe(true);
    expect(result.validationPassed).toBe(true);
    expect(result.confidence).toBe(0.95);
  });
});

describe('worker registry', () => {
  it('throws for an unknown worker', async () => {
    await expect(
      dispatchWorker(
        'unknown_agent',
        createContext()
      )
    ).rejects.toThrow(
      'Unrecognized worker name: unknown_agent'
    );
  });
});