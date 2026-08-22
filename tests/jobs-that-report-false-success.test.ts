/**
 * Findings D4, D5 and D6 of the 17 August 2026 audit round — three jobs that
 * reported success while doing nothing.
 *
 * They are one PR because they are one failure mode, and it is the one that
 * survives every other kind of check: the code runs, the exit code is 0, the
 * summary line prints a number, and the number is wrong in the direction that
 * looks fine. Nothing is thrown, so no alert fires; nothing is logged as an
 * error, so no dashboard reddens. The only way to catch it is to assert on the
 * count itself.
 *
 * D5's engine half needs a live database and lives in
 * `tests/integration/site-search.integration.test.ts`; what is here is
 * everything provable without one.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  getDatabaseCircuitBreaker,
  resetDatabaseCircuitBreakerForTests,
  resetProviderCircuitBreakersForTests
} from "../src/lib/database/circuit-breaker";
import { dispatchEmailQueue } from "../src/modules/email/application/email-dispatch";
import type {
  EmailMessage,
  EmailProvider
} from "../src/modules/email/domain/email-provider-contract";
import { createMailketingEmailProvider } from "../src/modules/email/infrastructure/mailketing-provider";
import { stripComments } from "../scripts/lib/source-text";
import { runVisitorAnalyticsPurge } from "../scripts/visitor-analytics-purge";
import { runVisitorAnalyticsRollup } from "../scripts/visitor-analytics-rollup";
import { VISITOR_ANALYTICS_DEFAULTS } from "../src/modules/visitor-analytics/domain/visitor-analytics-config";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const MESSAGE_ID = "33333333-3333-3333-3333-333333333333";
const NOW = new Date("2026-08-17T10:00:00.000Z");

/** `createCircuitBreaker`'s `DEFAULT_FAILURE_THRESHOLD`. */
const BREAKER_THRESHOLD = 5;

type CapturedQuery = { text: string; values: unknown[] };

/**
 * The same "implement only the calls the code under test actually makes" fake
 * `Bun.SQL` that `email-dispatch-lease.test.ts` established. `onQuery` lets a
 * test make one specific statement fail.
 */
function createFakeSql(
  reply: (text: string) => unknown[] | undefined,
  onQuery?: (text: string) => void
): { sql: Bun.SQL; queries: CapturedQuery[] } {
  const queries: CapturedQuery[] = [];

  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ? ").replace(/\s+/g, " ").trim();

    queries.push({ text, values });
    onQuery?.(text);

    return Promise.resolve(reply(text) ?? []);
  };

  run.unsafe = (text: string, values: unknown[] = []) => {
    queries.push({ text, values });
    onQuery?.(text);

    return Promise.resolve(reply(text) ?? []);
  };
  run.array = (values: unknown[], type: string) => ({ values, type });
  run.begin = (callback: (tx: Bun.TransactionSQL) => Promise<unknown>) =>
    callback(run as unknown as Bun.TransactionSQL);
  run.savepoint = (callback: (sp: Bun.TransactionSQL) => Promise<unknown>) =>
    callback(run as unknown as Bun.TransactionSQL);

  return { sql: run as unknown as Bun.SQL, queries };
}

