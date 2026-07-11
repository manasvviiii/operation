import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyVendorAgreement,
  detectSignatureEvidence,
} from './agreement_agent';
import { dispatchWorker } from './index';
import type {
  WorkerContext,
  WorkerDocument,
} from './types';

// ---------------------------------------------------------------------------
// Mock the document text extraction and ingestion boundaries
// ---------------------------------------------------------------------------

const mockExtractDocumentText = vi.fn();
const mockUpdateDocumentValidation = vi.fn();

vi.mock('../../document/textExtraction', () => ({
  extractDocumentText: (...args: unknown[]) =>
    mockExtractDocumentText(...args),
}));

vi.mock('../../document/ingestion', () => ({
  updateDocumentValidation: (...args: unknown[]) =>
    mockUpdateDocumentValidation(...args),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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
      nextWorker: 'agreement_agent',
      targetState: 'VALIDATING',
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
    originalFilename: 'agreement.pdf',
    fileSize: 3072,
    mime: 'application/pdf',
    storageUrl: 'https://example.com/agreement.pdf',
    validationStatus: 'pending',
    verified: false,
    extractedFields: undefined,
    confidence: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Sample document texts
// ---------------------------------------------------------------------------

const VALID_SIGNED_VENDOR_AGREEMENT = `
  VENDOR AGREEMENT

  This Vendor Agreement ("Agreement") is entered into between the following Parties:

  Party A (Buyer): XYZ Corporation Limited
  Party B (Vendor): ABC Manufacturing Private Limited

  TERMS AND CONDITIONS

  1. The Vendor agrees to supply goods as per the purchase orders.
  2. Payment shall be made within 30 days of invoice receipt.
  3. The Vendor shall maintain quality standards as specified.
  4. Either party may terminate this agreement with 30 days written notice.

  AUTHORIZED SIGNATORY

  For XYZ Corporation Limited:
  Signature: ________________
  Name: John Smith
  Designation: Procurement Head
  Date: 15/03/2024

  For ABC Manufacturing Private Limited:
  Signed by: Rajesh Kumar
  Designation: Managing Director
  Date: 15/03/2024
`;

const VALID_SUPPLIER_AGREEMENT = `
  SUPPLIER AGREEMENT

  This Supplier Agreement is made between the Parties listed below.

  Vendor: ABC Manufacturing Pvt Ltd
  Supplier: DEF Raw Materials Ltd

  TERMS AND CONDITIONS

  The Supplier agrees to provide materials in accordance with agreed specifications.

  Authorised Signatory:
  Digitally Signed by ABC Manufacturing Pvt Ltd
  Date: 01/04/2024
`;

const UNSIGNED_VENDOR_AGREEMENT = `
  VENDOR AGREEMENT

  This Vendor Agreement ("Agreement") is entered into between the following Parties:

  Party A (Buyer): XYZ Corporation Limited
  Party B (Vendor): ABC Manufacturing Private Limited

  TERMS AND CONDITIONS

  1. The Vendor agrees to supply goods as per the purchase orders.
  2. Payment shall be made within 30 days of invoice receipt.

  For XYZ Corporation Limited:
  Name: ________________
  Designation: ________________
  Date: ________________

  For ABC Manufacturing Private Limited:
  Name: ________________
  Designation: ________________
  Date: ________________
`;

const GST_CERTIFICATE_TEXT = `
  GOVERNMENT OF INDIA
  GOODS AND SERVICES TAX
  REGISTRATION CERTIFICATE
  FORM GST REG-06

  GSTIN: 27AABCA1234D1Z5
  Legal Name of Business: ABC Manufacturing Private Limited
  Trade Name: ABC Manufacturing

  Date of Registration: 01/07/2017
  Type of Registration: Regular
`;

const INCORPORATION_CERTIFICATE_TEXT = `
  GOVERNMENT OF INDIA
  MINISTRY OF CORPORATE AFFAIRS
  CERTIFICATE OF INCORPORATION

  Company Name: ABC Manufacturing Private Limited
  Corporate Identity Number: U72200MH2020PTC123456
  CIN: U72200MH2020PTC123456
  Date of Incorporation: 15/03/2020
  Registered Office: 123 Business Park, Mumbai 400001

  Registrar of Companies
  Companies Act, 2013
`;

const BANK_PROOF_TEXT = `
  CANCELLED
  PAY
  RUPEES
  A/C NUMBER: 123456789012
  IFSC: SBIN0001234
  MICR: 560002001
  Account Holder Name: ABC Manufacturing Pvt Ltd
`;

const INVOICE_TEXT = `
  TAX INVOICE
  Invoice Number: INV-2024-001
  Date: 15/03/2024
  From: ABC Manufacturing Pvt Ltd
  GSTIN: 27AABCA1234D1Z5

  Item Description          Qty    Rate     Amount
  Widget Type A              100   500.00   50,000.00

  Total: 59,000.00
  Payment Due: 30 Days
`;

const RESUME_TEXT = `
  JOHN DOE
  Software Engineer

  EDUCATION
  B.Tech Computer Science, IIT Bombay 2018

  EXPERIENCE
  Senior Developer at TechCorp (2020-2024)

  SKILLS
  TypeScript, Python, React, Node.js
`;

const ARBITRARY_PDF_TEXT = `
  MONTHLY SALES REPORT
  Quarter: Q1 2024
  Region: West India

  Revenue: 5,00,000
  Expenses: 3,00,000
  Net Profit: 2,00,000
`;

// ---------------------------------------------------------------------------
// Classification tests
// ---------------------------------------------------------------------------

describe('vendor agreement classification', () => {
  it('classifies valid signed Vendor Agreement', () => {
    const result = classifyVendorAgreement(
      VALID_SIGNED_VENDOR_AGREEMENT
    );

    expect(result.isVendorAgreement).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(3);
    expect(result.matchedIndicators).toContain(
      'VENDOR AGREEMENT'
    );
  });

  it('classifies Supplier Agreement', () => {
    const result = classifyVendorAgreement(
      VALID_SUPPLIER_AGREEMENT
    );

    expect(result.isVendorAgreement).toBe(true);
    expect(result.matchedIndicators).toContain(
      'SUPPLIER AGREEMENT'
    );
  });

  it('requires multiple indicators', () => {
    const singleIndicator =
      'This document is an agreement between two companies.';
    const result = classifyVendorAgreement(singleIndicator);

    expect(result.isVendorAgreement).toBe(false);
    expect(result.score).toBeLessThan(3);
  });

  it('requires a strong indicator', () => {
    // Has AGREEMENT + PARTIES + VENDOR = 3, but no strong indicator
    const weakText =
      'This agreement is between parties. The vendor shall comply with terms.';
    const result = classifyVendorAgreement(weakText);

    expect(result.isVendorAgreement).toBe(false);
  });

  it('rejects GST certificate', () => {
    const result = classifyVendorAgreement(
      GST_CERTIFICATE_TEXT
    );

    expect(result.isVendorAgreement).toBe(false);
  });

  it('rejects incorporation certificate', () => {
    const result = classifyVendorAgreement(
      INCORPORATION_CERTIFICATE_TEXT
    );

    expect(result.isVendorAgreement).toBe(false);
  });

  it('rejects bank proof / cancelled cheque', () => {
    const result = classifyVendorAgreement(
      BANK_PROOF_TEXT
    );

    expect(result.isVendorAgreement).toBe(false);
  });

  it('rejects invoice', () => {
    const result = classifyVendorAgreement(INVOICE_TEXT);

    expect(result.isVendorAgreement).toBe(false);
  });

  it('rejects arbitrary document', () => {
    const result = classifyVendorAgreement(
      ARBITRARY_PDF_TEXT
    );

    expect(result.isVendorAgreement).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Signature detection tests
// ---------------------------------------------------------------------------

describe('signature detection', () => {
  it('detects SIGNED', () => {
    const result = detectSignatureEvidence(
      'This document is signed by the authorized representative.'
    );

    expect(result.hasSigned).toBe(true);
    expect(result.matchedIndicators).toContain('SIGNED');
  });

  it('detects SIGNATURE', () => {
    const result = detectSignatureEvidence(
      'Signature: Rajesh Kumar'
    );

    expect(result.hasSigned).toBe(true);
    expect(result.matchedIndicators).toContain(
      'SIGNATURE'
    );
  });

  it('detects AUTHORIZED SIGNATORY', () => {
    const result = detectSignatureEvidence(
      'Authorized Signatory: John Smith'
    );

    expect(result.hasSigned).toBe(true);
    expect(result.matchedIndicators).toContain(
      'AUTHORIZED SIGNATORY'
    );
  });

  it('detects AUTHORISED SIGNATORY', () => {
    const result = detectSignatureEvidence(
      'Authorised Signatory: Jane Doe'
    );

    expect(result.hasSigned).toBe(true);
    expect(result.matchedIndicators).toContain(
      'AUTHORISED SIGNATORY'
    );
  });

  it('detects DIGITALLY SIGNED', () => {
    const result = detectSignatureEvidence(
      'This document is digitally signed using DSC.'
    );

    expect(result.hasSigned).toBe(true);
    expect(result.matchedIndicators).toContain(
      'DIGITALLY SIGNED'
    );
  });

  it('detects E-SIGNED', () => {
    const result = detectSignatureEvidence(
      'This agreement has been e-signed by both parties.'
    );

    expect(result.hasSigned).toBe(true);
    expect(result.matchedIndicators).toContain(
      'E-SIGNED'
    );
  });

  it('detects /s/ signature pattern', () => {
    const result = detectSignatureEvidence(
      'By: /s/ Rajesh Kumar, Managing Director'
    );

    expect(result.hasSigned).toBe(true);
    expect(result.matchedIndicators).toContain('/s/');
  });

  it('returns hasSigned false when no evidence', () => {
    const result = detectSignatureEvidence(
      'This is a draft document without any endorsement.'
    );

    expect(result.hasSigned).toBe(false);
    expect(result.matchedIndicators).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Worker: unreadable document
// ---------------------------------------------------------------------------

describe('agreement worker: unreadable document', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns validationPassed false for unreadable document', async () => {
    mockExtractDocumentText.mockResolvedValue({
      text: '',
      readable: false,
      method: 'PDF_TEXT',
      reason: 'PDF_EXTRACTION_FAILED',
      error: 'Corrupt PDF',
    });

    mockUpdateDocumentValidation.mockResolvedValue({});

    const result = await dispatchWorker(
      'agreement_agent',
      createContext({
        documents: [createDocument()],
      })
    );

    expect(result.success).toBe(true);
    expect(result.validationPassed).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.outboundMessage).toContain(
      'could not read'
    );

    expect(
      mockUpdateDocumentValidation
    ).toHaveBeenCalledWith(
      'document-1',
      'failed',
      undefined,
      undefined,
      expect.any(String)
    );
  });
});

// ---------------------------------------------------------------------------
// Worker: missing uploaded document
// ---------------------------------------------------------------------------

describe('agreement worker: missing document', () => {
  it('returns validationPassed false when no document', async () => {
    const result = await dispatchWorker(
      'agreement_agent',
      createContext({
        documents: [],
      })
    );

    expect(result.success).toBe(true);
    expect(result.validationPassed).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.outboundMessage).toContain(
      'upload'
    );
  });
});

// ---------------------------------------------------------------------------
// Worker: plain-text rejection
// ---------------------------------------------------------------------------

describe('agreement worker: plain-text rejection', () => {
  it('plain-text "I signed the agreement" does not pass', async () => {
    const result = await dispatchWorker(
      'agreement_agent',
      createContext({
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'I signed the agreement',
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

  it('plain-text "agreement signed" does not pass', async () => {
    const result = await dispatchWorker(
      'agreement_agent',
      createContext({
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'agreement signed',
            createdAt: new Date(),
          },
        ],
        documents: [],
      })
    );

    expect(result.success).toBe(true);
    expect(result.validationPassed).toBe(false);
  });

  it('plain-text "ABC vendor agreement" does not pass', async () => {
    const result = await dispatchWorker(
      'agreement_agent',
      createContext({
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'ABC vendor agreement',
            createdAt: new Date(),
          },
        ],
        documents: [],
      })
    );

    expect(result.success).toBe(true);
    expect(result.validationPassed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Worker: unsigned Vendor Agreement rejection
// ---------------------------------------------------------------------------

describe('agreement worker: unsigned agreement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unsigned Vendor Agreement', async () => {
    mockExtractDocumentText.mockResolvedValue({
      text: UNSIGNED_VENDOR_AGREEMENT,
      readable: true,
      method: 'PDF_TEXT',
      confidence: 1,
    });

    mockUpdateDocumentValidation.mockResolvedValue({});

    const result = await dispatchWorker(
      'agreement_agent',
      createContext({
        documents: [createDocument()],
      })
    );

    expect(result.success).toBe(true);
    expect(result.validationPassed).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.outboundMessage).toContain(
      'unsigned'
    );
    expect(result.extractedData?.agreementType).toBe(
      'VENDOR_AGREEMENT'
    );
    expect(result.extractedData?.signed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Worker: rejection of unrelated documents
// ---------------------------------------------------------------------------

describe('agreement worker: unrelated document rejection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateDocumentValidation.mockResolvedValue({});
  });

  it('rejects GST certificate', async () => {
    mockExtractDocumentText.mockResolvedValue({
      text: GST_CERTIFICATE_TEXT,
      readable: true,
      method: 'PDF_TEXT',
      confidence: 1,
    });

    const result = await dispatchWorker(
      'agreement_agent',
      createContext({
        documents: [createDocument()],
      })
    );

    expect(result.validationPassed).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.outboundMessage).toContain(
      'does not appear to be'
    );
  });

  it('rejects incorporation certificate', async () => {
    mockExtractDocumentText.mockResolvedValue({
      text: INCORPORATION_CERTIFICATE_TEXT,
      readable: true,
      method: 'PDF_TEXT',
      confidence: 1,
    });

    const result = await dispatchWorker(
      'agreement_agent',
      createContext({
        documents: [createDocument()],
      })
    );

    expect(result.validationPassed).toBe(false);
    expect(result.retryable).toBe(true);
  });

  it('rejects bank proof / cancelled cheque', async () => {
    mockExtractDocumentText.mockResolvedValue({
      text: BANK_PROOF_TEXT,
      readable: true,
      method: 'PDF_TEXT',
      confidence: 1,
    });

    const result = await dispatchWorker(
      'agreement_agent',
      createContext({
        documents: [createDocument()],
      })
    );

    expect(result.validationPassed).toBe(false);
    expect(result.retryable).toBe(true);
  });

  it('rejects invoice', async () => {
    mockExtractDocumentText.mockResolvedValue({
      text: INVOICE_TEXT,
      readable: true,
      method: 'PDF_TEXT',
      confidence: 1,
    });

    const result = await dispatchWorker(
      'agreement_agent',
      createContext({
        documents: [createDocument()],
      })
    );

    expect(result.validationPassed).toBe(false);
    expect(result.retryable).toBe(true);
  });

  it('rejects arbitrary document', async () => {
    mockExtractDocumentText.mockResolvedValue({
      text: ARBITRARY_PDF_TEXT,
      readable: true,
      method: 'PDF_TEXT',
      confidence: 1,
    });

    const result = await dispatchWorker(
      'agreement_agent',
      createContext({
        documents: [createDocument()],
      })
    );

    expect(result.validationPassed).toBe(false);
    expect(result.retryable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Worker: successful agreement validation
// ---------------------------------------------------------------------------

describe('agreement worker: successful validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes validation for signed Vendor Agreement', async () => {
    mockExtractDocumentText.mockResolvedValue({
      text: VALID_SIGNED_VENDOR_AGREEMENT,
      readable: true,
      method: 'PDF_TEXT',
      confidence: 1,
    });

    mockUpdateDocumentValidation.mockResolvedValue({});

    const result = await dispatchWorker(
      'agreement_agent',
      createContext({
        documents: [createDocument()],
      })
    );

    expect(result.success).toBe(true);
    expect(result.validationPassed).toBe(true);
    expect(result.retryable).toBe(false);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.extractedData?.agreementType).toBe(
      'VENDOR_AGREEMENT'
    );
    expect(result.extractedData?.signed).toBe(true);
    expect(
      result.extractedData?.agreementIndicators
    ).toEqual(expect.any(Array));
    expect(
      result.extractedData?.signatureIndicators
    ).toEqual(expect.any(Array));
    expect(result.outboundMessage).toContain(
      'validated'
    );
  });

  it('calls updateDocumentValidation with category VENDOR_AGREEMENT', async () => {
    mockExtractDocumentText.mockResolvedValue({
      text: VALID_SIGNED_VENDOR_AGREEMENT,
      readable: true,
      method: 'PDF_TEXT',
      confidence: 1,
    });

    mockUpdateDocumentValidation.mockResolvedValue({});

    await dispatchWorker(
      'agreement_agent',
      createContext({
        documents: [createDocument()],
      })
    );

    expect(
      mockUpdateDocumentValidation
    ).toHaveBeenCalledWith(
      'document-1',
      'passed',
      expect.objectContaining({
        agreementType: 'VENDOR_AGREEMENT',
        signed: true,
      }),
      expect.any(Number),
      undefined,
      'VENDOR_AGREEMENT'
    );
  });

  it('successful WorkerResult has validationPassed true', async () => {
    mockExtractDocumentText.mockResolvedValue({
      text: VALID_SIGNED_VENDOR_AGREEMENT,
      readable: true,
      method: 'PDF_TEXT',
      confidence: 1,
    });

    mockUpdateDocumentValidation.mockResolvedValue({});

    const result = await dispatchWorker(
      'agreement_agent',
      createContext({
        documents: [createDocument()],
      })
    );

    expect(result.validationPassed).toBe(true);
  });

  it('failed validation has validationPassed false and retryable true', async () => {
    mockExtractDocumentText.mockResolvedValue({
      text: INVOICE_TEXT,
      readable: true,
      method: 'PDF_TEXT',
      confidence: 1,
    });

    mockUpdateDocumentValidation.mockResolvedValue({});

    const result = await dispatchWorker(
      'agreement_agent',
      createContext({
        documents: [createDocument()],
      })
    );

    expect(result.validationPassed).toBe(false);
    expect(result.retryable).toBe(true);
  });

  it('passes validation for supplier agreement with digital signature', async () => {
    mockExtractDocumentText.mockResolvedValue({
      text: VALID_SUPPLIER_AGREEMENT,
      readable: true,
      method: 'PDF_TEXT',
      confidence: 1,
    });

    mockUpdateDocumentValidation.mockResolvedValue({});

    const result = await dispatchWorker(
      'agreement_agent',
      createContext({
        documents: [createDocument()],
      })
    );

    expect(result.success).toBe(true);
    expect(result.validationPassed).toBe(true);
    expect(result.extractedData?.signed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Prerequisite guard: VENDOR_AGREEMENT requirement
// ---------------------------------------------------------------------------

describe('prerequisite guard: VENDOR_AGREEMENT requirement', () => {
  it('blocks VALIDATING without VENDOR_AGREEMENT', async () => {
    const { checkPrerequisites } = await import(
      '../../validation/prerequisiteGuard'
    );

    const result = checkPrerequisites(
      'VALIDATING',
      {
        gstin: '22AAAAA0000A1Z5',
        panNumber: 'ABCDE1234F',
        ifsc: 'SBIN0001234',
        accountNumber: '123456789012',
      },
      [
        {
          id: 'gst-doc',
          category: 'GST_CERTIFICATE',
          verified: true,
        },
        {
          id: 'bank-doc',
          category: 'BANK_PROOF',
          verified: true,
        },
        {
          id: 'incorp-doc',
          category: 'INCORPORATION_PROOF',
          verified: true,
        },
      ]
    );

    expect(result.passed).toBe(false);
    expect(result.reason).toContain(
      'Vendor Agreement'
    );
  });

  it('blocks PENDING_APPROVAL without VENDOR_AGREEMENT', async () => {
    const { checkPrerequisites } = await import(
      '../../validation/prerequisiteGuard'
    );

    const result = checkPrerequisites(
      'PENDING_APPROVAL',
      {
        gstin: '22AAAAA0000A1Z5',
        panNumber: 'ABCDE1234F',
        ifsc: 'SBIN0001234',
        accountNumber: '123456789012',
      },
      [
        {
          id: 'gst-doc',
          category: 'GST_CERTIFICATE',
          verified: true,
        },
        {
          id: 'bank-doc',
          category: 'BANK_PROOF',
          verified: true,
        },
        {
          id: 'incorp-doc',
          category: 'INCORPORATION_PROOF',
          verified: true,
        },
      ]
    );

    expect(result.passed).toBe(false);
    expect(result.reason).toContain(
      'Vendor Agreement'
    );
  });

  it('unverified VENDOR_AGREEMENT does not satisfy the guard', async () => {
    const { checkPrerequisites } = await import(
      '../../validation/prerequisiteGuard'
    );

    const result = checkPrerequisites(
      'VALIDATING',
      {
        gstin: '22AAAAA0000A1Z5',
        panNumber: 'ABCDE1234F',
        ifsc: 'SBIN0001234',
        accountNumber: '123456789012',
      },
      [
        {
          id: 'gst-doc',
          category: 'GST_CERTIFICATE',
          verified: true,
        },
        {
          id: 'bank-doc',
          category: 'BANK_PROOF',
          verified: true,
        },
        {
          id: 'incorp-doc',
          category: 'INCORPORATION_PROOF',
          verified: true,
        },
        {
          id: 'agreement-doc',
          category: 'VENDOR_AGREEMENT',
          verified: false,
        },
      ]
    );

    expect(result.passed).toBe(false);
    expect(result.reason).toContain(
      'Vendor Agreement'
    );
  });

  it('wrong document category does not satisfy the guard', async () => {
    const { checkPrerequisites } = await import(
      '../../validation/prerequisiteGuard'
    );

    const result = checkPrerequisites(
      'VALIDATING',
      {
        gstin: '22AAAAA0000A1Z5',
        panNumber: 'ABCDE1234F',
        ifsc: 'SBIN0001234',
        accountNumber: '123456789012',
      },
      [
        {
          id: 'gst-doc',
          category: 'GST_CERTIFICATE',
          verified: true,
        },
        {
          id: 'bank-doc',
          category: 'BANK_PROOF',
          verified: true,
        },
        {
          id: 'incorp-doc',
          category: 'INCORPORATION_PROOF',
          verified: true,
        },
        {
          id: 'wrong-doc',
          category: 'SOME_OTHER_DOCUMENT',
          verified: true,
        },
      ]
    );

    expect(result.passed).toBe(false);
    expect(result.reason).toContain(
      'Vendor Agreement'
    );
  });

  it('verified VENDOR_AGREEMENT satisfies the agreement prerequisite with all other evidence', async () => {
    const { checkPrerequisites } = await import(
      '../../validation/prerequisiteGuard'
    );

    const result = checkPrerequisites(
      'VALIDATING',
      {
        gstin: '22AAAAA0000A1Z5',
        panNumber: 'ABCDE1234F',
        ifsc: 'SBIN0001234',
        accountNumber: '123456789012',
      },
      [
        {
          id: 'gst-doc',
          category: 'GST_CERTIFICATE',
          verified: true,
        },
        {
          id: 'bank-doc',
          category: 'BANK_PROOF',
          verified: true,
        },
        {
          id: 'incorp-doc',
          category: 'INCORPORATION_PROOF',
          verified: true,
        },
        {
          id: 'agreement-doc',
          category: 'VENDOR_AGREEMENT',
          verified: true,
        },
      ]
    );

    expect(result.passed).toBe(true);
  });

  it('verified VENDOR_AGREEMENT satisfies PENDING_APPROVAL with all evidence', async () => {
    const { checkPrerequisites } = await import(
      '../../validation/prerequisiteGuard'
    );

    const result = checkPrerequisites(
      'PENDING_APPROVAL',
      {
        gstin: '22AAAAA0000A1Z5',
        panNumber: 'ABCDE1234F',
        ifsc: 'SBIN0001234',
        accountNumber: '123456789012',
      },
      [
        {
          id: 'gst-doc',
          category: 'GST_CERTIFICATE',
          verified: true,
        },
        {
          id: 'bank-doc',
          category: 'BANK_PROOF',
          verified: true,
        },
        {
          id: 'incorp-doc',
          category: 'INCORPORATION_PROOF',
          verified: true,
        },
        {
          id: 'agreement-doc',
          category: 'VENDOR_AGREEMENT',
          verified: true,
        },
      ]
    );

    expect(result.passed).toBe(true);
  });
});
