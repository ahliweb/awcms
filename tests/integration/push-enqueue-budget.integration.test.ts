/**
 * A query budget on the push fan-out.
 *
 * ## The defect this pins, and why nobody felt it
 *
 * `enqueuePushToRecipients` cost `R + (R x S)` queries — one subscription
 * lookup per recipient, then one `INSERT` per device — all inside a single
 * transaction holding one connection. A broadcast to 500 users with two devices
 * each was 1,500 round trips.
 *
 * Nothing in production ever paid it: the only caller today,
 * `POST /api/v1/push/test`, passes exactly one recipient. That is precisely why
 * it needed a test rather than a fix and a shrug. The helper's contract is
 * "every ACTIVE subscription of every recipient", so the cost is not a property
 * of the function as used — it is a property waiting for the first caller that
 * broadcasts, at which point it arrives as a production incident rather than a
 * review comment.
 *
 * ## The budget is EXACT, and the fixture is much larger than it
 *
 * Two statements: one batched subscription lookup, one
 * `INSERT ... jsonb_to_recordset`. Exact rather than a ceiling, because the
 * whole property being asserted is that the number does NOT move with the
 * fan-out — `toBeLessThanOrEqual` would pass a regression that reintroduced a
 * per-device query as long as the fixture stayed small.
 *
 * The fixture is 4 recipients with 9 subscriptions between them. Under the old
 * shape that is 4 + 9 = 13 queries against a budget of 2, so it cannot pass by
 * accident.
 *
 * ## Correctness is asserted alongside the count
 *
 * A budget on its own is satisfied by a function that writes nothing. The
 * `jsonb_to_recordset` rewrite is exactly the kind of change that can satisfy a
 * counter while corrupting what lands: `data` can arrive as a jsonb STRING
 * instead of an object, and a NULL can arrive as the literal text `'null'`,
 * both silently. Every case below reads the rows back out of the table.
 *
 * Gated on `DATABASE_URL` (harness §Gating).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { countQueries } from "./query-budget";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { enqueuePushToRecipients } from "../../src/modules/push-delivery/application/push-enqueue";

const TENANT = "f8888888-8888-4888-8888-888888888888";

/**
 * Deliberately uneven: one recipient with four devices, one with three, one
 * with two, and one with none. The last is what separates "queued" from
 * "skipped", and an even fan-out would let an off-by-one in the grouping pass.
 */
const RECIPIENTS = [
  { id: "f8000000-0000-4000-8000-000000000001", devices: 4 },
  { id: "f8000000-0000-4000-8000-000000000002", devices: 3 },
  { id: "f8000000-0000-4000-8000-000000000003", devices: 2 },
  { id: "f8000000-0000-4000-8000-000000000004", devices: 0 }
] as const;

const TOTAL_DEVICES = RECIPIENTS.reduce(
  (total, recipient) => total + recipient.devices,
  0
);

