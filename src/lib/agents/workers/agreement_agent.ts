import { extractDocumentText } from '../../document/textExtraction';
import { updateDocumentValidation } from '../../document/ingestion';
import {
  WorkerContext,
  WorkerDocument,
  WorkerResult,
} from './types';

// ---------------------------------------------------------------------------
// Vendor Agreement classification indicators
// ---------------------------------------------------------------------------

const AGREEMENT_INDICATORS = [
  'VENDOR AGREEMENT',
  'SUPPLIER AGREEMENT',
  'VENDOR TERMS',
  'TERMS AND CONDITIONS',
  'AUTHORIZED SIGNATORY',
  'AUTHORISED SIGNATORY',
  'AGREEMENT',
  'PARTIES',
  'VENDOR',
  'SUPPLIER',
];

/**
 * Strong indicators highly specific to vendor/supplier agreements.
 * At least one must be present for classification to pass.
 */
const STRONG_AGREEMENT_INDICATORS = [
  'VENDOR AGREEMENT',
  'SUPPLIER AGREEMENT',
  'AUTHORIZED SIGNATORY',
  'AUTHORISED SIGNATORY',
];

const AGREEMENT_CLASSIFICATION_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Signature / signed-status indicators
// ---------------------------------------------------------------------------

const SIGNATURE_INDICATORS = [
  'DIGITALLY SIGNED',
  'ELECTRONICALLY SIGNED',
  'E-SIGNED',
  'AUTHORIZED SIGNATORY',
  'AUTHORISED SIGNATORY',
  'SIGNATURE',
  'SIGNED',
];

/**
 * Short token `/s/` requires word-boundary detection to avoid
 * false matches inside other text.
 */
const SLASH_S_PATTERN = /\/s\//i;

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export interface AgreementClassificationResult {
  isVendorAgreement: boolean;
  score: number;
  matchedIndicators: string[];
}

export function classifyVendorAgreement(
  text: string
): AgreementClassificationResult {
  const normalizedText = text
    .toUpperCase()
    .replace(/\s+/g, ' ');

  const matchedIndicators = AGREEMENT_INDICATORS.filter(
    (indicator) => normalizedText.includes(indicator)
  );

  const hasStrongIndicator = STRONG_AGREEMENT_INDICATORS.some(
    (indicator) => matchedIndicators.includes(indicator)
  );

  const score = matchedIndicators.length;

  return {
    isVendorAgreement:
      score >= AGREEMENT_CLASSIFICATION_THRESHOLD &&
      hasStrongIndicator,
    score,
    matchedIndicators,
  };
}

// ---------------------------------------------------------------------------
// Signature detection
// ---------------------------------------------------------------------------

export interface SignatureDetectionResult {
  hasSigned: boolean;
  matchedIndicators: string[];
}

export function detectSignatureEvidence(
  text: string
): SignatureDetectionResult {
  const normalizedText = text
    .toUpperCase()
    .replace(/\s+/g, ' ');

  const matchedIndicators = SIGNATURE_INDICATORS.filter(
    (indicator) => normalizedText.includes(indicator)
  );

  // Check /s/ pattern separately
  if (SLASH_S_PATTERN.test(text)) {
    matchedIndicators.push('/s/');
  }

  return {
    hasSigned: matchedIndicators.length > 0,
    matchedIndicators,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLatestUnverifiedDocument(
  context: WorkerContext
): WorkerDocument | null {
  const documents = context.documents;

  return (
    documents.find(
      (doc) =>
        !doc.verified &&
        doc.validationStatus !== 'passed'
    ) ?? null
  );
}

function calculateAgreementConfidence(
  classificationScore: number,
  hasSigned: boolean,
  extractionConfidence?: number
): number {
  let confidence = 0;

  // Classification score component (max 0.45)
  confidence += Math.min(
    0.45,
    classificationScore * 0.065
  );

  // Signature evidence
  if (hasSigned) {
    confidence += 0.35;
  }

  // Text extraction method confidence
  if (typeof extractionConfidence === 'number') {
    confidence += extractionConfidence * 0.2;
  } else {
    confidence += 0.2;
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
  // 1. Require a real uploaded document
  // -----------------------------------------------------------------------
  const document = getLatestUnverifiedDocument(context);

  if (!document) {
    return {
      success: true,
      validationPassed: false,
      outboundMessage:
        'Please upload the signed Vendor Agreement as a PDF or clear image. A text message such as "I signed the agreement" is not enough for verification.',
      retryable: true,
    };
  }

  // -----------------------------------------------------------------------
  // 2. Extract text using the existing abstraction
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
        'I could not read that document clearly. Please upload a clearer signed Vendor Agreement as a PDF or image.',
      retryable: true,
    };
  }

  // -----------------------------------------------------------------------
  // 3. Classify as Vendor Agreement
  // -----------------------------------------------------------------------
  const classification = classifyVendorAgreement(
    extractionResult.text
  );

  if (!classification.isVendorAgreement) {
    const confidence = calculateAgreementConfidence(
      classification.score,
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
      'Document did not meet Vendor Agreement classification threshold.'
    );

    return {
      success: true,
      validationPassed: false,
      confidence,
      outboundMessage:
        'The uploaded document does not appear to be the signed Vendor Agreement required for onboarding. Please upload the correct Vendor Agreement document.',
      retryable: true,
    };
  }

  // -----------------------------------------------------------------------
  // 4. Detect signature / signed-status evidence
  // -----------------------------------------------------------------------
  const signatureResult = detectSignatureEvidence(
    extractionResult.text
  );

  if (!signatureResult.hasSigned) {
    const confidence = calculateAgreementConfidence(
      classification.score,
      false,
      extractionResult.confidence
    );

    const extractedData: Record<string, unknown> = {
      agreementType: 'VENDOR_AGREEMENT',
      signed: false,
      agreementIndicators: classification.matchedIndicators,
      signatureIndicators: signatureResult.matchedIndicators,
    };

    await updateDocumentValidation(
      document.id,
      'failed',
      extractedData,
      confidence,
      'Vendor Agreement appears unsigned — no signature evidence detected.'
    );

    return {
      success: true,
      validationPassed: false,
      confidence,
      extractedData,
      outboundMessage:
        'The uploaded document appears to be a Vendor Agreement but it seems unsigned. Please upload the signed version of the Vendor Agreement.',
      retryable: true,
    };
  }

  // -----------------------------------------------------------------------
  // 5. Successful validation
  // -----------------------------------------------------------------------
  const confidence = calculateAgreementConfidence(
    classification.score,
    true,
    extractionResult.confidence
  );

  const extractedData: Record<string, unknown> = {
    agreementType: 'VENDOR_AGREEMENT',
    signed: true,
    agreementIndicators: classification.matchedIndicators,
    signatureIndicators: signatureResult.matchedIndicators,
  };

  await updateDocumentValidation(
    document.id,
    'passed',
    extractedData,
    confidence,
    undefined,
    'VENDOR_AGREEMENT'
  );

  return {
    success: true,
    validationPassed: true,
    extractedData,
    confidence,
    outboundMessage:
      'Signed Vendor Agreement validated successfully. Your onboarding packet is ready for final validation.',
    retryable: false,
  };
}