describe("D4 — two analytics jobs abandoned every remaining tenant", () => {
  afterEach(() => {
    resetDatabaseCircuitBreakerForTests();
  });

  function rollupSql(onQuery?: (text: string) => void) {
    return createFakeSql((text) => {
      if (text.includes("FROM awcms_tenants")) {
        return [{ id: TENANT_A }, { id: TENANT_B }];
      }

      return [];
    }, onQuery);
  }

  test("a busy database SKIPS the tenant and names it, instead of taking the run down", async () => {
    const { sql } = rollupSql();

    // `withTenantOrThrow` refuses with `DatabaseBusyError` while the database
    // circuit breaker is open — the exact backpressure the dead
    // `result instanceof Response` branch was written for and could never see,
    // because that shape only ever comes out of `withTenant`.
    //
    // Recorded against the REAL clock, not `NOW`: the breaker's open window is
    // 30 s, and `runTenantWork` asks `canAttempt(new Date())`. Tripping it with
    // a fixed past timestamp opens it and then immediately elapses it to
    // half-open, which lets the attempt through — the test would pass for the
    // wrong reason and prove nothing.
    const breaker = getDatabaseCircuitBreaker();
    for (let i = 0; i < BREAKER_THRESHOLD; i += 1) {
      breaker.recordFailure(new Date());
    }

    const result = await runVisitorAnalyticsRollup(
      sql,
      { dryRun: false },
      "2026-08-16"
    );

    // Both tenants were CHECKED — the loop ran to the end rather than dying on
    // the first one.
    expect(result.tenantsChecked).toBe(2);
    expect(result.tenantsSkipped).toBe(2);
    // Named, not just counted. `--date=` is the remedy and it needs the ids.
    expect(result.skippedTenantIds).toEqual([TENANT_A, TENANT_B]);
    expect(result.tenantsRolledUp).toBe(0);
  });

  test("a rollup DEFECT is not swallowed as a skip — it reaches the job runner", async () => {
    // The catch is deliberately narrow. A broken query must not be laundered
    // into `tenantsSkipped`, or the class of bug this finding is about comes
    // straight back in the fix for it.
    const { sql } = rollupSql((text) => {
      if (text.includes("FROM awcms_visit_events")) {
        throw new Error("boom: relation does not exist");
      }
    });

    let thrown: unknown = null;

    try {
      await runVisitorAnalyticsRollup(sql, { dryRun: false }, "2026-08-16");
    } catch (error) {
      thrown = error;
    }

    expect((thrown as Error | null)?.message).toContain("boom");
  });

  test("the RETENTION purge had the identical dead branch, and it matters more", async () => {
    // The audit said "two analytics jobs" and it was right about both. This one
    // is what ENFORCES retention: an abandoned run means every tenant after the
    // first keeps holding visitor data past its window, silently, while the
    // summary reports success — and the summary's own
    // `(WARNING: … database busy)` clause was gated on the permanently-zero
    // counter, so it could never print.
    const { sql } = createFakeSql((text) =>
      text.includes("FROM awcms_tenants")
        ? [{ id: TENANT_A }, { id: TENANT_B }]
        : []
    );

    const breaker = getDatabaseCircuitBreaker();
    for (let i = 0; i < BREAKER_THRESHOLD; i += 1) {
      breaker.recordFailure(new Date());
    }

    const result = await runVisitorAnalyticsPurge(
      sql,
      { dryRun: false },
      VISITOR_ANALYTICS_DEFAULTS
    );

    expect(result.tenantsChecked).toBe(2);
    expect(result.tenantsSkipped).toBe(2);
    expect(result.skippedTenantIds).toEqual([TENANT_A, TENANT_B]);
  });

  test("a purge DEFECT — a legal hold, a broken query — is not laundered into a skip", async () => {
    const { sql } = createFakeSql(
      (text) =>
        text.includes("FROM awcms_tenants")
          ? [{ id: TENANT_A }, { id: TENANT_B }]
          : [],
      (text) => {
        if (text.includes("DELETE FROM awcms_visit_events")) {
          throw new Error("boom: legal hold");
        }
      }
    );

    let thrown: unknown = null;

    try {
      await runVisitorAnalyticsPurge(
        sql,
        { dryRun: false },
        VISITOR_ANALYTICS_DEFAULTS
      );
    } catch (error) {
      thrown = error;
    }

    expect((thrown as Error | null)?.message).toContain("boom");
  });
});

