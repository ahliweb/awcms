/**
 * Issue #153 — `enqueueAnnouncement` ran one INSERT per recipient inside a
 * single HTTP request's transaction, and `resolveAnnouncementTargets` had no
 * LIMIT for `tenant`/`role` targets.
 *
 * Driven against a fake `Bun.SQL` that records every statement (see
 * `email-dispatch-lease.test.ts` for the same harness rationale): the number
 * of round trips and the bound LIMIT *are* the behavior under test.
 */
import { describe, expect, test } from "bun:test";

import {
  ANNOUNCEMENT_MAX_RECIPIENTS,
  enqueueAnnouncement,
  resolveBoundedAnnouncementTargets
} from "../src/modules/email/application/announcement-directory";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const CORRELATION_ID = "33333333-3333-3333-3333-333333333333";

const TEMPLATE_ROW = {
  subject_template: { en: "Hello {{userName}}" },
  text_body_template: { en: "Dear {{userName}}: {{body}}" },
  html_body_template: null
};

type CapturedQuery = { text: string; values: unknown[] };

type FakeArray = { values: unknown[]; type: string };

function targetRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    tenant_user_id: `user-${index}`,
    login_identifier: `user${index}@example.com`,
    display_name: `User ${index}`
  }));
}

function createFakeSql(rowCount: number): {
  sql: Bun.SQL;
  queries: CapturedQuery[];
} {
  const queries: CapturedQuery[] = [];

  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ? ").replace(/\s+/g, " ").trim();

    queries.push({ text, values });

    if (text.includes("FROM awcms_email_templates")) {
      return Promise.resolve([TEMPLATE_ROW]);
    }

    if (text.includes("awcms_email_suppression_list")) {
      return Promise.resolve([]);
    }

    if (text.includes("FROM awcms_tenant_users")) {
      return Promise.resolve(targetRows(rowCount));
    }

    return Promise.resolve([]);
  };

  run.unsafe = () => Promise.resolve([]);
  run.array = (values: unknown[], type: string): FakeArray => ({
    values,
    type
  });

  return { sql: run as unknown as Bun.SQL, queries };
}

function messageInsertsOf(queries: CapturedQuery[]): CapturedQuery[] {
  return queries.filter((query) =>
    query.text.includes("INSERT INTO awcms_email_messages")
  );
}

describe("enqueueAnnouncement batching (Issue #153)", () => {
  test("1200 recipients cost 3 batched INSERTs, not 1200 sequential round trips inside the request's transaction", async () => {
    const { sql, queries } = createFakeSql(1200);

    const result = await enqueueAnnouncement(
      sql,
      TENANT_ID,
      "system.announcement",
      { title: "Maintenance", body: "Tonight" },
      { type: "tenant" },
      CORRELATION_ID
    );

    expect(result).not.toBeNull();
    expect(result!.recipientCount).toBe(1200);

    const inserts = messageInsertsOf(queries);

    // ceil(1200 / 500) — was 1200 on the N+1 version.
    expect(inserts).toHaveLength(3);
  });

  test("every batch is a single multi-row INSERT via unnest, and no batch carries more than 500 rows", async () => {
    const { sql, queries } = createFakeSql(1200);

    await enqueueAnnouncement(
      sql,
      TENANT_ID,
      "system.announcement",
      { title: "Maintenance", body: "Tonight" },
      { type: "tenant" },
      CORRELATION_ID
    );

    const inserts = messageInsertsOf(queries);
    const batchSizes = inserts.map((insert) => {
      const arrays = insert.values.filter(
        (value): value is FakeArray =>
          typeof value === "object" &&
          value !== null &&
          Array.isArray((value as FakeArray).values)
      );

      expect(insert.text).toContain("FROM unnest(");
      // One array parameter per unnested column: to_address,
      // to_address_hash, to_address_masked, subject, variables.
      expect(arrays).toHaveLength(5);

      const sizes = new Set(arrays.map((array) => array.values.length));

      // All five columns of a batch must carry the same row count —
      // mismatched arrays would make `unnest` pad with NULLs and violate
      // the table's NOT NULL columns.
      expect(sizes.size).toBe(1);

      return arrays[0]!.values.length;
    });

    expect(batchSizes).toEqual([500, 500, 200]);
  });

  test("every resolved recipient is enqueued exactly once, addresses intact across batch boundaries", async () => {
    const { sql, queries } = createFakeSql(1200);

    await enqueueAnnouncement(
      sql,
      TENANT_ID,
      "system.announcement",
      { title: "Maintenance", body: "Tonight" },
      { type: "tenant" },
      CORRELATION_ID
    );

    const addresses = messageInsertsOf(queries).flatMap((insert) => {
      const arrays = insert.values.filter(
        (value): value is FakeArray =>
          typeof value === "object" &&
          value !== null &&
          Array.isArray((value as FakeArray).values)
      );

      return arrays[0]!.values as string[];
    });

    expect(addresses).toHaveLength(1200);
    expect(new Set(addresses).size).toBe(1200);
    expect(addresses[0]).toBe("user0@example.com");
    expect(addresses[499]).toBe("user499@example.com");
    expect(addresses[500]).toBe("user500@example.com");
    expect(addresses[1199]).toBe("user1199@example.com");
  });

  test("the per-recipient `variables` payload survives batching — each row still carries its own userName, not the batch's first one", async () => {
    const { sql, queries } = createFakeSql(3);

    await enqueueAnnouncement(
      sql,
      TENANT_ID,
      "system.announcement",
      { title: "Maintenance", body: "Tonight" },
      { type: "tenant" },
      CORRELATION_ID
    );

    const insert = messageInsertsOf(queries)[0]!;
    const arrays = insert.values.filter(
      (value): value is FakeArray =>
        typeof value === "object" &&
        value !== null &&
        Array.isArray((value as FakeArray).values)
    );
    const variables = (arrays[4]!.values as string[]).map(
      (value) => JSON.parse(value) as Record<string, string>
    );

    expect(variables.map((entry) => entry.userName)).toEqual([
      "User 0",
      "User 1",
      "User 2"
    ]);
    expect(variables[0]!.title).toBe("Maintenance");

    // Text array + explicit ::jsonb cast (Bun.SQL has no jsonb[] bind);
    // the column itself is still jsonb.
    expect(arrays[4]!.type).toBe("text");
    expect(insert.text).toContain("t.variables::jsonb");
  });

  test("no provider call and no send happens at enqueue time — this path only ever touches the database (ADR-0006)", async () => {
    const { sql, queries } = createFakeSql(600);

    await enqueueAnnouncement(
      sql,
      TENANT_ID,
      "system.announcement",
      { title: "Maintenance", body: "Tonight" },
      { type: "tenant" },
      CORRELATION_ID
    );

    // Every statement issued is a plain query on the caller's `tx`; the
    // batching rewrite must not have introduced any out-of-transaction
    // side effect or a status other than the default 'queued'.
    for (const query of messageInsertsOf(queries)) {
      expect(query.text).not.toContain("status");
    }
  });
});

