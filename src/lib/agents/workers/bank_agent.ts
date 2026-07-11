import { extractDocumentText } from '../../document/textExtraction';
import { updateDocumentValidation } from '../../document/ingestion';
import {
  WorkerContext,
  WorkerDocument,
  WorkerResult,
} from './types';

const IFSC_REGEX = /\b[A-Z]{4}0[A-Z0-9]{6}\b/g;

const CANCELLED_CHEQUE_INDICATORS = [
  'CANCELLED',
  'CANCELED',
  'PAY',
  'RUPEES',
  'A/C',
  'ACCOUNT',
  'IFSC',
  'MICR',
];

const BANK_CONFIRMATION_INDICATORS = [
  'ACCOUNT HOLDER',
  'ACCOUNT NUMBER',
  'IFSC',
  'BRANCH',
  'CUSTOMER NAME',
  'ACCOUNT DETAILS',
  'CONFIRMATION',
];

export type BankProofType =
  | 'CANCELLED_CHEQUE'
  | 'BANK_CONFIRMATION_LETTER'
  | 'UNRECOGNIZED_DOCUMENT';

export interface BankProofClassification {
  proofType: BankProofType;
  score: number;
  matchedIndicators: string[];
}

export function normalizeIfsc(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '');
}

export function isValidIfsc(value: string): boolean {
  const normalizedIfsc = normalizeIfsc(value);

  return (
    normalizedIfsc.length === 11 &&
    /^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalizedIfsc)
  );
}

export function extractIfsc(text: string): string | null {
  const matches = text.toUpperCase().match(IFSC_REGEX);

  if (!matches) {
    return null;
  }

  for (const match of matches) {
    const ifsc = normalizeIfsc(match);

    if (isValidIfsc(ifsc)) {
      return ifsc;
    }
  }

  return null;
}

export function classifyBankProof(
  text: string
): BankProofClassification {
  const normalizedText = text
    .toUpperCase()
    .replace(/\s+/g, ' ');

  const chequeMatches =
    CANCELLED_CHEQUE_INDICATORS.filter((indicator) =>
      normalizedText.includes(indicator)
    );

  const confirmationMatches =
    BANK_CONFIRMATION_INDICATORS.filter((indicator) =>
      normalizedText.includes(indicator)
    );

  if (
    chequeMatches.length >= 3 &&
    chequeMatches.length >= confirmationMatches.length
  ) {
    return {
      proofType: 'CANCELLED_CHEQUE',
      score: chequeMatches.length,
      matchedIndicators: chequeMatches,
    };
  }

  if (confirmationMatches.length >= 3) {
    return {
      proofType: 'BANK_CONFIRMATION_LETTER',
      score: confirmationMatches.length,
      matchedIndicators: confirmationMatches,
    };
  }

  return {
    proofType: 'UNRECOGNIZED_DOCUMENT',
    score: Math.max(
      chequeMatches.length,
      confirmationMatches.length
    ),
    matchedIndicators:
      chequeMatches.length >= confirmationMatches.length
        ? chequeMatches
        : confirmationMatches,
  };
}

function cleanExtractedValue(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/[|]/g, '')
    .trim();
}