/** One batched lookup, one batched INSERT. */
const ENQUEUE_QUERY_BUDGET = 2;

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'push-budget', 'Push Budget Tenant')
  `;

  for (const recipient of RECIPIENTS) {
    const profile = (await admin`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${TENANT}, 'person', 'Recipient')
      RETURNING id
    `) as { id: string }[];
    const identity = (await admin`
      INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${TENANT}, ${profile[0]!.id}, ${`${recipient.id}@example.test`}, 'x')
      RETURNING id
    `) as { id: string }[];
    await admin`
      INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
      VALUES (${recipient.id}, ${TENANT}, ${identity[0]!.id})
    `;

    if (recipient.devices === 0) continue;

    await admin`
      INSERT INTO awcms_push_subscriptions
        (tenant_id, tenant_user_id, transport, endpoint, endpoint_hash,
         endpoint_masked, status)
      SELECT ${TENANT}, ${recipient.id}, 'fcm',
             ${`${recipient.id}-device-`} || n,
             ${`${recipient.id}-hash-`} || n,
             'device-…token', 'active'
      FROM generate_series(1, ${recipient.devices}) AS n
    `;
  }

  // A disabled device on the busiest recipient. The lookup filters on
  // `status = 'active'`, and a batched predicate that dropped that filter would
  // otherwise look correct in every count.
  await admin`
    INSERT INTO awcms_push_subscriptions
      (tenant_id, tenant_user_id, transport, endpoint, endpoint_hash,
       endpoint_masked, status)
    VALUES (${TENANT}, ${RECIPIENTS[0].id}, 'fcm', 'disabled-endpoint',
            'disabled-hash', 'device-…token', 'disabled')
  `;
}

async function queuedMessages(): Promise<
  {
    subscription_id: string;
    category: string;
    title: string;
    data: unknown;
    target_path: string | null;
    correlation_id: string | null;
    created_by: string | null;
  }[]
> {
  return (await getAdminSql()`
    SELECT subscription_id, category, title, data, target_path, correlation_id,
           created_by
    FROM awcms_push_messages
    WHERE tenant_id = ${TENANT}
    ORDER BY created_at, id
  `) as never;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("a push fan-out costs two queries, whatever its size", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedFixtures();
  });

  test("nine devices across four recipients cost two queries", async () => {
    const runtime = getRuntimeSql();

    const { result, queries } = await withTenantOrThrow(runtime, TENANT, (tx) =>
      countQueries(tx, (counting) =>
        enqueuePushToRecipients(
          counting,
          TENANT,
          RECIPIENTS.map((recipient) => recipient.id),
          { category: "test.broadcast", title: "T", body: "B" }
        )
      )
    );

    expect(queries).toBe(ENQUEUE_QUERY_BUDGET);
    expect(result.messageIds).toHaveLength(TOTAL_DEVICES);
    expect(result.skippedRecipients).toEqual([RECIPIENTS[3].id]);

    // The disabled device got nothing, which is the `status = 'active'` filter
    // surviving the move into a batched predicate.
    expect(await queuedMessages()).toHaveLength(TOTAL_DEVICES);
  });

  test("one recipient with one device costs the same two queries", async () => {
    const runtime = getRuntimeSql();

    const { result, queries } = await withTenantOrThrow(runtime, TENANT, (tx) =>
      countQueries(tx, (counting) =>
        enqueuePushToRecipients(counting, TENANT, [RECIPIENTS[2].id], {
          category: "test.single",
          title: "T",
          body: "B"
        })
      )
    );

    // The number does not move with the input. That is the whole property, and
    // the cheap case did not get more expensive to make the expensive one cheap.
    expect(queries).toBe(ENQUEUE_QUERY_BUDGET);
    expect(result.messageIds).toHaveLength(2);
  });

  test("a recipient with no active device costs ONE query and writes nothing", async () => {
    const runtime = getRuntimeSql();

    const { result, queries } = await withTenantOrThrow(runtime, TENANT, (tx) =>
      countQueries(tx, (counting) =>
        enqueuePushToRecipients(counting, TENANT, [RECIPIENTS[3].id], {
          category: "test.skipped",
          title: "T",
          body: "B"
        })
      )
    );

    // An empty `jsonb_to_recordset` INSERT would be legal and a wasted round
    // trip. Most users never enable push, so this is the COMMON case.
    expect(queries).toBe(1);
    expect(result.messageIds).toEqual([]);
    expect(result.skippedRecipients).toEqual([RECIPIENTS[3].id]);
    expect(await queuedMessages()).toEqual([]);
  });

  test("no recipients at all costs no queries", async () => {
    const runtime = getRuntimeSql();

    const { result, queries } = await withTenantOrThrow(runtime, TENANT, (tx) =>
      countQueries(tx, (counting) =>
        enqueuePushToRecipients(counting, TENANT, [], {
          category: "test.empty",
          title: "T",
          body: "B"
        })
      )
    );

    expect(queries).toBe(0);
    expect(result).toEqual({ messageIds: [], skippedRecipients: [] });
  });

  test("`data` lands as a jsonb OBJECT, and absent columns as real NULLs", async () => {
    // The two ways `jsonb_to_recordset` goes wrong silently. A stringified
    // binding stores `'{"a":"b"}'` as a jsonb STRING that reads back as text,
    // and a Bun.SQL array cannot carry NULL — it writes the literal `'null'`.
    // Both satisfy any query counter.
    const runtime = getRuntimeSql();

    await withTenantOrThrow(runtime, TENANT, (tx) =>
      enqueuePushToRecipients(tx, TENANT, [RECIPIENTS[2].id], {
        category: "test.payload",
        title: "Titled",
        body: "B",
        data: { postId: "abc", kind: "article" }
      })
    );

    const rows = await queuedMessages();
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(row.data).toEqual({ postId: "abc", kind: "article" });
      // Not the string "null", and not the string "undefined".
      expect(row.target_path).toBeNull();
      expect(row.correlation_id).toBeNull();
      expect(row.created_by).toBeNull();
    }

    // Read back through jsonb operators too: a jsonb STRING would answer
    // `string` here while `toEqual` above could still pass on a parsed value.
    const typed = (await getAdminSql()`
      SELECT jsonb_typeof(data) AS kind, data ->> 'postId' AS post_id
      FROM awcms_push_messages
      WHERE tenant_id = ${TENANT}
      LIMIT 1
    `) as { kind: string; post_id: string | null }[];

    expect(typed[0]!.kind).toBe("object");
    expect(typed[0]!.post_id).toBe("abc");
  });

  test("every queued row carries the same message, one per device", async () => {
    const runtime = getRuntimeSql();

    await withTenantOrThrow(runtime, TENANT, (tx) =>
      enqueuePushToRecipients(
        tx,
        TENANT,
        RECIPIENTS.map((recipient) => recipient.id),
        {
          category: "test.broadcast",
          title: "Shared title",
          body: "B",
          targetPath: "/news/hello"
        }
      )
    );

    const rows = await queuedMessages();
    const subscriptionIds = new Set(rows.map((row) => row.subscription_id));

    // One row per DEVICE, never one per recipient, and never a duplicate.
    expect(rows).toHaveLength(TOTAL_DEVICES);
    expect(subscriptionIds.size).toBe(TOTAL_DEVICES);

    for (const row of rows) {
      expect(row.title).toBe("Shared title");
      expect(row.category).toBe("test.broadcast");
      expect(row.target_path).toBe("/news/hello");
    }
  });
});
