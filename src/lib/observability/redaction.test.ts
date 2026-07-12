import { describe, it, expect } from 'vitest';
import { redactForObservability } from './redaction';

describe('redactForObservability', () => {
  it('redacts PAN correctly', () => {
    const redacted = redactForObservability('My PAN is ABCDE1234F.') as string;
    expect(redacted).toBe('My PAN is ******1234F.');
  });

  it('redacts GSTIN correctly', () => {
    const redacted = redactForObservability('GSTIN: 27ABCDE1234F1Z5') as string;
    expect(redacted).toBe('GSTIN: 27**********1Z5');
  });

  it('redacts bank accounts correctly', () => {
    const redacted = redactForObservability('Account 123456789012 passed.') as string;
    expect(redacted).toBe('Account ********9012 passed.');
  });

  it('redacts authorization headers', () => {
    const redacted = redactForObservability('Authorization: Bearer secret-token-123') as string;
    expect(redacted).toBe('Authorization: Bearer [REDACTED]');
  });

  it('redacts API keys and secrets', () => {
    const redacted = redactForObservability('GROQ_API_KEY="gsk_12345"') as string;
    expect(redacted).toBe('GROQ_API_KEY="[REDACTED]"');
  });

  it('redacts connection strings', () => {
    const redacted = redactForObservability('DATABASE_URL=postgresql://user:pass@host:5432/db') as string;
    expect(redacted).toBe('DATABASE_URL=postgresql://[REDACTED_CREDENTIALS]@host:5432/db');
  });

  it('redacts bot tokens', () => {
    const redacted = redactForObservability('Bot token: 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ') as string;
    expect(redacted).toBe('Bot token: [REDACTED_BOT_TOKEN]');
  });

  it('1. a safe string longer than 300 characters remains intact', () => {
    const longString = 'x'.repeat(350);
    const redacted = redactForObservability(longString);
    expect(redacted).toBe(longString);
  });

  it('2. reasoningSummary longer than 300 characters remains intact', () => {
    const longSummary = 'y'.repeat(350);
    const obj = { reasoningSummary: longSummary };
    const redacted = redactForObservability(obj) as any;
    expect(redacted.reasoningSummary).toBe(longSummary);
  });

  it('3. extractedText is fully replaced', () => {
    const obj = { extractedText: 'Certificate of Incorporation ... very long OCR content' };
    const redacted = redactForObservability(obj) as any;
    expect(redacted.extractedText).toBe('[REDACTED_DOCUMENT_CONTENT]');
  });

  it('4. ocrText is fully replaced', () => {
    const obj = { ocrText: 'some ocr data' };
    const redacted = redactForObservability(obj) as any;
    expect(redacted.ocrText).toBe('[REDACTED_DOCUMENT_CONTENT]');
  });

  it('5. documentPayload nested inside another object is fully replaced', () => {
    const obj = {
      workerResult: {
        documentPayload: {
          text: "raw contents"
        }
      }
    };
    const redacted = redactForObservability(obj) as any;
    expect(redacted.workerResult.documentPayload).toBe('[REDACTED_DOCUMENT_CONTENT]');
  });

  it('6. PAN inside a long normal string is still masked', () => {
    const longString = 'z'.repeat(350) + ' ABCDE1234F ' + 'z'.repeat(10);
    const redacted = redactForObservability(longString) as string;
    expect(redacted).toContain(' ******1234F ');
  });

  it('7. GSTIN inside a long normal string is still masked', () => {
    const longString = 'a'.repeat(350) + ' 27ABCDE1234F1Z5 ' + 'a'.repeat(10);
    const redacted = redactForObservability(longString) as string;
    expect(redacted).toContain(' 27**********1Z5 ');
  });

  it('8. bearer tokens inside a long normal string are still redacted', () => {
    const longString = 'b'.repeat(350) + ' Bearer secret-token-123 ' + 'b'.repeat(10);
    const redacted = redactForObservability(longString) as string;
    expect(redacted).toContain(' Bearer [REDACTED] ');
  });

  it('9. arrays and nested objects continue to work', () => {
    const obj = { arr: [{ nested: 'My PAN is ABCDE1234F' }] };
    const redacted = redactForObservability(obj) as any;
    expect(redacted.arr[0].nested).toBe('My PAN is ******1234F');
  });

  it('10. the original input object is not mutated', () => {
    const original = { extractedText: 'secret', nested: { pan: 'ABCDE1234F' } };
    redactForObservability(original);
    expect(original.extractedText).toBe('secret');
    expect(original.nested.pan).toBe('ABCDE1234F');
  });



  it('redacts error messages and stacks', () => {
    const err = new Error('Failed with PAN ABCDE1234F');
    const redactedErr = redactForObservability(err) as Error;
    expect(redactedErr.message).toBe('Failed with PAN ******1234F');
    expect(redactedErr.stack).toContain('Failed with PAN ******1234F');
  });
});
