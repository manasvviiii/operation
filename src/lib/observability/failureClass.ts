import { z } from 'zod';

export type FailureTaxonomy =
  | 'transient'
  | 'connector_down'
  | 'validation_error'
  | 'business_rule_violation'
  | 'human_rejected'
  | 'unknown';

export function classifyFailure(error: unknown): { taxonomy: FailureTaxonomy; safeMessage: string } {
  let message = '';
  
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  } else {
    message = String(error);
  }

  // Safe redaction: avoid leaking auth headers or keys
  const safeMessage = redactSensitiveInfo(message);

  if (error instanceof z.ZodError) {
    return { taxonomy: 'validation_error', safeMessage: `Schema validation failed: ${error.issues.map(e => e.message).join(', ')}` };
  }

  const msgLower = safeMessage.toLowerCase();

  // 1. Transient
  if (
    msgLower.includes('429') ||
    msgLower.includes('too many requests') ||
    msgLower.includes('timeout') ||
    msgLower.includes('econnreset') ||
    msgLower.includes('socket hang up') ||
    msgLower.includes('network error')
  ) {
    return { taxonomy: 'transient', safeMessage };
  }

  // 2. Connector Down
  if (
    msgLower.includes('500') ||
    msgLower.includes('502') ||
    msgLower.includes('503') ||
    msgLower.includes('504') ||
    msgLower.includes('econnrefused') ||
    msgLower.includes('connector unavailable')
  ) {
    return { taxonomy: 'connector_down', safeMessage };
  }

  // 3. Human Rejected
  if (msgLower.includes('human reject') || msgLower.includes('rejected by user') || msgLower.includes('not approved')) {
    return { taxonomy: 'human_rejected', safeMessage };
  }

  // 4. Business Rule Violation
  if (msgLower.includes('invalid state transition') || msgLower.includes('business rule') || msgLower.includes('unauthorized transition')) {
    return { taxonomy: 'business_rule_violation', safeMessage };
  }

  return { taxonomy: 'unknown', safeMessage };
}

function redactSensitiveInfo(msg: string): string {
  // Replace tokens and basic secrets (e.g. Bearer token, basic auth, some keys)
  return msg
    .replace(/Bearer\s+[A-Za-z0-9\-\._~\+\/]+=*/gi, 'Bearer ***')
    .replace(/(?:api_key|apiKey|token|secret|password)["'\s]*[:=]\s*["']?[^"'\s]+["']?/gi, '$1=***')
    .replace(/bot[0-9]+:[A-Za-z0-9_-]+/g, 'bot***:***');
}