describe("D6 — the email dispatcher billed messages for contact that never happened", () => {
  const ENV = {
    EMAIL_ENABLED: "true",
    EMAIL_PROVIDER: "fake"
  } as unknown as NodeJS.ProcessEnv;

  const TEMPLATE_ROW = {
    subject_template: { en: "Hello" },
    text_body_template: { en: "Body" },
    html_body_template: null
  };

  function dispatchSql() {
    return createFakeSql((text) => {
      if (text.includes("SELECT default_locale")) {
        return [{ default_locale: "en" }];
      }

      if (text.includes("FROM awcms_email_templates")) {
        return [TEMPLATE_ROW];
      }

      if (
        text.includes("UPDATE awcms_email_messages") &&
        text.includes("SET status = 'sending'")
      ) {
        return [
          {
            id: MESSAGE_ID,
            correlation_id: null,
            category: "system.announcement",
            template_key: "system.announcement",
            to_address: "user@example.com",
            to_address_hash: "hash-user",
            subject: "Hello",
            variables: {},
            retry_count: 2
          }
        ];
      }

      return [];
    });
  }

  function skippingProvider(): EmailProvider {
    return {
      send: async (_message: EmailMessage) => ({
        ok: false as const,
        error: "Mailketing circuit breaker is open; no attempt was made.",
        retryable: true,
        skipped: true as const
      }),
      healthCheck: async () => ({ ok: true as const })
    };
  }

  function failingProvider(): EmailProvider {
    return {
      send: async (_message: EmailMessage) => ({
        ok: false as const,
        error: "Mailketing rejected the recipient.",
        retryable: false
      }),
      healthCheck: async () => ({ ok: true as const })
    };
  }

  test("a skipped message writes NO delivery-attempt row and burns NO retry", async () => {
    const { sql, queries } = dispatchSql();

    const result = await dispatchEmailQueue(sql, TENANT_A, {
      now: NOW,
      env: ENV,
      resolveProvider: () => skippingProvider()
    });

    expect(result.claimed).toBe(1);
    expect(result.deferred).toBe(1);
    // The three counters it used to land in. `retried`/`failed` both assert
    // zero because which one it hit depended on `retry_count` vs the max — the
    // message in this test is at 2, so on the old code it retried; at the cap
    // it went terminally `failed` without ever having been sent.
    expect(result.retried).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.sent).toBe(0);

    // The ledger must not record a contact that did not happen.
    const attempts = queries.filter((q) =>
      q.text.includes("INSERT INTO awcms_email_delivery_attempts")
    );
    expect(attempts).toHaveLength(0);

    // The claim is undone: back to `queued`, immediately due again, and
    // `retry_count` is not in the statement at all.
    const release = queries.find(
      (q) =>
        q.text.includes("UPDATE awcms_email_messages") &&
        q.text.includes("SET status = 'queued'")
    );
    expect(release).toBeDefined();
    expect(release!.text).not.toContain("retry_count");
    // Guarded on `status = 'sending'`, like every other finalize — a message
    // cancelled between CLAIM and here must not be resurrected.
    expect(release!.text).toContain("status = 'sending'");
  });

  test("an ordinary rejection still records the attempt — the fix is narrow", async () => {
    // NON-VACUOUS counterpart. If `skipped` were ignored, or if the new branch
    // swallowed every failure, this test would not notice; if the new branch
    // caught too much, this one goes red.
    const { sql, queries } = dispatchSql();

    const result = await dispatchEmailQueue(sql, TENANT_A, {
      now: NOW,
      env: ENV,
      resolveProvider: () => failingProvider()
    });

    expect(result.deferred).toBe(0);
    expect(result.failed).toBe(1);

    const attempts = queries.filter((q) =>
      q.text.includes("INSERT INTO awcms_email_delivery_attempts")
    );
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.values).toContain("failure");
  });
});

