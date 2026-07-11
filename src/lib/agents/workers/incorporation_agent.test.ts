import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyIncorporationProof,
  extractIncorporationCompanyName,
  normalizeCompanyName,
  companyNamesMatch,
  getGstCompanyName,
} from './incorporation_agent';
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
      nextWorker: 'incorporation_agent',
      targetState: 'AWAITING_AGREEMENT',
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
    originalFilename: 'certificate.pdf',
    fileSize: 2048,
    mime: 'application/pdf',
    storageUrl: 'https://example.com/certificate.pdf',
    validationStatus: 'pending',
    verified: false,
    extractedFields: undefined,
    confidence: null,
    ...overrides,
  };
}

const VALID_INCORPORATION_CERTIFICATE_TEXT = `
  GOVERNMENT OF INDIA
  MINISTRY OF CORPORATE AFFAIRS
  CERTIFICATE OF INCORPORATION
  
  The Registrar of Companies, Mumbai hereby certifies that
  
  Company Name: ABC Manufacturing Private Limited
  
  Corporate Identity Number: U72200MH2020PTC123456
  CIN: U72200MH2020PTC123456
  
  Date of Incorporation: 15/03/2020
  
  Registered Office: 123 Business Park, Mumbai 400001
  
  is incorporated under the Companies Act, 2013 (18 of 2013)
  and that the company is limited by shares.
`;

const INVOICE_TEXT = `
  TAX INVOICE
  Invoice Number: INV-2024-001
  Date: 15/03/2024
  From: ABC Manufacturing Pvt Ltd
  GSTIN: 27AABCA1234D1Z5
  
  Item Description          Qty    Rate     Amount
  Widget Type A              100   500.00   50,000.00
  Widget Type B               50   800.00   40,000.00
  
  Sub Total: 90,000.00
  CGST (9%): 8,100.00
  SGST (9%): 8,100.00
  Total: 1,06,200.00
  
  Payment Due: 30 Days
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
  
  Address: 123 Business Park, Mumbai 400001
`;

const BANK_DOCUMENT_TEXT = `
  BANK CONFIRMATION LETTER
  
  Account Holder Name: ABC Manufacturing Pvt Ltd
  Account Number: 1234567890123
  IFSC: SBIN0001234
  Branch: Mumbai Main Branch
  
  This is to confirm that the above account is maintained
  with our bank and is in active status.
`;

const RESUME_TEXT = `
  JOHN DOE
  Software Engineer
  
  EDUCATION
  B.Tech Computer Science, IIT Bombay 2018
  
  EXPERIENCE
  Senior Developer at TechCorp (2020-2024)
  - Led a team of 5 engineers
  - Built microservices architecture
  
  SKILLS
  TypeScript, Python, React, Node.js
`;

// ---------------------------------------------------------------------------
// Classification tests
// ---------------------------------------------------------------------------

