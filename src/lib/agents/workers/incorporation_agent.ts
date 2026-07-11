import { extractDocumentText } from '../../document/textExtraction';
import { updateDocumentValidation } from '../../document/ingestion';
import {
  WorkerContext,
  WorkerDocument,
  WorkerResult,
} from './types';

// ---------------------------------------------------------------------------
// Incorporation-proof classification indicators
// ---------------------------------------------------------------------------

const INCORPORATION_INDICATORS = [
  'CERTIFICATE OF INCORPORATION',
  'MINISTRY OF CORPORATE AFFAIRS',
  'REGISTRAR OF COMPANIES',
  'COMPANIES ACT',
  'CORPORATE IDENTITY NUMBER',
  'DATE OF INCORPORATION',
  'COMPANY NAME',
  'REGISTERED OFFICE',
];

/**
 * Strong indicators that are highly specific to incorporation certificates
 * and unlikely to appear in invoices, GST certs or bank documents.
 */
const STRONG_INCORPORATION_INDICATORS = [
  'CERTIFICATE OF INCORPORATION',
  'MINISTRY OF CORPORATE AFFAIRS',
  'REGISTRAR OF COMPANIES',
  'CORPORATE IDENTITY NUMBER',
];

const INCORPORATION_CLASSIFICATION_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export interface IncorporationClassificationResult {
  isIncorporationProof: boolean;
  score: number;
  matchedIndicators: string[];
}

export function classifyIncorporationProof(
  text: string
): IncorporationClassificationResult {
  const normalizedText = text
    .toUpperCase()
    .replace(/\s+/g, ' ');

  const matchedIndicators = INCORPORATION_INDICATORS.filter(
    (indicator) => normalizedText.includes(indicator)
  );

  // Check CIN as a separate short-token indicator with word boundary
  if (
    /\bCIN\b/.test(normalizedText) &&
    !matchedIndicators.includes('CORPORATE IDENTITY NUMBER')
  ) {
    matchedIndicators.push('CIN');
  }

  const hasStrongIndicator = STRONG_INCORPORATION_INDICATORS.some(
    (indicator) => matchedIndicators.includes(indicator)
  );

  const score = matchedIndicators.length;

  return {
    isIncorporationProof:
      score >= INCORPORATION_CLASSIFICATION_THRESHOLD &&
      hasStrongIndicator,
    score,
    matchedIndicators,
  };
}

// ---------------------------------------------------------------------------
// Company name extraction from incorporation proof
// ---------------------------------------------------------------------------