describe("D6 — one bad address must not open the breaker on everybody else", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    resetProviderCircuitBreakersForTests();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    resetProviderCircuitBreakersForTests();
  });

  function provider() {
    return createMailketingEmailProvider({
      apiToken: "token",
      baseUrl: "http://mailketing.invalid",
      timeoutMs: 1_000
    });
  }

  function message(address: string | null): EmailMessage {
    return {
      to: address === null ? [] : [{ address }],
      from: { address: "sender@example.com" },
      subject: "Subject",
      textBody: "Body"
    };
  }

  function respondWith(body: string, status = 200): void {
    globalThis.fetch = (async () =>
      new Response(body, { status })) as unknown as typeof fetch;
  }

  test("a 2xx `status: failed` body is a business rejection, not an outage", async () => {
    respondWith(JSON.stringify({ status: "failed", response: "Bad address" }));

    const mailketing = provider();

    // Comfortably past the 5-failure threshold. Every one of these used to
    // count, so six invalid addresses in one batch closed email delivery for
    // the whole deployment — including the password-reset messages that are
    // the reason this module exists.
    for (let i = 0; i < BREAKER_THRESHOLD + 3; i += 1) {
      const result = await mailketing.send(message(`bad-${i}@example.com`));

      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty("skipped", true);
    }

    // Still attempting: the breaker never opened.
    respondWith(JSON.stringify({ status: "success", message_id: "abc" }));
    const recovered = await mailketing.send(message("good@example.com"));

    expect(recovered).toEqual({ ok: true, providerMessageId: "abc" });
  });

  test("a message with no recipient is this deployment's bad row, not Mailketing's", async () => {
    respondWith(JSON.stringify({ status: "success", message_id: "abc" }));

    const mailketing = provider();

    for (let i = 0; i < BREAKER_THRESHOLD + 3; i += 1) {
      const result = await mailketing.send(message(null));

      expect(result).toEqual({
        ok: false,
        error: "Email message has no recipient address.",
        retryable: false
      });
    }

    const recovered = await mailketing.send(message("good@example.com"));

    expect(recovered.ok).toBe(true);
  });

  test("a 5xx DOES open the breaker, and the refusal is marked `skipped`", async () => {
    // The half that must keep working. A provider that is genuinely down is
    // exactly what the breaker is for, and `skipped` is what tells the
    // dispatcher the difference between "refused" and "never tried".
    respondWith("upstream boom", 503);

    const mailketing = provider();

    for (let i = 0; i < BREAKER_THRESHOLD; i += 1) {
      const result = await mailketing.send(message(`user-${i}@example.com`));

      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty("skipped", true);
    }

    const refused = await mailketing.send(message("user@example.com"));

    expect(refused).toEqual({
      ok: false,
      error: "Mailketing circuit breaker is open; no attempt was made.",
      retryable: true,
      skipped: true
    });
  });

  test("a 4xx that is not 429 is about the message, so it leaves the breaker closed", async () => {
    respondWith("bad request", 400);

    const mailketing = provider();

    for (let i = 0; i < BREAKER_THRESHOLD + 3; i += 1) {
      const result = await mailketing.send(message(`user-${i}@example.com`));

      expect(result).not.toHaveProperty("skipped", true);
    }

    respondWith(JSON.stringify({ status: "success", message_id: "abc" }));

    expect((await mailketing.send(message("good@example.com"))).ok).toBe(true);
  });

  test("a 429 IS about the service, so it counts", async () => {
    respondWith("slow down", 429);

    const mailketing = provider();

    for (let i = 0; i < BREAKER_THRESHOLD; i += 1) {
      await mailketing.send(message(`user-${i}@example.com`));
    }

    expect(await mailketing.send(message("user@example.com"))).toHaveProperty(
      "skipped",
      true
    );
  });
});

describe("D5 — the reconcile script that summed the wrong number and exited 0", () => {
  // Source-level, and comments STRIPPED first (finding D2's lesson: an
  // assertion that matches the prose explaining a change tests nothing). What
  // makes these worth pinning is that the engine half is now correct — a
  // caller that goes back to ignoring `status` would restore the whole defect
  // while every engine test stayed green.
  async function script(): Promise<string> {
    return stripComments(
      await Bun.file("scripts/site-search-reconcile.ts").text()
    );
  }

  test("it reads `status`, not just `failureCount`", async () => {
    const source = await script();

    expect(source).toContain('result.status === "failed"');
    expect(source).toContain("result.failedSources");
    expect(source).toContain("result.unattemptedSources");
  });

  test("a failed source makes the process exit NON-zero", async () => {
    const source = await script();

    // `logScriptFailure` sets this only for an error that escapes the loop, and
    // the loop no longer lets one escape.
    expect(source).toContain("process.exitCode = 1");
  });

  test("one tenant's failure does not abandon the rest of the run", async () => {
    const source = await script();
    const loop = source.slice(
      source.indexOf("for (const tenant of tenants)"),
      source.indexOf("site-search:reconcile complete")
    );

    // A `catch` that `continue`s — the same shape D4 gave the rollup. Without
    // it, a database error on tenant #1 rejected out of the whole loop and
    // every later tenant went unindexed for that pass.
    expect(loop).toContain("catch (error)");
    expect(loop).toContain("continue;");
  });
});

describe("D6 — the dispatch script must PRINT the outcome it just learned to tell apart", () => {
  test("`deferred` reaches the summary line", async () => {
    // A number the summary does not print is a number nobody reads, and
    // splitting `deferred` out of `failed`/`retried` without printing it would
    // have made the pass quieter than before rather than clearer.
    const source = stripComments(
      await Bun.file("scripts/email-dispatch.ts").text()
    );

    expect(source).toContain("result.deferred");
    expect(source).toContain("deferred=${totalDeferred}");
  });
});
