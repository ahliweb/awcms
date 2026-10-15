/**
 * Reusable assertion for the fail-closed rule on sensitive reads (Issue #1014
 * L6). The routes of #957 and #961 call `expectAuditFailureYieldsNoData` with
 * their handler body, run against a transaction whose every statement fails.
 */
import { expect } from "bun:test";

/** A transaction whose every statement fails, as a broken audit insert would. */
export function failingTx(): Bun.SQL {
  const fail = () => Promise.reject(new Error("audit insert failed"));

  return new Proxy(fail, {
    apply: () => fail(),
    get: () => fail
  }) as unknown as Bun.SQL;
}

export type HandlerOutcome = { data?: unknown; status: number };

/**
 * Run `handler` against a failing audit write. It must reject, or return a
 * non-2xx response without data. Anything else leaks a read that left no trace.
 */
export async function expectAuditFailureYieldsNoData(
  handler: (tx: Bun.SQL) => Promise<HandlerOutcome>
): Promise<void> {
  let outcome: HandlerOutcome;

  try {
    outcome = await handler(failingTx());
  } catch {
    return;
  }

  expect(outcome.data).toBeUndefined();
  expect(outcome.status).toBeGreaterThanOrEqual(400);
}
