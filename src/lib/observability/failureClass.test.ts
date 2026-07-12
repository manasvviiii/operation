import { describe, it, expect } from 'vitest';
import { classifyFailure } from './failureClass';
import { z } from 'zod';

describe('classifyFailure', () => {
  it('classifies 429 as transient', () => {
    const result = classifyFailure(new Error('HTTP Error 429: Too Many Requests'));
    expect(result.taxonomy).toBe('transient');
  });

  it('classifies timeout as transient', () => {
    const result = classifyFailure(new Error('Connection timeout after 5000ms'));
    expect(result.taxonomy).toBe('transient');
  });

  it('classifies repeated 5xx as connector_down', () => {
    const result = classifyFailure(new Error('HTTP Error 503: Service Unavailable'));
    expect(result.taxonomy).toBe('connector_down');
  });

  it('classifies schema validation error as validation_error', () => {
    const error = new z.ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        path: ['name'],
        message: 'Expected string, received number'
      }
    ]);
    const result = classifyFailure(error);
    expect(result.taxonomy).toBe('validation_error');
    expect(result.safeMessage).toContain('Expected string, received number');
  });

  it('classifies human rejection as human_rejected', () => {
    const result = classifyFailure(new Error('Workflow human rejected'));
    expect(result.taxonomy).toBe('human_rejected');
  });

  it('classifies business rule violations correctly', () => {
    const result = classifyFailure(new Error('Invalid state transition from A to B'));
    expect(result.taxonomy).toBe('business_rule_violation');
  });

  it('redacts sensitive values from errors', () => {
    const result = classifyFailure(new Error('Failed to fetch from API. Header was Bearer secret-token-123. bot123:abc-def-ghi'));
    expect(result.safeMessage).not.toContain('secret-token-123');
    expect(result.safeMessage).not.toContain('bot123:abc-def-ghi');
    expect(result.safeMessage).toContain('Bearer ***');
    expect(result.safeMessage).toContain('bot***:***');
  });
});
