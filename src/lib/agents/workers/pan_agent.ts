import { WorkerContext, WorkerResult } from './types';
import { prisma } from '../../prisma';
import { redactForObservability } from '../../observability/redaction';

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const PAN_CANDIDATE_REGEX = /\b[A-Z]{5}[\s-]*[0-9]{4}[\s-]*[A-Z]\b/i;

export function normalizePan(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '');
}

export function isValidPan(value: string): boolean {
  const normalizedPan = normalizePan(value);

  return (
    normalizedPan.length === 10 &&
    PAN_REGEX.test(normalizedPan)
  );
}

export function extractPan(text: string): string | null {
  const match = text.match(PAN_CANDIDATE_REGEX);

  if (!match) {
    return null;
  }

  const normalizedPan = normalizePan(match[0]);

  return isValidPan(normalizedPan)
    ? normalizedPan
    : null;
}

export function getLatestUserMessage(
  messages: { role: string; content: string; createdAt: Date }[]
): string | null {
  const userMessages = messages.filter((message) => message.role === 'user');
  
  if (userMessages.length === 0) {
    return null;
  }
  
  const sorted = userMessages.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return sorted[0].content;
}

function getExistingValidatedPan(
  context: WorkerContext
): string | null {
  const existingPan = context.extractedFields?.panNumber;

  if (
    typeof existingPan === 'string' &&
    isValidPan(existingPan)
  ) {
    return normalizePan(existingPan);
  }

  return null;
}

export async function run(
  context: WorkerContext
): Promise<WorkerResult> {
  const existingPan = getExistingValidatedPan(context);

  if (existingPan) {
    return {
      success: true,
      validationPassed: true,
      extractedData: {
        panNumber: existingPan,
      },
      outboundMessage:
        'Your PAN has already been validated. Continuing with onboarding.',
      retryable: false,
    };
  }

  console.log('[PAN AGENT DEBUG] messages:', context.messages.length);
  const latestUserMessage = getLatestUserMessage(context.messages);
  console.log('[PAN AGENT DEBUG] selected message:', redactForObservability(latestUserMessage));

  if (!latestUserMessage) {
    return {
      success: true,
      validationPassed: false,
      outboundMessage:
        'Please share your PAN number. PAN should contain 10 characters in the format AAAAA9999A, for example ABCDE1234F.',
      retryable: true,
    };
  }

  const panNumber = extractPan(latestUserMessage);
  console.log('[PAN AGENT DEBUG] extracted PAN:', redactForObservability(panNumber));

  if (!panNumber) {
    return {
      success: true,
      validationPassed: false,
      outboundMessage:
        "That doesn't look like a valid PAN. PAN should contain 10 characters in the format AAAAA9999A, for example ABCDE1234F.",
      retryable: true,
    };
  }

  return {
    success: true,
    validationPassed: true,
    extractedData: {
      panNumber,
    },
    outboundMessage:
      'PAN validated successfully. I will continue with your onboarding.',
    confidence: 1,
    retryable: false,
  };
}