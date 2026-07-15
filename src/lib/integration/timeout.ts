/**
 * Generic outbound-call timeout (Issue #436, doc 16 §Transactional outbox —
 * "Jangan memanggil provider eksternal di dalam transaction" implies calls
 * to providers must themselves be bounded, since they can no longer rely on
 * a DB `statement_timeout` to cut them off). Pure wrapper, no provider
 * knowledge — any `Promise` can be raced against a deadline.
 */
export class TimeoutError extends Error {
  readonly label: string;
  readonly timeoutMs: number;

  constructor(label: string, timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms waiting for "${label}".`);
    this.name = "TimeoutError";
    this.label = label;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Races `promise` against a timer. Rejects with `TimeoutError` if the timer
 * fires first — the original `promise` is left to settle on its own (this
 * function does not cancel/abort it; callers that can cancel the underlying
 * I/O, e.g. via `AbortController`, should still do so for resource hygiene,
 * but a plain timeout guard is enough to stop a caller from hanging forever
 * waiting for a slow/wedged provider).
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(label, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}
