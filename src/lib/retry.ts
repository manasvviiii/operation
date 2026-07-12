import { classifyFailure, FailureTaxonomy } from './observability/failureClass';

export type RetryContext = {
  workflowId: string;
  executionId?: string;
  agentRunId?: string;
  connectorId?: string;
};

export type RetryEvent = {
  eventType: 'retry_scheduled' | 'retry_attempt' | 'retry_succeeded' | 'retry_exhausted';
  attemptNumber: number;
  maxAttempts: number;
  backoffMs: number;
  taxonomy?: FailureTaxonomy;
  error?: string;
  context?: RetryContext;
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    onRetry?: (attempt: number, error: unknown) => void;
    context?: RetryContext;
    onRetryEvent?: (event: RetryEvent) => void;
  }
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 4;
  const baseDelayMs = options?.baseDelayMs ?? 300;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1 && options?.onRetryEvent) {
      options.onRetryEvent({
        eventType: 'retry_attempt',
        attemptNumber: attempt,
        maxAttempts,
        backoffMs: 0,
        context: options.context,
      });
    }

    try {
      const result = await fn();
      
      if (attempt > 1 && options?.onRetryEvent) {
        options.onRetryEvent({
          eventType: 'retry_succeeded',
          attemptNumber: attempt,
          maxAttempts,
          backoffMs: 0,
          context: options.context,
        });
      }
      
      return result;
    } catch (error) {
      const { taxonomy, safeMessage } = classifyFailure(error);
      
      if (attempt === maxAttempts) {
        if (options?.onRetryEvent) {
          options.onRetryEvent({
            eventType: 'retry_exhausted',
            attemptNumber: attempt,
            maxAttempts,
            backoffMs: 0,
            taxonomy,
            error: safeMessage,
            context: options.context,
          });
        }
        throw error;
      }
      
      const delay = Math.min(baseDelayMs * (2 ** (attempt - 1)) + Math.random() * 100, 5000);
      
      if (options?.onRetryEvent) {
        options.onRetryEvent({
          eventType: 'retry_scheduled',
          attemptNumber: attempt,
          maxAttempts,
          backoffMs: Math.round(delay),
          taxonomy,
          error: safeMessage,
          context: options.context,
        });
      }
      
      if (options?.onRetry) {
        options.onRetry(attempt, error);
      } else {
        console.warn(`[retry] attempt ${attempt} failed, retrying in ${delay.toFixed(0)}ms: ${error}`);
      }
      
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error('Unreachable');
}

/**
 * Simple in-memory idempotency guard.
 * 
 * NOTE: This is a simple in-memory implementation suitable for a single-process 
 * dev/demo environment. In production, you would need a persisted idempotency key 
 * (e.g. a unique constraint in Postgres or Redis) since in-memory state is lost 
 * on restart and doesn't work across multiple server instances.
 */
const idempotencyStore = new Map<string, Promise<any>>();

export function hasIdempotencyKey(key: string): boolean {
  return idempotencyStore.has(key);
}

export function withIdempotency<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (idempotencyStore.has(key)) {
    return idempotencyStore.get(key) as Promise<T>;
  }

  const promise = fn().catch((err) => {
    // If it fails, remove from store so it can be retried later
    idempotencyStore.delete(key);
    throw err;
  });

  idempotencyStore.set(key, promise);
  return promise;
}
