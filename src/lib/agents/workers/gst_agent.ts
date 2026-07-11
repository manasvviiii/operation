import { extractDocumentText } from '../../document/textExtraction';
import { updateDocumentValidation } from '../../document/ingestion';
import { WorkerContext, WorkerDocument, WorkerResult } from './types';

const GSTIN_REGEX =
  /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;

const GST_CERTIFICATE_INDICATORS = [
  'GOODS AND SERVICES TAX',
  'GSTIN',
  'REGISTRATION CERTIFICATE',
  'LEGAL NAME',
  'LEGAL NAME OF BUSINESS',
  'TRADE NAME',
  'FORM GST REG-06',
];

const STRONG_GST_INDICATORS = [
  'REGISTRATION CERTIFICATE',
  'FORM GST REG-06',
  'LEGAL NAME OF BUSINESS',
];

const GST_CLASSIFICATION_THRESHOLD = 3;

export function normalizeGstin(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '');
}

export function isValidGstin(value: string): boolean {
  const normalizedGstin = normalizeGstin(value);

  if (normalizedGstin.length !== 15) {
    return false;
  }

  const matches = normalizedGstin.match(GSTIN_REGEX);

  return (
    matches !== null &&
    matches.length === 1 &&
    matches[0] === normalizedGstin
  );
}

export function extractGstin(text: string): string | null {
  const normalizedText = text.toUpperCase();

  const matches = normalizedText.match(GSTIN_REGEX);

  if (!matches || matches.length === 0) {
    return null;
  }

  for (const match of matches) {
    const gstin = normalizeGstin(match);

    if (isValidGstin(gstin)) {
      return gstin;
    }
  }

  return null;
}

export interface GstClassificationResult {
  isGstCertificate: boolean;
  score: number;
  matchedIndicators: string[];
}

export function classifyGstCertificate(
  text: string
): GstClassificationResult {
  const normalizedText = text
    .toUpperCase()
    .replace(/\s+/g, ' ');

  const matchedIndicators =
    GST_CERTIFICATE_INDICATORS.filter((indicator) =>
      normalizedText.includes(indicator)
    );

  const hasStrongIndicator =
    STRONG_GST_INDICATORS.some((indicator) =>
      normalizedText.includes(indicator)
    );

  const score = matchedIndicators.length;

  return {
    isGstCertificate:
      score >= GST_CLASSIFICATION_THRESHOLD &&
      hasStrongIndicator,
    score,
    matchedIndicators,
  };
}

export function extractLegalName(
  text: string
): string | null {
  const normalizedText = text.replace(/\r/g, '');

  const patterns = [
    /Legal Name of Business\s*[:\-]?\s*([^\n]+)/i,
    /Legal Name\s*[:\-]?\s*([^\n]+)/i,
  ];

  for (const pattern of patterns) {
    const match = normalizedText.match(pattern);

    if (!match?.[1]) {
      continue;
    }

    const legalName = match[1]
      .replace(/\s+/g, ' ')
      .trim();

    if (
      legalName.length >= 2 &&
      legalName.length <= 200
    ) {
      return legalName;
    }
  }

  return null;
}

function getLatestUnverifiedDocument(
  context: WorkerContext
): WorkerDocument | null {
  const documents = context.documents;

  const document = documents.find(
    (item) =>
      !item.verified &&
      item.validationStatus !== 'passed'
  );

  return document ?? null;
}

function calculateGstConfidence(
  classificationScore: number,
  hasGstin: boolean,
  hasLegalName: boolean,
  extractionConfidence?: number
): number {
  let confidence = 0;

  confidence += Math.min(
    0.45,
    classificationScore * 0.075
  );

  if (hasGstin) {
    confidence += 0.35;
  }

  if (hasLegalName) {
    confidence += 0.1;
  }

  if (typeof extractionConfidence === 'number') {
    confidence += extractionConfidence * 0.1;
  } else {
    confidence += 0.1;
  }

  return Math.min(1, Number(confidence.toFixed(2)));
}

export async function run(
  context: WorkerContext
): Promise<WorkerResult> {
  const document = getLatestUnverifiedDocument(context);

  if (!document) {
    return {
      success: true,
      validationPassed: false,
      outboundMessage:
        'Please upload your GST registration certificate as a PDF or clear image. A GST number sent as text is not enough for verification.',
      retryable: true,
    };
  }

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
        'I could not read that GST document clearly. Please upload a clearer GST certificate PDF or image showing the GSTIN.',
      retryable: true,
    };
  }

  const classification = classifyGstCertificate(
    extractionResult.text
  );

  if (!classification.isGstCertificate) {
    await updateDocumentValidation(
      document.id,
      'failed',
      {
        classification: 'UNRECOGNIZED_DOCUMENT',
        matchedIndicators:
          classification.matchedIndicators,
      },
      calculateGstConfidence(
        classification.score,
        false,
        false,
        extractionResult.confidence
      ),
      'Document did not meet GST certificate classification threshold.'
    );

    return {
      success: true,
      validationPassed: false,
      outboundMessage:
        "I received the file, but it doesn't appear to be a GST registration certificate. It may be an invoice or another business document. Please upload your GST registration certificate.",
      retryable: true,
    };
  }

  const gstin = extractGstin(extractionResult.text);
  const legalName = extractLegalName(
    extractionResult.text
  );

  const confidence = calculateGstConfidence(
    classification.score,
    gstin !== null,
    legalName !== null,
    extractionResult.confidence
  );

  if (!gstin) {
    await updateDocumentValidation(
      document.id,
      'failed',
      {
        classification: 'GST_CERTIFICATE',
        legalName,
        matchedIndicators:
          classification.matchedIndicators,
      },
      confidence,
      'Valid GSTIN could not be extracted.'
    );

    return {
      success: true,
      validationPassed: false,
      confidence,
      outboundMessage:
        "I couldn't find a valid GSTIN on that GST certificate. Please upload a clear GST certificate showing the GSTIN.",
      retryable: true,
    };
  }

  const extractedData: Record<string, unknown> = {
    gstin,
    gstNumber: gstin,
    legalName,
    classification: 'GST_CERTIFICATE',
  };

  await updateDocumentValidation(
    document.id,
    'passed',
    extractedData,
    confidence,
   undefined,
  'GST_CERTIFICATE'
  );

  return {
    success: true,
    validationPassed: true,
    extractedData,
    confidence,
    outboundMessage:
      'GST certificate validated successfully. I extracted the GSTIN and will continue with your onboarding.',
    retryable: false,
  };
}