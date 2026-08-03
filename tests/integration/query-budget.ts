/**
 * Query counting for integration tests — the reusable form of the Proxy that
 * `sod.integration.test.ts` proved out for ADR-0181's bounded-evaluation check.
 *
 * ## What this catches that nothing else does
 *
 * An N+1 is invisible to every other kind of test. The endpoint returns the
 * right rows, the assertions pass, the response looks identical — and it issues
 * one query per item instead of one query. It shows up in production as
 * latency that grows with content, months after the code landed, and the repo
 * assessment of 2026-08-04 found **zero of 28 gates measuring anything about
 * performance**.
 *
 * A count is the cheapest possible probe for it, and the only one that does not
 * need a profiler, a plan, or a populated database to be meaningful.
 *
 * ## Assert a BOUND, and seed enough rows for it to mean something
 *
 * `expect(count).toBeLessThanOrEqual(n)` on a fixture with ONE row proves
 * nothing — an N+1 and a constant-query implementation both issue about one
 * query. The bound only bites when the fixture holds enough items that a
 * per-item query would blow through it, which is why the callers here seed
 * deliberately more rows than the budget allows.
 *
 * The number is a ceiling, not a target. Tightening it when an implementation
 * improves is welcome; loosening it should be an argued change, because the
 * whole value is that it fails when work-per-item appears.
 */

/** Run `work` with a query-counting `tx`, returning both its result and the count. */
export async function countQueries<T>(
  tx: Bun.TransactionSQL,
  work: (counting: Bun.TransactionSQL) => Promise<T>
): Promise<{ result: T; queries: number }> {
  let queries = 0;

  // `tx` is a callable tagged-template object, so the Proxy needs BOTH traps:
  // `apply` to see the template calls, `get` to keep `tx.begin`/`tx.unsafe` and
  // every other property working. Omitting `get` silently breaks any code path
  // that reaches for a method rather than calling the tag.
  const counting = new Proxy(tx, {
    apply(target, thisArg, args) {
      queries += 1;

      return Reflect.apply(
        target as unknown as (...a: unknown[]) => unknown,
        thisArg,
        args
      );
    },
    get(target, prop, receiver) {
      return Reflect.get(target as object, prop, receiver);
    }
  }) as unknown as Bun.TransactionSQL;

  const result = await work(counting);

  return { result, queries };
}
