export async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryResult<T> {
  result: T;
  attempts: number;
}

/**
 * Retry an async function up to `attempts` times with `delayMs` between retries.
 * `isSuccess` decides if the result should be accepted immediately.
 * `shouldRetry` (optional) decides if a failed result is worth retrying — return
 *   false for configuration / permanent errors that won't change between retries.
 */
export async function retryAsync<T>(options: {
  label: string;
  attempts: number;
  delayMs: number;
  fn: () => Promise<T>;
  isSuccess: (result: T) => boolean;
  shouldRetry?: (result: T) => boolean;
  onAttempt?: (attempt: number) => void;
}): Promise<RetryResult<T>> {
  let lastResult: T | undefined;
  let lastError: any;

  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      options.onAttempt?.(attempt);
      const result = await options.fn();
      lastResult = result;

      if (options.isSuccess(result)) {
        return { result, attempts: attempt };
      }

      if (options.shouldRetry && !options.shouldRetry(result)) {
        console.log(`[${options.label}] Attempt ${attempt}: non-retryable failure — stopping.`);
        return { result, attempts: attempt };
      }

      if (attempt < options.attempts) {
        console.log(`[${options.label}] Attempt ${attempt} failed. Waiting ${options.delayMs / 1000}s before retry...`);
        await delay(options.delayMs);
      }
    } catch (err: any) {
      lastError = err;
      console.log(
        `[${options.label}] Attempt ${attempt} threw: ${err?.message}. ${attempt < options.attempts ? `Waiting ${options.delayMs / 1000}s...` : "No more retries."}`
      );
      if (attempt < options.attempts) {
        await delay(options.delayMs);
      }
    }
  }

  if (lastResult !== undefined) return { result: lastResult, attempts: options.attempts };
  throw lastError ?? new Error(`${options.label} failed after ${options.attempts} attempts`);
}

/**
 * Returns true if the email error is a permanent configuration problem.
 * These should NOT be retried — the issue won't resolve between attempts.
 */
export function isEmailConfigError(error: string): boolean {
  const lower = error.toLowerCase();
  return (
    lower.includes("email not configured") ||
    lower.includes("no email recipients") ||
    lower.includes("gmail authentication failed") ||
    lower.includes("exceeds gmail") ||
    lower.includes("too large for email")
  );
}

/**
 * Returns true if the WhatsApp result error is a permanent configuration problem.
 * These should NOT be retried.
 */
export function isWaConfigError(error: string): boolean {
  const lower = error.toLowerCase();
  return (
    lower.includes("too large for whatsapp") ||
    lower.includes("whatsapp is disabled") ||
    lower.includes("not configured") ||
    lower.includes("not found or inactive") ||
    lower.includes("no daily export whatsapp group")
  );
}