describe('incorporation proof classification', () => {
  it('classifies valid incorporation certificate', () => {
    const result = classifyIncorporationProof(
      VALID_INCORPORATION_CERTIFICATE_TEXT
    );

    expect(result.isIncorporationProof).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(3);
    expect(result.matchedIndicators).toContain(
      'CERTIFICATE OF INCORPORATION'
    );
    expect(result.matchedIndicators).toContain(
      'MINISTRY OF CORPORATE AFFAIRS'
    );
  });

  it('rejects invoice as incorporation proof', () => {
    const result = classifyIncorporationProof(INVOICE_TEXT);

    expect(result.isIncorporationProof).toBe(false);
  });

  it('rejects GST certificate as incorporation proof', () => {
    const result = classifyIncorporationProof(
      GST_CERTIFICATE_TEXT
    );

    expect(result.isIncorporationProof).toBe(false);
  });

  it('rejects bank document as incorporation proof', () => {
    const result = classifyIncorporationProof(
      BANK_DOCUMENT_TEXT
    );

    expect(result.isIncorporationProof).toBe(false);
  });

  it('rejects resume as incorporation proof', () => {
    const result = classifyIncorporationProof(RESUME_TEXT);

    expect(result.isIncorporationProof).toBe(false);
  });

  it('detects CIN as standalone indicator via word boundary', () => {
    const text =
      'Certificate of Incorporation\nCIN: U72200MH2020PTC123456\nRegistrar of Companies\nCompanies Act';
    const result = classifyIncorporationProof(text);

    expect(result.matchedIndicators).toContain('CIN');
    expect(result.isIncorporationProof).toBe(true);
  });

  it('does not double-count CIN when CORPORATE IDENTITY NUMBER is present', () => {
    const text =
      'Certificate of Incorporation\nCorporate Identity Number: U72200MH2020PTC123456\nCIN: U72200MH2020PTC123456\nRegistrar of Companies\nCompanies Act';
    const result = classifyIncorporationProof(text);

    const cinCount = result.matchedIndicators.filter(
      (i) => i === 'CIN'
    ).length;
    const corpIdCount = result.matchedIndicators.filter(
      (i) => i === 'CORPORATE IDENTITY NUMBER'
    ).length;

    expect(cinCount + corpIdCount).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Company name extraction tests
// ---------------------------------------------------------------------------

describe('company name extraction', () => {
  it('extracts company name from "Company Name:" label', () => {
    const text =
      'Company Name: ABC Manufacturing Private Limited\nSome other text';
    expect(extractIncorporationCompanyName(text)).toBe(
      'ABC Manufacturing Private Limited'
    );
  });

  it('extracts company name from "Name of the Company:" label', () => {
    const text =
      'Name of the Company: XYZ Solutions Ltd.\nAddress: Mumbai';
    expect(extractIncorporationCompanyName(text)).toBe(
      'XYZ Solutions Ltd.'
    );
  });

  it('extracts company name from "Corporate Name:" label', () => {
    const text = 'Corporate Name: TechCorp India Pvt. Ltd.';
    expect(extractIncorporationCompanyName(text)).toBe(
      'TechCorp India Pvt. Ltd.'
    );
  });

  it('extracts company name from "Legal Name:" label', () => {
    const text = 'Legal Name: Acme Industries Limited';
    expect(extractIncorporationCompanyName(text)).toBe(
      'Acme Industries Limited'
    );
  });

  it('returns null for text without labelled company name', () => {
    expect(
      extractIncorporationCompanyName(
        'Some random text without labels'
      )
    ).toBeNull();
  });

  it('extracts from incorporation certificate text', () => {
    const name = extractIncorporationCompanyName(
      VALID_INCORPORATION_CERTIFICATE_TEXT
    );
    expect(name).toBe('ABC Manufacturing Private Limited');
  });

  it('extracts company name following "I hereby certify that"', () => {
    const text = 'I hereby certify that\nABC PRIVATE LIMITED\nis this day incorporated under the Companies Act';
    expect(extractIncorporationCompanyName(text)).toBe('ABC PRIVATE LIMITED');
  });

  it('extracts company name following "I hereby certify that" with OCR whitespace', () => {
    const text = 'I hereby certify that\n\n ABC   PRIVATE   LIMITED \n\n is this day incorporated';
    expect(extractIncorporationCompanyName(text)).toBe('ABC PRIVATE LIMITED');
  });

  it('extracts company name near "CERTIFICATE OF INCORPORATION"', () => {
    const text = 'CERTIFICATE OF INCORPORATION\n\nThis is to certify that XYZ PVT. LTD. has been incorporated';
    expect(extractIncorporationCompanyName(text)).toBe('XYZ PVT. LTD.');
  });
});

// ---------------------------------------------------------------------------
// Company name normalization tests
// ---------------------------------------------------------------------------

describe('company name normalization', () => {
  it('converts to uppercase and trims', () => {
    expect(normalizeCompanyName('  abc corp  ')).toBe(
      'ABC CORP'
    );
  });

  it('collapses repeated whitespace', () => {
    expect(
      normalizeCompanyName('ABC   Manufacturing   Corp')
    ).toBe('ABC MANUFACTURING CORP');
  });

  it('removes punctuation', () => {
    expect(
      normalizeCompanyName('A.B.C. Corp.')
    ).toBe('ABC CORP');
  });

  it('normalizes "Pvt Ltd" to "PRIVATE LIMITED"', () => {
    expect(
      normalizeCompanyName('ABC Manufacturing Pvt Ltd')
    ).toBe('ABC MANUFACTURING PRIVATE LIMITED');
  });

  it('normalizes "PVT. LTD." to "PRIVATE LIMITED"', () => {
    expect(
      normalizeCompanyName('ABC Manufacturing PVT. LTD.')
    ).toBe('ABC MANUFACTURING PRIVATE LIMITED');
  });

  it('normalizes "Private Ltd" to "PRIVATE LIMITED"', () => {
    expect(
      normalizeCompanyName('ABC Manufacturing Private Ltd')
    ).toBe('ABC MANUFACTURING PRIVATE LIMITED');
  });

  it('normalizes "Ltd" to "LIMITED"', () => {
    expect(
      normalizeCompanyName('ABC Manufacturing Ltd')
    ).toBe('ABC MANUFACTURING LIMITED');
  });

  it('normalizes "LTD." to "LIMITED"', () => {
    expect(
      normalizeCompanyName('ABC Manufacturing LTD.')
    ).toBe('ABC MANUFACTURING LIMITED');
  });

  it('preserves "PRIVATE LIMITED" as-is', () => {
    expect(
      normalizeCompanyName(
        'ABC Manufacturing Private Limited'
      )
    ).toBe('ABC MANUFACTURING PRIVATE LIMITED');
  });
});

// ---------------------------------------------------------------------------
// Company name matching tests
// ---------------------------------------------------------------------------

describe('company name matching', () => {
  it('matches identical names', () => {
    expect(
      companyNamesMatch(
        'ABC Manufacturing Pvt Ltd',
        'ABC Manufacturing Pvt Ltd'
      )
    ).toBe(true);
  });

  it('matches names with Pvt Ltd vs Private Limited suffix differences', () => {
    expect(
      companyNamesMatch(
        'ABC Manufacturing Pvt Ltd',
        'ABC Manufacturing Private Limited'
      )
    ).toBe(true);
  });

  it('matches names with PVT. LTD. vs Private Limited suffix differences', () => {
    expect(
      companyNamesMatch(
        'ABC Manufacturing PVT. LTD.',
        'ABC Manufacturing Private Limited'
      )
    ).toBe(true);
  });

  it('matches names with Ltd vs Limited suffix differences', () => {
    expect(
      companyNamesMatch(
        'ABC Manufacturing Ltd',
        'ABC Manufacturing Limited'
      )
    ).toBe(true);
  });

  it('rejects completely different company names', () => {
    expect(
      companyNamesMatch(
        'ABC Manufacturing Pvt Ltd',
        'XYZ Solutions Private Limited'
      )
    ).toBe(false);
  });

  it('rejects partially similar but different company names', () => {
    expect(
      companyNamesMatch(
        'ABC Manufacturing Pvt Ltd',
        'ABC Trading Pvt Ltd'
      )
    ).toBe(false);
  });

  it('is case insensitive', () => {
    expect(
      companyNamesMatch(
        'abc manufacturing pvt ltd',
        'ABC MANUFACTURING PRIVATE LIMITED'
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GST company name resolution tests
// ---------------------------------------------------------------------------

describe('GST company name resolution', () => {
  it('extracts from extractedFields.legalName', () => {
    const ctx = createContext({
      extractedFields: { legalName: 'ABC Corp Pvt Ltd' },
    });
    expect(getGstCompanyName(ctx)).toBe('ABC Corp Pvt Ltd');
  });

  it('extracts from extractedFields.companyName', () => {
    const ctx = createContext({
      extractedFields: { companyName: 'ABC Corp' },
    });
    expect(getGstCompanyName(ctx)).toBe('ABC Corp');
  });

  it('falls back to GST_CERTIFICATE document extractedFields', () => {
    const ctx = createContext({
      extractedFields: {},
      documents: [
        createDocument({
          id: 'gst-doc',
          verified: true,
          category: 'GST_CERTIFICATE',
          validationStatus: 'passed',
          extractedFields: {
            legalName: 'From GST Doc Corp',
          },
        }),
      ],
    });
    expect(getGstCompanyName(ctx)).toBe(
      'From GST Doc Corp'
    );
  });

  it('returns null when no GST evidence available', () => {
    const ctx = createContext({
      extractedFields: {},
      documents: [],
    });
    expect(getGstCompanyName(ctx)).toBeNull();
  });

  it('prefers extractedFields over document fields', () => {
    const ctx = createContext({
      extractedFields: {
        legalName: 'From Workflow Fields',
      },
      documents: [
        createDocument({
          id: 'gst-doc',
          verified: true,
          category: 'GST_CERTIFICATE',
          validationStatus: 'passed',
          extractedFields: {
            legalName: 'From GST Doc',
          },
        }),
      ],
    });
    expect(getGstCompanyName(ctx)).toBe(
      'From Workflow Fields'
    );
  });
});

// ---------------------------------------------------------------------------
// Missing GST company name evidence test
// ---------------------------------------------------------------------------

describe('missing GST company name evidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns validationPassed false when GST name unavailable', async () => {
    mockExtractDocumentText.mockResolvedValue({
      text: VALID_INCORPORATION_CERTIFICATE_TEXT,
      readable: true,
      method: 'PDF_TEXT',
      confidence: 1,
    });

    mockUpdateDocumentValidation.mockResolvedValue({});

    const result = await dispatchWorker(
      'incorporation_agent',
      createContext({
        documents: [createDocument()],
        extractedFields: {},
      })
    );

    expect(result.success).toBe(true);
    expect(result.validationPassed).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.outboundMessage).toContain(
      'GST company-name evidence is unavailable'
    );
  });
});

// ---------------------------------------------------------------------------
// Plain-text company name rejection test
// ---------------------------------------------------------------------------

describe('plain-text company name rejection', () => {
  it('does not accept plain-text company name without uploaded document', async () => {
    const result = await dispatchWorker(
      'incorporation_agent',
      createContext({
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content:
              'My company is ABC Manufacturing Pvt Ltd',
            createdAt: new Date(),
          },
        ],
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
// Company name mismatch test
// ---------------------------------------------------------------------------

describe('company name mismatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails validation when company names do not match', async () => {
    const mismatchCertText = VALID_INCORPORATION_CERTIFICATE_TEXT.replace(
      'ABC Manufacturing Private Limited',
      'XYZ Solutions Private Limited'
    );

    mockExtractDocumentText.mockResolvedValue({
      text: mismatchCertText,
      readable: true,
      method: 'PDF_TEXT',
      confidence: 1,
    });

    mockUpdateDocumentValidation.mockResolvedValue({});

    const result = await dispatchWorker(
      'incorporation_agent',
      createContext({
        documents: [createDocument()],
        extractedFields: {
          legalName: 'ABC Manufacturing Private Limited',
        },
      })
    );

    expect(result.success).toBe(true);
    expect(result.validationPassed).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.outboundMessage).toContain(
      'does not match'
    );
    expect(result.extractedData?.incorporationCompanyName).toBe(
      'XYZ Solutions Private Limited'
    );
    expect(result.extractedData?.gstCompanyName).toBe(
      'ABC Manufacturing Private Limited'
    );
    expect(result.extractedData?.companyNameMatch).toBe(
      false
    );
  });
});

// ---------------------------------------------------------------------------
// Successful incorporation worker validation test
// ---------------------------------------------------------------------------

describe('successful incorporation worker validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes validation with matching company names', async () => {
    mockExtractDocumentText.mockResolvedValue({
      text: VALID_INCORPORATION_CERTIFICATE_TEXT,
      readable: true,
      method: 'PDF_TEXT',
      confidence: 1,
    });

    mockUpdateDocumentValidation.mockResolvedValue({});

    const result = await dispatchWorker(
      'incorporation_agent',
      createContext({
        documents: [createDocument()],
        extractedFields: {
          legalName: 'ABC Manufacturing Pvt Ltd',
        },
      })
    );

    expect(result.success).toBe(true);
    expect(result.validationPassed).toBe(true);
    expect(result.retryable).toBe(false);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.extractedData?.incorporationCompanyName).toBe(
      'ABC Manufacturing Private Limited'
    );
    expect(result.extractedData?.gstCompanyName).toBe(
      'ABC Manufacturing Pvt Ltd'
    );
    expect(result.extractedData?.companyNameMatch).toBe(
      true
    );
    expect(
      result.extractedData?.incorporationProofType
    ).toBe('CERTIFICATE_OF_INCORPORATION');

    // Verify updateDocumentValidation was called with 'passed' and 'INCORPORATION_PROOF'
    expect(
      mockUpdateDocumentValidation
    ).toHaveBeenCalledWith(
      'document-1',
      'passed',
      expect.objectContaining({
        incorporationCompanyName:
          'ABC Manufacturing Private Limited',
        companyNameMatch: true,
        incorporationProofType:
          'CERTIFICATE_OF_INCORPORATION',
      }),
      expect.any(Number),
      undefined,
      'INCORPORATION_PROOF'
    );
  });

  it('passes validation when names match with PVT. LTD. vs Private Limited', async () => {
    mockExtractDocumentText.mockResolvedValue({
      text: VALID_INCORPORATION_CERTIFICATE_TEXT,
      readable: true,
      method: 'PDF_TEXT',
      confidence: 1,
    });

    mockUpdateDocumentValidation.mockResolvedValue({});

    const result = await dispatchWorker(
      'incorporation_agent',
      createContext({
        documents: [createDocument()],
        extractedFields: {
          legalName: 'ABC Manufacturing PVT. LTD.',
        },
      })
    );

    expect(result.success).toBe(true);
    expect(result.validationPassed).toBe(true);
    expect(result.extractedData?.companyNameMatch).toBe(
      true
    );
  });

  it('fails validation if incorporationCompanyName is null', async () => {
    mockExtractDocumentText.mockResolvedValue({
      readable: true,
      text: 'Ministry of Corporate Affairs. CERTIFICATE OF INCORPORATION. REGISTERED OFFICE. Just some text without name.',
      confidence: 0.9,
    });

    const result = await dispatchWorker(
      'incorporation_agent',
      createContext({
        documents: [createDocument()],
        extractedFields: {
          legalName: 'ABC Manufacturing PVT. LTD.',
        },
      })
    );

    expect(result.validationPassed).toBe(false);
    expect(result.success).toBe(true);
    expect(result.outboundMessage).toContain('could not find the company name');
    expect(mockUpdateDocumentValidation).toHaveBeenCalledWith(
      'document-1',
      'failed',
      expect.objectContaining({
        incorporationCompanyName: null,
        companyNameMatch: false,
      }),
      expect.any(Number),
      'Could not extract company name from the incorporation proof.'
    );
  });
});

// ---------------------------------------------------------------------------
// Prerequisite guard requiring verified INCORPORATION_PROOF
// ---------------------------------------------------------------------------

describe('prerequisite guard INCORPORATION_PROOF requirement', () => {
  // Import inline to avoid circular dependency issues with mocks
  it('blocks VALIDATING without INCORPORATION_PROOF', async () => {
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
      ]
    );

    expect(result.passed).toBe(false);
    expect(result.reason).toContain(
      'incorporation-proof'
    );
  });

  it('allows VALIDATING with all prerequisites including INCORPORATION_PROOF', async () => {
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
        companyNameMatch: true,
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

  it('blocks PENDING_APPROVAL without INCORPORATION_PROOF', async () => {
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
      ]
    );

    expect(result.passed).toBe(false);
    expect(result.reason).toContain(
      'incorporation-proof'
    );
  });

  it('allows PENDING_APPROVAL with all prerequisites including INCORPORATION_PROOF', async () => {
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
        companyNameMatch: true,
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
