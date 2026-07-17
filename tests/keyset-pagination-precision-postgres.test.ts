/**
 * Real-PostgreSQL proof for Issue #158 — the shared keyset cursor must carry
 * the MICROSECOND precision of `timestamptz`, not the millisecond precision a
 * JS `Date` can hold.
 *
 * The bug: `encodeKeysetCursor` used to serialise `row.created_at` as a JS
 * `Date` (`.toISOString()`), which the driver had already floored from
 * microseconds to milliseconds. A cursor built from `...:00.029058+00` became
 * `...:00.029Z`, i.e. an instant strictly EARLIER than the row it came from,
 * so `(created_at, id) < (cursor)` skipped EVERY row sharing that millisecond
 * — page 2 came back EMPTY when a batch of rows shared one millisecond, and
 * those rows were unreachable by any later cursor. This is silent data loss on
 * live list endpoints.
 *
 * Each test below pins the failure with a batch of rows that all share one
 * exact `created_at` (microseconds included): the FIXED directory cursor
 * returns the remaining rows on page 2 (a clean partition), while a cursor
 * rebuilt the OLD (millisecond-floored) way returns NOTHING — proving both the
 * bug and its fix against the same seeded data.
 *
 * Gated on `DATABASE_URL` (the convention this repo's CI uses:
 * `ci.yml` has no database and skips cleanly; `release.yml` provides a
 * `postgres:18.4` service and sets `DATABASE_URL`, so it runs there). No
 * `mock.module` anywhere — it mutates the live module namespace and leaks into
 * every later test file in the process. The suite only touches tenants it
 * creates and deletes.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  decodeKeysetCursor,
  encodeKeysetCursor
} from "../src/modules/_shared/keyset-pagination";
import { listWorkflowInboxTasks } from "../src/modules/workflow-approval/application/workflow-inbox-directory";
import {
  fetchEmailMessageEntries,
  EMAIL_MESSAGE_LIST_LIMIT
} from "../src/modules/email/application/email-message-directory";

const DATABASE_URL = process.env.DATABASE_URL;
const describeOrSkip = DATABASE_URL ? describe : describe.skip;

// One fixed instant with a non-zero MICROSECOND tail, shared by every seeded
// row in a batch. `.029058` is exactly the value the driver floors to `.029Z`,
// which is what made the old cursor sort ahead of its own row.
const SHARED_CREATED_AT = "2026-07-17 10:00:00.029058+00";
const REQUESTER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describeOrSkip(
  "keyset pagination precision (Issue #158, real PostgreSQL)",
  () => {
    let sql: Bun.SQL;
    const createdTenantIds: string[] = [];

    beforeAll(() => {
      sql = new Bun.SQL(DATABASE_URL!, { max: 5 });
    });

    afterAll(async () => {
      for (const tenantId of createdTenantIds) {
        await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
        await sql`DELETE FROM awcms_workflow_tasks WHERE tenant_id = ${tenantId}`;
        await sql`DELETE FROM awcms_workflow_instances WHERE tenant_id = ${tenantId}`;
        await sql`DELETE FROM awcms_workflow_definitions WHERE tenant_id = ${tenantId}`;
        await sql`DELETE FROM awcms_email_messages WHERE tenant_id = ${tenantId}`;
        await sql`DELETE FROM awcms_tenants WHERE id = ${tenantId}`;
      }
      await sql.close({ timeout: 5 });
    });

    async function createTenant(label: string): Promise<string> {
      const suffix = Math.random().toString(36).slice(2, 10);
      const rows = (await sql`
      INSERT INTO awcms_tenants (tenant_code, tenant_name)
      VALUES (${`ks158-${label}-${suffix}`}, ${`Keyset 158 ${label}`})
      RETURNING id
    `) as { id: string }[];
      const tenantId = rows[0]!.id;
      createdTenantIds.push(tenantId);
      await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
      return tenantId;
    }

    /** Mirrors `withTenant`: pins the tenant GUC, runs in one transaction. */
    async function inTenant<T>(
      tenantId: string,
      fn: (tx: Bun.SQL) => Promise<T>
    ): Promise<T> {
      return sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        return fn(tx as unknown as Bun.SQL);
      }) as Promise<T>;
    }

    test("workflow inbox — page 2 is empty under the OLD cursor and complete under the fix", async () => {
      const tenantId = await createTenant("wf");
      const total = 103; // page size is 100 → 3 rows must land on page 2.

      const definitionRows = (await sql`
      INSERT INTO awcms_workflow_definitions
        (tenant_id, workflow_key, name, version, lifecycle_status, graph, facts_schema)
      VALUES (${tenantId}, ${"ks158"}, ${"Keyset 158"}, 1, 'active',
              ${"{}"}::jsonb, ${"[]"}::jsonb)
      RETURNING id
    `) as { id: string }[];
      const instanceRows = (await sql`
      INSERT INTO awcms_workflow_instances
        (tenant_id, workflow_definition_id, workflow_definition_version,
         resource_type, resource_id, status, requested_by_tenant_user_id, facts)
      VALUES (${tenantId}, ${definitionRows[0]!.id}, 1, ${"invoice"}, ${"inv-1"},
              'pending', ${REQUESTER}, ${"{}"}::jsonb)
      RETURNING id
    `) as { id: string }[];
      const instanceId = instanceRows[0]!.id;

      // Every task shares the SAME microsecond-bearing created_at — the batch
      // that the millisecond-floored cursor cannot page past.
      for (let index = 0; index < total; index += 1) {
        await sql`
        INSERT INTO awcms_workflow_tasks
          (tenant_id, workflow_instance_id, node_id, quorum_rule, status, created_at)
        VALUES (${tenantId}, ${instanceId}, ${"approval"}, 'all', 'pending',
                ${SHARED_CREATED_AT}::timestamptz)
      `;
      }

      const page1 = await inTenant(tenantId, (tx) =>
        listWorkflowInboxTasks(tx, tenantId, {}, new Date(), null)
      );
      expect(page1.tasks).toHaveLength(100);
      expect(page1.nextCursor).not.toBeNull();

      // FIX: the directory's own cursor carries full precision → page 2 returns
      // the remaining rows and the two pages partition the set exactly.
      const page2Fixed = await inTenant(tenantId, (tx) =>
        listWorkflowInboxTasks(
          tx,
          tenantId,
          {},
          new Date(),
          decodeKeysetCursor(page1.nextCursor!)
        )
      );
      expect(page2Fixed.tasks).toHaveLength(total - 100);
      expect(page2Fixed.nextCursor).toBeNull();
      const seen = [...page1.tasks, ...page2Fixed.tasks].map((t) => t.id);
      expect(new Set(seen).size).toBe(total);

      // BUG: rebuild the cursor the OLD way (from the DTO's JS `Date`, floored to
      // milliseconds) — page 2 comes back EMPTY, the silent data loss #158 fixes.
      const last = page1.tasks[page1.tasks.length - 1]!;
      const oldCursor = encodeKeysetCursor(
        last.createdAt.toISOString(),
        last.id
      );
      const page2Old = await inTenant(tenantId, (tx) =>
        listWorkflowInboxTasks(
          tx,
          tenantId,
          {},
          new Date(),
          decodeKeysetCursor(oldCursor)
        )
      );
      expect(page2Old.tasks).toHaveLength(0);
    });

    test("email messages — page 2 is empty under the OLD cursor and complete under the fix", async () => {
      const tenantId = await createTenant("email");
      const total = EMAIL_MESSAGE_LIST_LIMIT + 3;

      for (let index = 0; index < total; index += 1) {
        await sql`
        INSERT INTO awcms_email_messages
          (tenant_id, category, status, to_address, to_address_hash,
           to_address_masked, subject, created_at)
        VALUES (${tenantId}, ${"workflow.notification"}, 'queued',
                ${`u${index}@example.com`}, ${`hash-${index}`}, ${"u***@example.com"},
                ${"Subject"}, ${SHARED_CREATED_AT}::timestamptz)
      `;
      }

      const page1 = await inTenant(tenantId, (tx) =>
        fetchEmailMessageEntries(tx, tenantId, undefined, undefined)
      );
      expect(page1.messages).toHaveLength(EMAIL_MESSAGE_LIST_LIMIT);
      expect(page1.nextCursor).not.toBeNull();

      const page2Fixed = await inTenant(tenantId, (tx) =>
        fetchEmailMessageEntries(
          tx,
          tenantId,
          undefined,
          decodeKeysetCursor(page1.nextCursor!) ?? undefined
        )
      );
      expect(page2Fixed.messages).toHaveLength(
        total - EMAIL_MESSAGE_LIST_LIMIT
      );
      expect(page2Fixed.nextCursor).toBeNull();
      const seen = [...page1.messages, ...page2Fixed.messages].map((m) => m.id);
      expect(new Set(seen).size).toBe(total);

      // OLD (millisecond) cursor: the DTO's `createdAt` is already floored to
      // `...029Z`, exactly what the buggy route fed back — page 2 is empty.
      const last = page1.messages[page1.messages.length - 1]!;
      const oldCursor = encodeKeysetCursor(last.createdAt, last.id);
      const page2Old = await inTenant(tenantId, (tx) =>
        fetchEmailMessageEntries(
          tx,
          tenantId,
          undefined,
          decodeKeysetCursor(oldCursor) ?? undefined
        )
      );
      expect(page2Old.messages).toHaveLength(0);
    });
  }
);
