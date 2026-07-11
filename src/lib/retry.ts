export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    onRetry?: (attempt: number, error: unknown) => void;
  }
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 4;
  const baseDelayMs = options?.baseDelayMs ?? 300;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      
      const delay = Math.min(baseDelayMs * (2 ** (attempt - 1)) + Math.random() * 100, 5000);
      
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