export function extractAccountNumber(
  text: string
): string | null {
  const patterns = [
    /(?:ACCOUNT\s*(?:NUMBER|NO\.?|#)|A\/C\s*(?:NUMBER|NO\.?|#)?|AC\s*(?:NUMBER|NO\.?))\s*[:\-]?\s*([0-9][0-9\s-]{7,24})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (!match?.[1]) {
      continue;
    }

    const accountNumber = match[1].replace(/\D/g, '');

    if (
      accountNumber.length >= 8 &&
      accountNumber.length <= 20
    ) {
      return accountNumber;
    }
  }

  return null;
}

export function extractAccountHolderName(
  text: string
): string | null {
  const patterns = [
    /Account Holder Name\s*[:\-]?\s*([^\n]+)/i,
    /Name of Account Holder\s*[:\-]?\s*([^\n]+)/i,
    /Customer Name\s*[:\-]?\s*([^\n]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (!match?.[1]) {
      continue;
    }

    const holderName = cleanExtractedValue(match[1]);

    if (
      holderName.length >= 2 &&
      holderName.length <= 150 &&
      /[A-Z]/i.test(holderName)
    ) {
      return holderName;
    }
  }

  return null;
}

function getLatestUnverifiedDocument(
  context: WorkerContext
): WorkerDocument | null {
  const documents = context.documents;

  return (
    documents.find(
      (document) =>
        !document.verified &&
        document.validationStatus !== 'passed'
    ) ?? null
  );
}

function calculateBankConfidence(
  classificationScore: number,
  hasIfsc: boolean,
  hasAccountNumber: boolean,
  hasHolderName: boolean,
  extractionConfidence?: number
): number {
  let confidence = 0;

  confidence += Math.min(
    0.3,
    classificationScore * 0.05
  );

  if (hasIfsc) {
    confidence += 0.25;
  }

  if (hasAccountNumber) {
    confidence += 0.25;
  }

  if (hasHolderName) {
    confidence += 0.1;
  }

  if (typeof extractionConfidence === 'number') {
    confidence += extractionConfidence * 0.1;
  } else {
    confidence += 0.1;
  }

  return Math.min(
    1,
    Number(confidence.toFixed(2))
  );
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
        'Please upload a clear cancelled cheque or bank confirmation letter. Bank details sent only as text are not enough for verification.',
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
        'Bank proof could not be read.'
    );

    return {
      success: true,
      validationPassed: false,
      confidence: extractionResult.confidence,
      outboundMessage:
        "I couldn't read that bank proof clearly. Please upload a clear cancelled cheque or bank confirmation letter.",
      retryable: true,
    };
  }

  const classification = classifyBankProof(
    extractionResult.text
  );

  if (
    classification.proofType ===
    'UNRECOGNIZED_DOCUMENT'
  ) {
    const confidence = calculateBankConfidence(
      classification.score,
      false,
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
      'Document did not meet bank-proof classification threshold.'
    );

    return {
      success: true,
      validationPassed: false,
      confidence,
      outboundMessage:
        "That document doesn't appear to be a cancelled cheque or bank confirmation letter. Please upload a valid bank-proof document.",
      retryable: true,
    };
  }

  const ifsc = extractIfsc(extractionResult.text);

  const accountNumber = extractAccountNumber(
    extractionResult.text
  );

  const holderName = extractAccountHolderName(
    extractionResult.text
  );

  const confidence = calculateBankConfidence(
    classification.score,
    ifsc !== null,
    accountNumber !== null,
    holderName !== null,
    extractionResult.confidence
  );

  const extractedData: Record<string, unknown> = {
    ifsc,
    accountNumber,
    holderName,
    proofType: classification.proofType,
  };

  if (!ifsc || !accountNumber) {
    await updateDocumentValidation(
      document.id,
      'failed',
      extractedData,
      confidence,
      !ifsc
        ? 'Valid IFSC could not be extracted.'
        : 'Account number could not be extracted.'
    );

    return {
      success: true,
      validationPassed: false,
      extractedData,
      confidence,
      outboundMessage:
        "I couldn't verify the required bank details from that document. Please upload a clear cancelled cheque or bank confirmation letter showing the account number and IFSC.",
      retryable: true,
    };
  }

  await updateDocumentValidation(
  document.id,
  'passed',
  extractedData,
  confidence,
  holderName
    ? undefined
    : 'Account holder name was not reliably extracted; human review recommended.',
  'BANK_PROOF'
);

  return {
    success: true,
    validationPassed: true,
    extractedData,
    confidence,
    outboundMessage: holderName
      ? 'Bank proof validated successfully. I extracted the account details and will continue with your onboarding.'
      : 'Bank proof validated with the account number and IFSC. The account holder name could not be read reliably and should be reviewed during approval.',
    retryable: false,
  };
}