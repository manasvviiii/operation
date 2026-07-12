import { describe, it, expect, vi } from 'vitest';
import { withRetry, withIdempotency } from './retry';

describe('retry and idempotency logic', () => {
  describe('withRetry', () => {
    it('succeeds on the first attempt without retrying if fn resolves immediately', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const onRetry = vi.fn();
      
      const result = await withRetry(fn, { maxAttempts: 4, onRetry });
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(onRetry).not.toHaveBeenCalled();
    });

    it('retries on failure and eventually succeeds', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValueOnce('success');
      const onRetry = vi.fn();
      
      const result = await withRetry(fn, { maxAttempts: 4, baseDelayMs: 10, onRetry });
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error));
      expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error));
    });

    it('throws the final error after exhausting maxAttempts if fn always fails', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('persistent failure'));
      const onRetry = vi.fn();
      
      await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, onRetry }))
        .rejects.toThrow('persistent failure');
      
      expect(fn).toHaveBeenCalledTimes(3);
      expect(onRetry).toHaveBeenCalledTimes(2); // Called on attempts 1 and 2
    });

    it('emits observability events on retry success', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('HTTP Error 429: Too Many Requests'))
        .mockResolvedValueOnce('success');
      const onRetryEvent = vi.fn();
      
      const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, onRetryEvent });
      
      expect(result).toBe('success');
      expect(onRetryEvent).toHaveBeenCalledTimes(3);
      
      // Attempt 1 fails, schedules retry
      expect(onRetryEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
        eventType: 'retry_scheduled',
        attemptNumber: 1,
        taxonomy: 'transient',
        backoffMs: expect.any(Number),
        error: 'HTTP Error 429: Too Many Requests'
      }));
      
      // Attempt 2 starts
      expect(onRetryEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
        eventType: 'retry_attempt',
        attemptNumber: 2
      }));
      
      // Attempt 2 succeeds
      expect(onRetryEvent).toHaveBeenNthCalledWith(3, expect.objectContaining({
        eventType: 'retry_succeeded',
        attemptNumber: 2
      }));
    });

    it('emits observability events on retry exhaustion', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('HTTP Error 500'));
      const onRetryEvent = vi.fn();
      
      await expect(withRetry(fn, { maxAttempts: 2, baseDelayMs: 10, onRetryEvent }))
        .rejects.toThrow('HTTP Error 500');
        
      expect(onRetryEvent).toHaveBeenCalledTimes(3);
      
      // Attempt 1 fails, schedules retry
      expect(onRetryEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
        eventType: 'retry_scheduled',
        attemptNumber: 1,
        taxonomy: 'connector_down'
      }));
      
      // Attempt 2 starts
      expect(onRetryEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
        eventType: 'retry_attempt',
        attemptNumber: 2
      }));
      
      // Attempt 2 exhausts retries
      expect(onRetryEvent).toHaveBeenNthCalledWith(3, expect.objectContaining({
        eventType: 'retry_exhausted',
        attemptNumber: 2,
        taxonomy: 'connector_down'
      }));
    });
  });

  describe('withIdempotency', () => {
    it('returns the same result for the same key without calling fn twice', async () => {
      let counter = 0;
      const fn = vi.fn().mockImplementation(async () => {
        counter++;
        return `result-${counter}`;
      });

      const key = 'test-key-1';
      
      const result1 = await withIdempotency(key, fn);
      const result2 = await withIdempotency(key, fn);
      const result3 = await withIdempotency(key, fn);

      expect(result1).toBe('result-1');
      expect(result2).toBe('result-1');
      expect(result3).toBe('result-1');
      expect(counter).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('calls fn independently for two different keys', async () => {
      let counter = 0;
      const fn = vi.fn().mockImplementation(async () => {
        counter++;
        return `result-${counter}`;
      });

      const key1 = 'test-key-2a';
      const key2 = 'test-key-2b';
      
      const result1 = await withIdempotency(key1, fn);
      const result2 = await withIdempotency(key2, fn);

      expect(result1).toBe('result-1');
      expect(result2).toBe('result-2');
      expect(counter).toBe(2);
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});
