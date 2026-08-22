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

/**
 * Run `work` with a query-counting POOL handle, counting statements issued
 * directly on it AND inside any `sql.begin(...)` transaction it opens.
 *
 * `countQueries` above can only be handed a `tx`, which means it can only
 * measure code the test has already put inside a transaction — i.e. a directory
 * function. That is why finding B5 could exist: the performance standard claims
 * a "≤ 3 queries per hot read" ceiling as **measured**, and both budget suites
 * call directory functions directly, so everything the request pays BEFORE the
 * page's first query — tenant resolution, redirect resolution, the transaction
 * they run in — was structurally outside what the measurement could see.
 *
 * ## What the number does and does not include
 *
 * Counted: every tagged-template statement, on the pool and inside the
 * transaction, plus the `SET LOCAL` that `withTenantOrThrow` issues through
 * `tx.unsafe`.
 *
 * NOT counted: the `BEGIN` and `COMMIT` that `sql.begin` sends itself. They are
 * real round trips and a Proxy cannot see them, so a count from here is a
 * **floor** on the true number, not the whole of it. Stating that is the point:
 * a budget that quietly under-counts is how "measured" came to mean something
 * other than measured.
 */
export async function countPoolQueries<T>(
  sql: Bun.SQL,
  work: (counting: Bun.SQL) => Promise<T>
): Promise<{ result: T; queries: number }> {
  let queries = 0;

  const countTx = (tx: Bun.TransactionSQL): Bun.TransactionSQL =>
    new Proxy(tx, {
      apply(target, thisArg, args) {
        queries += 1;

        return Reflect.apply(
          target as unknown as (...a: unknown[]) => unknown,
          thisArg,
          args
        );
      },
      get(target, prop, receiver) {
        if (prop === "unsafe") {
          // `SET LOCAL app.current_tenant_id` comes through here on every
          // tenant transaction — a round trip like any other.
          return (...args: unknown[]) => {
            queries += 1;

            return (
              target as unknown as {
                unsafe: (...a: unknown[]) => unknown;
              }
            ).unsafe(...args);
          };
        }

        return Reflect.get(target as object, prop, receiver);
      }
    }) as unknown as Bun.TransactionSQL;

  const counting = new Proxy(sql, {
    apply(target, thisArg, args) {
      queries += 1;

      return Reflect.apply(
        target as unknown as (...a: unknown[]) => unknown,
        thisArg,
        args
      );
    },
    get(target, prop, receiver) {
      if (prop === "begin") {
        // Called on the REAL pool, with the callback's `tx` wrapped — a proxy
        // as `this` is not something Bun's transaction machinery has to
        // tolerate, and the wrapping is what makes in-transaction work visible.
        return (...args: unknown[]) => {
          const fn = args[args.length - 1] as (
            tx: Bun.TransactionSQL
          ) => Promise<unknown>;

          return (
            target as unknown as { begin: (...a: unknown[]) => unknown }
          ).begin(...args.slice(0, -1), (tx: Bun.TransactionSQL) =>
            fn(countTx(tx))
          );
        };
      }

      return Reflect.get(target as object, prop, receiver);
    }
  }) as unknown as Bun.SQL;

  const result = await work(counting);

  return { result, queries };
}
