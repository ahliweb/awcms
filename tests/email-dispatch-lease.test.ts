/**
 * Issue #143 (claim lease was write-only) + Issue #153's second N+1 (the
 * per-message template lookup).
 *
 * There is no test Postgres in this suite, so these drive
 * `dispatchEmailQueue` against a fake `Bun.SQL` that records every query
 * it is asked to run — the same "implement just the calls the code under
 * test actually makes" approach `tenant-context-circuit-breaker.test.ts`
 * already uses for `withTenant`. That makes the *shape of the SQL* and the
 * *number of round trips* the observable behavior here, which is exactly
 * what both bugs are about: #143 is a predicate that disagrees with the
 * value written next to it, #153 is a query count.
 */
import { describe, expect, test } from "bun:test";

import {
  dispatchEmailQueue,
  EMAIL_DISPATCH_LEASE_MINUTES
} from "../src/modules/email/application/email-dispatch";
import type {
  EmailMessage,
  EmailProvider
} from "../src/modules/email/domain/email-provider-contract";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-07-17T10:00:00.000Z");

const ENV = {
  EMAIL_ENABLED: "true",
  EMAIL_PROVIDER: "fake"
} as unknown as NodeJS.ProcessEnv;

const TEMPLATE_ROW = {
  subject_template: { en: "Hello {{userName}}" },
  text_body_template: { en: "Body for {{userName}}" },
  html_body_template: null
};

type CapturedQuery = { text: string; values: unknown[] };

type MessageRow = {
  id: string;
  correlation_id: string | null;
  category: string;
  template_key: string | null;
  to_address: string;
  to_address_hash: string;
  subject: string;
  variables: Record<string, unknown> | null;
  retry_count: number;
  reclaimed: boolean;
  created_at?: string;
};

function messageRow(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    correlation_id: null,
    category: "system.announcement",
    template_key: "system.announcement",
    to_address: "user@example.com",
    to_address_hash: "hash-user",
    subject: "Hello",
    variables: { userName: "User" },
    retry_count: 0,
    reclaimed: false,
    ...overrides
  };
}

function createFakeSql(
  claimedRows: MessageRow[],
  options: { templateExists?: boolean } = {}
): {
  sql: Bun.SQL;
  queries: CapturedQuery[];
} {
  const templateExists = options.templateExists ?? true;
  const queries: CapturedQuery[] = [];

  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    // `?` marks each bound parameter, so assertions can read the statement
    // the way Postgres would receive it rather than with values inlined.
    const text = strings.join(" ? ").replace(/\s+/g, " ").trim();

    queries.push({ text, values });

    if (text.includes("SELECT default_locale")) {
      return Promise.resolve([{ default_locale: "en" }]);
    }

    if (text.includes("awcms_email_suppression_list")) {
      return Promise.resolve([]);
    }

    if (text.includes("FROM awcms_email_templates")) {
      return Promise.resolve(templateExists ? [TEMPLATE_ROW] : []);
    }

    if (
      text.includes("UPDATE awcms_email_messages") &&
      text.includes("SET status = 'sending'")
    ) {
      return Promise.resolve(claimedRows);
    }

    return Promise.resolve([]);
  };

  run.unsafe = () => Promise.resolve([]);
  run.array = (values: unknown[], type: string) => ({ values, type });
  run.begin = (callback: (tx: Bun.TransactionSQL) => Promise<unknown>) =>
    callback(run as unknown as Bun.TransactionSQL);

  return { sql: run as unknown as Bun.SQL, queries };
}

function okProvider(sent: string[]): EmailProvider {
  return {
    send: async (message: EmailMessage) => {
      sent.push(message.to[0]!.address);
      return { ok: true, providerMessageId: "provider-message-id" };
    },
    healthCheck: async () => ({ ok: true })
  } as unknown as EmailProvider;
}

function claimQueryOf(queries: CapturedQuery[]): CapturedQuery {
  const claim = queries.find(
    (query) =>
      query.text.includes("UPDATE awcms_email_messages") &&
      query.text.includes("SET status = 'sending'")
  );

  expect(claim).toBeDefined();

  return claim!;
}