export function extractIncorporationCompanyName(
  text: string
): string | null {
  const normalizedText = text.replace(/\r/g, '');

  const patterns = [
    /Name of the Company\s*[:\-]?\s*([^\n]+)/i,
    /Company Name\s*[:\-]?\s*([^\n]+)/i,
    /Corporate Name\s*[:\-]?\s*([^\n]+)/i,
    /Legal Name\s*[:\-]?\s*([^\n]+)/i,
  ];

  for (const pattern of patterns) {
    const match = normalizedText.match(pattern);

    if (!match?.[1]) {
      continue;
    }

    const companyName = match[1]
      .replace(/\s+/g, ' ')
      .trim();

    if (
      companyName.length >= 2 &&
      companyName.length <= 200
    ) {
      return companyName;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Company name normalization for safe comparison
// ---------------------------------------------------------------------------

export function normalizeCompanyName(name: string): string {
  let normalized = name.toUpperCase().trim();

  // Collapse repeated whitespace
  normalized = normalized.replace(/\s+/g, ' ');

  // Remove punctuation — keep only letters, digits, whitespace
  normalized = normalized.replace(/[^A-Z0-9\s]/g, '');

  // Collapse whitespace again after punctuation removal
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // Normalize company suffixes to canonical forms
  // Order matters: handle multi-word patterns before single-word
  normalized = normalized
    .replace(/\bPVT\s+LTD\b/g, 'PRIVATE LIMITED')
    .replace(/\bPVT\s+LIMITED\b/g, 'PRIVATE LIMITED')
    .replace(/\bPRIVATE\s+LTD\b/g, 'PRIVATE LIMITED');

  // Handle standalone LTD at end (not part of PVT LTD, already normalized)
  if (/\bLTD$/.test(normalized) && !/PRIVATE LIMITED$/.test(normalized)) {
    normalized = normalized.replace(/\bLTD$/, 'LIMITED');
  }

  return normalized.trim();
}

export function companyNamesMatch(
  name1: string,
  name2: string
): boolean {
  return normalizeCompanyName(name1) === normalizeCompanyName(name2);
}

// ---------------------------------------------------------------------------
// GST company name resolution
// ---------------------------------------------------------------------------

export function getGstCompanyName(
  context: WorkerContext
): string | null {
  // 1. Check workflow extractedFields
  const fields = context.extractedFields ?? {};

  for (const key of [
    'legalName',
    'companyName',
    'gstLegalName',
    'gstCompanyName',
  ]) {
    const value = fields[key];

    if (
      typeof value === 'string' &&
      value.trim().length > 0
    ) {
      return value.trim();
    }
  }

  // 2. Check latest verified GST_CERTIFICATE document extractedFields
  const gstDocument = [...context.documents]
    .reverse()
    .find(
      (doc) =>
        doc.verified &&
        doc.category === 'GST_CERTIFICATE' &&
        doc.extractedFields != null
    );

  if (
    gstDocument &&
    typeof gstDocument.extractedFields === 'object' &&
    gstDocument.extractedFields !== null
  ) {
    const docFields = gstDocument.extractedFields as Record<
      string,
      unknown
    >;

    for (const key of [
      'legalName',
      'companyName',
      'gstLegalName',
      'gstCompanyName',
    ]) {
      const value = docFields[key];

      if (
        typeof value === 'string' &&
        value.trim().length > 0
      ) {
        return value.trim();
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLatestUnverifiedDocument(
  context: WorkerContext
): WorkerDocument | null {
  const documents = [...context.documents].reverse();

  return (
    documents.find(
      (doc) =>
        !doc.verified &&
        doc.validationStatus !== 'passed'
    ) ?? null
  );
}

function calculateIncorporationConfidence(
  classificationScore: number,
  hasCompanyName: boolean,
  nameMatched: boolean,
  extractionConfidence?: number
): number {
  let confidence = 0;

  // Classification score component (max 0.4)
  confidence += Math.min(
    0.4,
    classificationScore * 0.06
  );

  // Company name extracted
  if (hasCompanyName) {
    confidence += 0.2;
  }

  // Company name match verified
  if (nameMatched) {
    confidence += 0.25;
  }

  // Text extraction method confidence
  if (typeof extractionConfidence === 'number') {
    confidence += extractionConfidence * 0.15;
  } else {
    confidence += 0.15;
  }

  return Math.min(1, Number(confidence.toFixed(2)));
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

export async function run(
  context: WorkerContext
): Promise<WorkerResult> {
  // -----------------------------------------------------------------------
  // 1. Require a real uploaded document (Requirement 3)
  // -----------------------------------------------------------------------
  const document = getLatestUnverifiedDocument(context);

  if (!document) {
    return {
      success: true,
      validationPassed: false,
      outboundMessage:
        'Please upload your Certificate of Incorporation as a PDF or clear image. A company name sent as text is not enough for verification.',
      retryable: true,
    };
  }

  // -----------------------------------------------------------------------
  // 2. Extract text using the existing abstraction (Requirement 4, 6)
  // -----------------------------------------------------------------------
  const extractionResult =
    await extractDocumentText(document);

  if (!extractionResult.readable) {
    await updateDocumentValidation(
      document.id,
      'failed',
      undefined,
      extractionResult.confidence,
      extractionResult.reason ??
        'Document text could not be read.'
    );

    return {
      success: true,
      validationPassed: false,
      confidence: extractionResult.confidence,
      outboundMessage:
        'I could not read that document clearly. Please upload a clearer Certificate of Incorporation as a PDF or image.',
      retryable: true,
    };
  }

  // -----------------------------------------------------------------------
  // 3. Classify as incorporation proof (Requirement 7, 8)
  // -----------------------------------------------------------------------
  const classification = classifyIncorporationProof(
    extractionResult.text
  );

  if (!classification.isIncorporationProof) {
    const confidence = calculateIncorporationConfidence(
      classification.score,
      false,
      false,
      extractionResult.confidence
    );

    await updateDocumentValidation(
      document.id,
      'failed',
      {
        classification: 'UNRECOGNIZED_DOCUMENT',
        matchedIndicators:
          classification.matchedIndicators,
      },
      confidence,
      'Document did not meet incorporation proof classification threshold.'
    );

    return {
      success: true,
      validationPassed: false,
      confidence,
      outboundMessage:
        'The uploaded document does not appear to be company incorporation proof. Please upload your Certificate of Incorporation issued by the Registrar of Companies.',
      retryable: true,
    };
  }

  // -----------------------------------------------------------------------
  // 4. Extract company name from incorporation proof (Requirement 9)
  // -----------------------------------------------------------------------
  const incorporationCompanyName =
    extractIncorporationCompanyName(extractionResult.text);

  // -----------------------------------------------------------------------
  // 5. Determine GST company name (Requirement 10)
  // -----------------------------------------------------------------------
  const gstCompanyName = getGstCompanyName(context);

  // -----------------------------------------------------------------------
  // 6. Handle missing GST company name (Requirement 12)
  // -----------------------------------------------------------------------
  if (!gstCompanyName) {
    const confidence = calculateIncorporationConfidence(
      classification.score,
      incorporationCompanyName !== null,
      false,
      extractionResult.confidence
    );

    await updateDocumentValidation(
      document.id,
      'failed',
      {
        classification: 'INCORPORATION_PROOF',
        incorporationCompanyName,
        gstCompanyName: null,
        companyNameMatch: false,
      },
      confidence,
      'GST company-name evidence is unavailable for comparison.'
    );

    return {
      success: true,
      validationPassed: false,
      confidence,
      outboundMessage:
        'I classified your incorporation proof, but GST company-name evidence is unavailable. Please complete GST verification first so we can verify company-name consistency.',
      retryable: true,
      extractedData: {
        incorporationCompanyName,
        gstCompanyName: null,
        companyNameMatch: false,
        incorporationProofType: 'CERTIFICATE_OF_INCORPORATION',
      },
    };
  }

  if (!incorporationCompanyName) {
    const confidence = calculateIncorporationConfidence(
      classification.score,
      false,
      false,
      extractionResult.confidence
    );

    await updateDocumentValidation(
      document.id,
      'failed',
      {
        classification: 'INCORPORATION_PROOF',
        incorporationCompanyName: null,
        gstCompanyName,
        companyNameMatch: false,
      },
      confidence,
      'Could not extract company name from the incorporation proof.'
    );

    return {
      success: true,
      validationPassed: false,
      confidence,
      outboundMessage:
        'I could not find the company name on your incorporation proof. Please upload a clearer Certificate of Incorporation.',
      retryable: true,
      extractedData: {
        incorporationCompanyName: null,
        gstCompanyName,
        companyNameMatch: false,
        incorporationProofType: 'CERTIFICATE_OF_INCORPORATION',
      },
    };
  }

  // -----------------------------------------------------------------------
  // 7. Compare incorporation and GST company names (Requirement 11)
  // -----------------------------------------------------------------------
  if (!companyNamesMatch(incorporationCompanyName, gstCompanyName)) {
    const confidence = calculateIncorporationConfidence(
      classification.score,
      true,
      false,
      extractionResult.confidence
    );

    await updateDocumentValidation(
      document.id,
      'failed',
      {
        classification: 'INCORPORATION_PROOF',
        incorporationCompanyName,
        gstCompanyName,
        companyNameMatch: false,
      },
      confidence,
      'Company name on incorporation proof does not match GST certificate.'
    );

    return {
      success: true,
      validationPassed: false,
      confidence,
      outboundMessage: `The company name on your incorporation proof ("${incorporationCompanyName}") does not match the name on your GST certificate ("${gstCompanyName}"). Please upload the correct Certificate of Incorporation.`,
      retryable: true,
      extractedData: {
        incorporationCompanyName,
        gstCompanyName,
        companyNameMatch: false,
        incorporationProofType: 'CERTIFICATE_OF_INCORPORATION',
      },
    };
  }

  // -----------------------------------------------------------------------
  // 8. Successful validation (Requirement 13)
  // -----------------------------------------------------------------------
  const nameWasCompared = incorporationCompanyName !== null;

  const confidence = calculateIncorporationConfidence(
    classification.score,
    nameWasCompared,
    nameWasCompared,
    extractionResult.confidence
  );

  const extractedData: Record<string, unknown> = {
    incorporationCompanyName,
    gstCompanyName,
    companyNameMatch: nameWasCompared,
    incorporationProofType: 'CERTIFICATE_OF_INCORPORATION',
  };

  await updateDocumentValidation(
    document.id,
    'passed',
    extractedData,
    confidence,
    undefined,
    'INCORPORATION_PROOF'
  );

  return {
    success: true,
    validationPassed: true,
    extractedData,
    confidence,
    outboundMessage:
      'Incorporation proof validated successfully. Company name consistency verified.',
    retryable: false,
  };
}
