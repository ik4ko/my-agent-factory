/**
 * Exponential backoff retry utility.
 * Used by Marx lookup DB operations, alert delivery, and roster upserts
 * to survive transient Supabase/network hiccups without crashing the pipeline.
 */

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 3 */
  maxAttempts?: number
  /** Base delay in ms before first retry. Doubles each attempt. Default: 200 */
  baseDelayMs?: number
  /** Maximum delay cap in ms. Default: 5000 */
  maxDelayMs?: number
  /** Human-readable label for log messages. Default: 'operation' */
  label?: string
  /** Optional predicate -- if it returns false, don't retry (e.g. auth errors). */
  shouldRetry?: (err: unknown) => boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Executes `fn` with exponential backoff on failure.
 * Accepts any thenable (Promise, PromiseLike, Supabase QueryBuilder, etc.).
 * Throws the last error if all attempts fail.
 */
export async function withRetry<T>(
  fn: () => T | PromiseLike<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 200,
    maxDelayMs = 5000,
    label = 'operation',
    shouldRetry = () => true,
  } = options

  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await (fn() as PromiseLike<T>)
    } catch (err) {
      lastErr = err
      if (attempt === maxAttempts || !shouldRetry(err)) {
        break
      }
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs)
      // Add +-20% jitter to avoid thundering herd
      const jitter = delay * 0.2 * (Math.random() * 2 - 1)
      const finalDelay = Math.max(0, Math.round(delay + jitter))
      console.warn(
        `[retry] ${label} failed (attempt ${attempt}/${maxAttempts}) -- retrying in ${finalDelay}ms`,
        err instanceof Error ? err.message : String(err)
      )
      await sleep(finalDelay)
    }
  }
  console.error(`[retry] ${label} failed after ${maxAttempts} attempts`, lastErr)
  throw lastErr
}

/**
 * Same as withRetry but returns { data, error } instead of throwing.
 * Accepts any thenable (Promise, PromiseLike, Supabase QueryBuilder, etc.).
 * Useful for non-critical paths where you want to continue on failure.
 */
export async function withRetrySafe<T>(
  fn: () => T | PromiseLike<T>,
  options: RetryOptions = {}
): Promise<{ data: T | null; error: unknown }> {
  try {
    const data = await withRetry(fn, options)
    return { data, error: null }
  } catch (error) {
    return { data: null, error }
  }
}