describe("announcement target cap (Issue #153)", () => {
  test("tenant-wide targeting is bounded by ANNOUNCEMENT_MAX_RECIPIENTS instead of resolving an unbounded 50k-row set", async () => {
    const { sql, queries } = createFakeSql(10);

    await resolveBoundedAnnouncementTargets(sql, TENANT_ID, {
      type: "tenant"
    });

    const targetQuery = queries.find((query) =>
      query.text.includes("FROM awcms_tenant_users")
    );

    expect(targetQuery).toBeDefined();
    expect(targetQuery!.text).toContain("LIMIT ?");
    expect(targetQuery!.values).toContain(ANNOUNCEMENT_MAX_RECIPIENTS);
    // Deterministic truncation, so preview and enqueue resolve the same set.
    expect(targetQuery!.text).toContain("ORDER BY tu.created_at, tu.id");
  });

  test("role targeting is bounded too", async () => {
    const { sql, queries } = createFakeSql(10);

    await resolveBoundedAnnouncementTargets(sql, TENANT_ID, {
      type: "role",
      roleId: "44444444-4444-4444-4444-444444444444"
    });

    const targetQuery = queries.find((query) =>
      query.text.includes("FROM awcms_access_assignments")
    );

    expect(targetQuery).toBeDefined();
    expect(targetQuery!.values).toContain(ANNOUNCEMENT_MAX_RECIPIENTS);
  });

  test("a resolve that comes back under the cap is not reported as truncated", async () => {
    const { sql } = createFakeSql(10);

    const resolved = await resolveBoundedAnnouncementTargets(sql, TENANT_ID, {
      type: "tenant"
    });

    expect(resolved.recipients).toHaveLength(10);
    expect(resolved.truncated).toBe(false);
  });

  test("hitting the cap surfaces truncated: true rather than silently dropping the rest", async () => {
    const { sql } = createFakeSql(ANNOUNCEMENT_MAX_RECIPIENTS);

    const result = await enqueueAnnouncement(
      sql,
      TENANT_ID,
      "system.announcement",
      { title: "Maintenance", body: "Tonight" },
      { type: "tenant" },
      CORRELATION_ID
    );

    expect(result!.truncated).toBe(true);
    expect(result!.recipientCount).toBe(ANNOUNCEMENT_MAX_RECIPIENTS);
  });
});
