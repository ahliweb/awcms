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