describe("email dispatcher claim lease (Issue #143)", () => {
  test("the claim predicate re-claims a 'sending' row whose lease has expired — without this, a worker that dies between CLAIM and FINALIZE strands the message in permanent limbo", async () => {
    const { sql, queries } = createFakeSql([]);

    await dispatchEmailQueue(sql, TENANT_ID, {
      now: NOW,
      env: ENV,
      resolveProvider: () => okProvider([])
    });

    const claim = claimQueryOf(queries);

    expect(claim.text).toMatch(
      /OR \(\s*status = 'sending' AND next_attempt_at <= \?/
    );
  });

  test("EMAIL_DISPATCH_LEASE_MINUTES is a real lease, not a write-only constant: the timestamp written as the lease is the same clock the claim predicate compares against", async () => {
    const { sql, queries } = createFakeSql([]);

    await dispatchEmailQueue(sql, TENANT_ID, {
      now: NOW,
      env: ENV,
      resolveProvider: () => okProvider([])
    });

    const claim = claimQueryOf(queries);
    const leaseExpiry = new Date(
      NOW.getTime() + EMAIL_DISPATCH_LEASE_MINUTES * 60_000
    );

    // The lease value the claim writes...
    expect(claim.values).toContainEqual(leaseExpiry);

    // ...and `now`, bound once per eligibility branch: the
    // queued/retry_wait branch AND the expired-lease re-claim branch. On
    // the buggy version `now` is bound exactly once, because no branch
    // ever reads back what the lease wrote.
    const nowBindings = claim.values.filter(
      (value) => value instanceof Date && value.getTime() === NOW.getTime()
    );

    expect(nowBindings).toHaveLength(2);
  });

  test("re-claiming an expired lease cannot abort the pass on the delivery-attempt ledger's UNIQUE (message_id, attempt_no) — a crash after the ledger insert leaves retry_count untouched, so the next pass recomputes the same attempt_no", async () => {
    const sent: string[] = [];
    const { sql, queries } = createFakeSql([
      messageRow({ retry_count: 0 }) // re-claimed: attempt_no 1 may already exist
    ]);

    await dispatchEmailQueue(sql, TENANT_ID, {
      now: NOW,
      env: ENV,
      resolveProvider: () => okProvider(sent)
    });

    expect(sent).toEqual(["user@example.com"]);

    const ledgerInsert = queries.find((query) =>
      query.text.includes("INSERT INTO awcms_email_delivery_attempts")
    );

    expect(ledgerInsert).toBeDefined();
    expect(ledgerInsert!.text).toContain(
      "ON CONFLICT ON CONSTRAINT awcms_email_delivery_attempts_unique_attempt DO NOTHING"
    );
  });
});

describe("email dispatcher template lookup (Issue #153, second N+1)", () => {
  test("one template query per DISTINCT template_key per pass, not one per message", async () => {
    const sent: string[] = [];
    const { sql, queries } = createFakeSql([
      messageRow({ id: "a", template_key: "system.announcement" }),
      messageRow({ id: "b", template_key: "system.announcement" }),
      messageRow({ id: "c", template_key: "system.announcement" }),
      messageRow({ id: "d", template_key: "system.maintenance" })
    ]);

    await dispatchEmailQueue(sql, TENANT_ID, {
      now: NOW,
      env: ENV,
      resolveProvider: () => okProvider(sent)
    });

    expect(sent).toHaveLength(4);

    const templateQueries = queries.filter((query) =>
      query.text.includes("FROM awcms_email_templates")
    );

    // Two distinct keys across four messages -> two lookups (was four, each
    // in its own `withTenant` transaction).
    expect(templateQueries).toHaveLength(2);
  });

  test("caching does not skip the provider call or collapse per-message rendering — every claimed message is still sent individually (ADR-0006: one provider call per message, outside any transaction)", async () => {
    const sent: string[] = [];
    const { sql } = createFakeSql([
      messageRow({ id: "a", to_address: "one@example.com" }),
      messageRow({ id: "b", to_address: "two@example.com" })
    ]);

    const result = await dispatchEmailQueue(sql, TENANT_ID, {
      now: NOW,
      env: ENV,
      resolveProvider: () => okProvider(sent)
    });

    expect(sent).toEqual(["one@example.com", "two@example.com"]);
    expect(result.sent).toBe(2);
  });

  test("a missing template is cached as a negative result — 3 messages pointing at the same deleted template cost one lookup, and all 3 still fail", async () => {
    const sent: string[] = [];
    const { sql, queries } = createFakeSql(
      [
        messageRow({ id: "a" }),
        messageRow({ id: "b" }),
        messageRow({ id: "c" })
      ],
      { templateExists: false }
    );

    const result = await dispatchEmailQueue(sql, TENANT_ID, {
      now: NOW,
      env: ENV,
      resolveProvider: () => okProvider(sent)
    });

    expect(result.failed).toBe(3);
    expect(sent).toHaveLength(0);
    expect(
      queries.filter((query) =>
        query.text.includes("FROM awcms_email_templates")
      )
    ).toHaveLength(1);
  });
});

function failingProvider(
  failure: Extract<Awaited<ReturnType<EmailProvider["send"]>>, { ok: false }>
): EmailProvider {
  return {
    send: async () => failure,
    healthCheck: async () => ({ ok: true })
  } as unknown as EmailProvider;
}

function updateOf(queries: CapturedQuery[], status: string): CapturedQuery {
  const found = queries.find(
    (query) =>
      query.text.includes("UPDATE awcms_email_messages") &&
      query.text.includes(`SET status = '${status}'`) &&
      !query.text.includes("SET status = 'sending'")
  );

  expect(found).toBeDefined();

  return found!;
}

describe("email dispatcher — Mailketing v2 outcomes (Issue #1159)", () => {
  test("a fresh claim is not classified uncertain", async () => {
    const { sql, queries } = createFakeSql([messageRow()]);

    const result = await dispatchEmailQueue(sql, TENANT_ID, {
      now: NOW,
      env: ENV,
      resolveProvider: () => okProvider([])
    });

    expect(result.uncertain).toBe(0);
    expect(updateOf(queries, "sent").values).not.toContain(
      expect.stringContaining("Uncertain delivery")
    );
  });

  test("a re-claimed expired lease is sent, counted uncertain, and the sent row is annotated (crash after provider acceptance)", async () => {
    const sent: string[] = [];
    const { sql, queries } = createFakeSql([messageRow({ reclaimed: true })]);

    const result = await dispatchEmailQueue(sql, TENANT_ID, {
      now: NOW,
      env: ENV,
      resolveProvider: () => okProvider(sent)
    });

    expect(sent).toHaveLength(1);
    expect(result.sent).toBe(1);
    expect(result.uncertain).toBe(1);
    expect(updateOf(queries, "sent").values).toContainEqual(
      expect.stringContaining("Uncertain delivery")
    );
  });

  test("the claim marks re-claimed rows from the pre-update status", async () => {
    const { sql, queries } = createFakeSql([]);

    await dispatchEmailQueue(sql, TENANT_ID, {
      now: NOW,
      env: ENV,
      resolveProvider: () => okProvider([])
    });

    expect(claimQueryOf(queries).text).toContain(
      "(status = 'sending') AS reclaimed"
    );
  });

  test("402 (skipped + holdMs): returned to queued, no attempt row, no retry spent, held until now + holdMs", async () => {
    const { sql, queries } = createFakeSql([messageRow()]);

    const result = await dispatchEmailQueue(sql, TENANT_ID, {
      now: NOW,
      env: ENV,
      resolveProvider: () =>
        failingProvider({
          ok: false,
          error: "Mailketing v2 reports insufficient credit (HTTP 402).",
          retryable: true,
          skipped: true,
          holdMs: 900_000
        })
    });

    expect(result.deferred).toBe(1);
    expect(result.retried).toBe(0);
    expect(result.failed).toBe(0);
    expect(
      queries.some((q) =>
        q.text.includes("INSERT INTO awcms_email_delivery_attempts")
      )
    ).toBe(false);
    expect(updateOf(queries, "queued").values).toContainEqual(
      new Date(NOW.getTime() + 900_000)
    );
  });

  test("a skipped result without holdMs keeps the old behaviour (due again immediately)", async () => {
    const { sql, queries } = createFakeSql([messageRow()]);

    await dispatchEmailQueue(sql, TENANT_ID, {
      now: NOW,
      env: ENV,
      resolveProvider: () =>
        failingProvider({
          ok: false,
          error: "breaker open",
          retryable: true,
          skipped: true
        })
    });

    expect(updateOf(queries, "queued").values).toContainEqual(null);
  });

  test("429 with Retry-After schedules the retry no sooner than the provider asked", async () => {
    const { sql, queries } = createFakeSql([messageRow()]);

    const result = await dispatchEmailQueue(sql, TENANT_ID, {
      now: NOW,
      env: ENV,
      resolveProvider: () =>
        failingProvider({
          ok: false,
          error: "Mailketing v2 rate limited the request (HTTP 429).",
          retryable: true,
          retryAfterMs: 600_000
        })
    });

    expect(result.retried).toBe(1);
    expect(updateOf(queries, "retry_wait").values).toContainEqual(
      new Date(NOW.getTime() + 600_000)
    );
  });

  test("a non-retryable refusal goes terminal and the stored error carries no recipient", async () => {
    const { sql, queries } = createFakeSql([messageRow()]);

    const result = await dispatchEmailQueue(sql, TENANT_ID, {
      now: NOW,
      env: ENV,
      resolveProvider: () =>
        failingProvider({
          ok: false,
          error: "Mailketing v2 refused the message (code INVALID_RECIPIENT).",
          retryable: false
        })
    });

    expect(result.failed).toBe(1);
    expect(JSON.stringify(updateOf(queries, "failed").values)).not.toContain(
      "user@example.com"
    );
  });
});

describe("email dispatcher — follow-up hardening (Issue #1159)", () => {
  const OLD = new Date(NOW.getTime() - 2 * 3_600_000).toISOString();
  const FRESH = new Date(NOW.getTime() - 60_000).toISOString();

  function skipped(extra: Record<string, unknown>) {
    return failingProvider({
      ok: false,
      error: "held",
      retryable: true,
      skipped: true,
      ...extra
    } as never);
  }

  test("M1: a configuration error DEFERS the batch (queued, held, no attempt row, nothing failed) and is reported as misconfigured", async () => {
    const { resolveEmailProvider } =
      await import("../src/modules/email/infrastructure/email-provider-resolver");
    const { sql, queries } = createFakeSql([
      messageRow({ id: "a" }),
      messageRow({ id: "b" })
    ]);

    const result = await dispatchEmailQueue(sql, TENANT_ID, {
      now: NOW,
      env: ENV,
      // The pre-existing missing-token case, plus a v2 typo.
      resolveProvider: () =>
        resolveEmailProvider({
          EMAIL_PROVIDER: "mailketing",
          EMAIL_MAILKETING_API_VERSION: "V2"
        } as unknown as NodeJS.ProcessEnv)
    });

    expect(result).toMatchObject({
      claimed: 2,
      deferred: 2,
      misconfigured: 2,
      failed: 0,
      retried: 0,
      sent: 0
    });
    expect(
      queries.some((q) =>
        q.text.includes("INSERT INTO awcms_email_delivery_attempts")
      )
    ).toBe(false);
    expect(queries.some((q) => q.text.includes("SET status = 'failed'"))).toBe(
      false
    );
    expect(updateOf(queries, "queued").values).toContainEqual(
      new Date(NOW.getTime() + 5 * 60_000)
    );
  });

  test("M1: once the configuration is fixed the same row sends", async () => {
    const sent: string[] = [];
    const { sql } = createFakeSql([messageRow()]);

    const result = await dispatchEmailQueue(sql, TENANT_ID, {
      now: NOW,
      env: ENV,
      resolveProvider: () => okProvider(sent)
    });

    expect(result).toMatchObject({ sent: 1, misconfigured: 0 });
    expect(sent).toHaveLength(1);
  });

  test("M2a: a provider answer that leaves delivery unknown is terminal (not retried) and counted uncertain", async () => {
    const { sql, queries } = createFakeSql([messageRow()]);

    const result = await dispatchEmailQueue(sql, TENANT_ID, {
      now: NOW,
      env: ENV,
      resolveProvider: () =>
        failingProvider({
          ok: false,
          error:
            "Mailketing v2 returned a malformed 200 response (UNCERTAIN_MALFORMED_RESPONSE)",
          retryable: false,
          uncertain: true
        })
    });

    expect(result).toMatchObject({ failed: 1, retried: 0, uncertain: 1 });
    expect(updateOf(queries, "failed").values).toContainEqual(
      expect.stringContaining("UNCERTAIN_MALFORMED_RESPONSE")
    );
  });

  test("L1: a credit hold past the budget fails with a named reason; a young message is still held", async () => {
    const old = createFakeSql([messageRow({ created_at: OLD })]);
    const oldResult = await dispatchEmailQueue(old.sql, TENANT_ID, {
      now: NOW,
      env: ENV,
      resolveProvider: () => skipped({ holdMs: 900_000, creditHold: true })
    });

    expect(oldResult).toMatchObject({ failed: 1, deferred: 0 });
    expect(updateOf(old.queries, "failed").values).toContainEqual(
      expect.stringContaining("CREDIT_HOLD_BUDGET_EXCEEDED")
    );
    expect(
      old.queries.some((q) =>
        q.text.includes("INSERT INTO awcms_email_delivery_attempts")
      )
    ).toBe(true);

    const young = createFakeSql([messageRow({ created_at: FRESH })]);
    const youngResult = await dispatchEmailQueue(young.sql, TENANT_ID, {
      now: NOW,
      env: ENV,
      resolveProvider: () => skipped({ holdMs: 900_000, creditHold: true })
    });

    expect(youngResult).toMatchObject({ failed: 0, deferred: 1 });
  });

  test("L1: the budget applies to credit holds only, never to a configuration hold", async () => {
    const { sql } = createFakeSql([messageRow({ created_at: OLD })]);
    const result = await dispatchEmailQueue(sql, TENANT_ID, {
      now: NOW,
      env: ENV,
      resolveProvider: () => skipped({ holdMs: 300_000, configError: true })
    });

    expect(result).toMatchObject({ failed: 0, deferred: 1 });
  });

  test("L2: a re-claimed row that is deferred keeps the note but is NOT counted uncertain (it was not re-sent)", async () => {
    const { sql, queries } = createFakeSql([messageRow({ reclaimed: true })]);
    const result = await dispatchEmailQueue(sql, TENANT_ID, {
      now: NOW,
      env: ENV,
      resolveProvider: () => skipped({ holdMs: 900_000, creditHold: true })
    });

    expect(result).toMatchObject({ deferred: 1, uncertain: 0 });
    expect(updateOf(queries, "queued").values).toContainEqual(
      expect.stringContaining("uncertain")
    );
  });

  test.each([
    ["retried", { retryable: true }, "retry_wait"],
    ["failed", { retryable: false }, "failed"]
  ])(
    "L2: a re-claimed row that ends %s is counted uncertain and carries the note",
    async (counter, failure, status) => {
      const { sql, queries } = createFakeSql([messageRow({ reclaimed: true })]);
      const result = await dispatchEmailQueue(sql, TENANT_ID, {
        now: NOW,
        env: ENV,
        resolveProvider: () =>
          failingProvider({ ok: false, error: "boom", ...failure } as never)
      });

      expect(result.uncertain).toBe(1);
      expect(result[counter as "retried" | "failed"]).toBe(1);
      expect(updateOf(queries, status).values).toContainEqual(
        expect.stringContaining("uncertain")
      );
    }
  );

  test("c: a v2 dispatch pass without the stage-2 acknowledgement logs the UNVERIFIED warning; with it, not", async () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };

    try {
      const v2Env = {
        ...ENV,
        EMAIL_PROVIDER: "mailketing",
        EMAIL_MAILKETING_API_VERSION: "v2"
      } as unknown as NodeJS.ProcessEnv;
      const run = (env: NodeJS.ProcessEnv) =>
        dispatchEmailQueue(createFakeSql([messageRow()]).sql, TENANT_ID, {
          now: NOW,
          env,
          resolveProvider: () => okProvider([])
        });

      await run(v2Env);
      expect(lines.join("\n")).toContain("mailketing_v2_unverified");

      lines.length = 0;
      await run({
        ...v2Env,
        EMAIL_MAILKETING_V2_VERIFIED: "true"
      } as unknown as NodeJS.ProcessEnv);
      expect(lines.join("\n")).not.toContain("mailketing_v2_unverified");

      lines.length = 0;
      await run({
        ...ENV,
        EMAIL_PROVIDER: "mailketing"
      } as unknown as NodeJS.ProcessEnv);
      expect(lines.join("\n")).not.toContain("mailketing_v2_unverified");
    } finally {
      console.log = original;
    }
  });
});
