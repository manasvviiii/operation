export function redactForObservability(value: unknown): unknown {
  if (value == null) return value;
  
  if (value instanceof Error) {
    const redactedError = new Error(redactString(value.message));
    redactedError.name = value.name;
    redactedError.stack = value.stack ? redactString(value.stack) : undefined;
    return redactedError;
  }
  
  if (typeof value === 'string') {
    return redactString(value);
  }
  
  if (Array.isArray(value)) {
    return value.map(v => redactForObservability(v));
  }
  
  if (typeof value === 'object') {
    const redactedObj: Record<string, unknown> = {};
    const documentKeys = new Set([
      'extractedtext',
      'rawtext',
      'documenttext',
      'documentcontent',
      'ocrtext',
      'ocroutput',
      'filecontent',
      'rawdocument',
      'documentpayload',
      'text',
      'content'
    ]);

    for (const [k, v] of Object.entries(value)) {
      if (documentKeys.has(k.toLowerCase())) {
        redactedObj[k] = '[REDACTED_DOCUMENT_CONTENT]';
        continue;
      }
      redactedObj[k] = redactForObservability(v);
    }
    return redactedObj;
  }
  
  return value;
}

function redactString(msg: string): string {
  let redacted = msg;

  // Telegram bot tokens
  redacted = redacted.replace(/[0-9]{8,10}:[a-zA-Z0-9_-]{20,40}/g, '[REDACTED_BOT_TOKEN]');
  
  // API Keys / Generic secrets
  redacted = redacted.replace(/(?:api_key|apiKey|token|secret|password|GROQ_API_KEY)["'\s]*[:=]\s*["']?([a-zA-Z0-9_\-]+)["']?/gi, (match, p1) => {
    return match.replace(p1, '[REDACTED]');
  });
  
  // Bearer tokens
  redacted = redacted.replace(/Bearer\s+[A-Za-z0-9\-\._~\+\/]+=*/gi, 'Bearer [REDACTED]');
  
  // PAN: ABCDE1234F -> ******1234F
  redacted = redacted.replace(/\b([A-Z]{5})([0-9]{4})([A-Z])\b/g, (match, p1, p2, p3) => {
    return '******' + p2 + p3;
  });
  
  // GSTIN: 27ABCDE1234F1Z5 -> 27*********1Z5
  // Length is 15. First 2 digits (state), next 10 is PAN, then 3 characters
  redacted = redacted.replace(/\b([0-9]{2})([A-Z]{5}[0-9]{4}[A-Z])([1-9A-Z]Z[0-9A-Z])\b/g, (match, state, pan, suffix) => {
    return state + '**********' + suffix;
  });
  
  // Bank Account: 123456789012 -> ********9012 (matching 9-18 digit numbers)
  redacted = redacted.replace(/(?<![0-9:])(\b\d{9,18}\b)(?![0-9:])/g, (match) => {
    return '*'.repeat(match.length - 4) + match.slice(-4);
  });
  
  // URLs with credentials: http://user:pass@host
  redacted = redacted.replace(/(https?:\/\/)([^:\/@\s]+:[^:\/@\s]+@)/g, '$1[REDACTED_CREDENTIALS]@');

  // Database URL
  redacted = redacted.replace(/(postgres(?:ql)?:\/\/)([^:\/@\s]+:[^:\/@\s]+@)/g, '$1[REDACTED_CREDENTIALS]@');

  return redacted;
}
