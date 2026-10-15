/**
 * Idempotency keys are scoped per actor (ADR-0145, issue #1000, audit F4 of
 * #990), against a real PostgreSQL with the runtime role (FORCE RLS in effect).
 *
 * Drives the shared store through a route-shaped `runIdempotent` (the inventory
 * helper: find, produce, save) so the assertions are about the SAME code path a
 * route takes, including `withTenant` turning a lost race into a replay or 409.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  assertRejected,
  createRuntimePool,
  getAdminSql,
  integrationEnabled,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenant } from "../../src/lib/database/tenant-context";
import {
  ANONYMOUS_IDEMPOTENCY_ACTOR,
  findIdempotencyRecord,
  LEGACY_UNSCOPED_IDEMPOTENCY_ACTOR,
  machineIdempotencyActor,
  userIdempotencyActor,
  computeRequestHash
} from "../../src/modules/_shared/idempotency";
import { runIdempotent } from "../../src/modules/inventory/application/inventory-route-support";

const suite = integrationEnabled ? describe : describe.skip;

const TENANT = "f1000000-0000-4000-8000-0000000000a1";
const ALICE = userIdempotencyActor("f1000000-0000-4000-8000-0000000000b1");
const BOB = userIdempotencyActor("f1000000-0000-4000-8000-0000000000b2");
const SCOPE = "idempotency_actor_scope_test";

let pool: Bun.SQL;

/** One request as a route would make it; `effects` counts real executions. */
async function request(
  actor: ReturnType<typeof userIdempotencyActor>,
  key: string,
  payload: unknown,
  effects: { count: number },
  label = "done"
): Promise<{ status: number; body: any }> {
  const response = await withTenant(pool, TENANT, (tx) =>
    runIdempotent(tx, TENANT, SCOPE, key, actor, payload, async () => {
      effects.count += 1;
      return { status: 201, body: { by: label } };
    })
  );
  const res = response as Response;

  return { status: res.status, body: await res.json() };
}

suite("idempotency actor scope (integration)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
    pool = createRuntimePool(8);
    await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${TENANT}, 'idem-actor', 'idem-actor')
    `;
  });

  afterAll(async () => {
    await pool?.close({ timeout: 1 });
    await teardownIntegrationDatabase();
  });

  test("a colleague cannot squat another actor's predictable key", async () => {
    const effects = { count: 0 };
    const key = "clock-in-2026-10-15";

    // Bob claims the victim's predictable key first.
    const squat = await request(BOB, key, { kind: "clock_in" }, effects, "bob");
    expect(squat.status).toBe(201);

    // Alice, with the same key (and a different body), is NOT told 409 and
    // does NOT see Bob's response: she runs her own mutation.
    const victim = await request(
      ALICE,
      key,
      { kind: "clock_in", at: "08:00" },
      effects,
      "alice"
    );
    expect(victim.status).toBe(201);
    expect(victim.body.data.by).toBe("alice");
    expect(effects.count).toBe(2);
  });

  test("the same body from another actor is a fresh execution, never a replay of the first actor's response", async () => {
    const effects = { count: 0 };
    const key = "same-body-key";
    const first = await request(ALICE, key, { a: 1 }, effects, "alice");
    const second = await request(BOB, key, { a: 1 }, effects, "bob");

    expect(first.body.data.by).toBe("alice");
    expect(second.body.data.by).toBe("bob");
    expect(effects.count).toBe(2);
  });

  test("the same actor replaying a key gets the stored response and no second effect", async () => {
    const effects = { count: 0 };
    const key = "replay-key";
    const first = await request(ALICE, key, { a: 1 }, effects, "first");
    const replay = await request(ALICE, key, { a: 1 }, effects, "second");

    expect(replay.status).toBe(first.status);
    expect(replay.body).toEqual(first.body);
    expect(replay.body.data.by).toBe("first");
    expect(effects.count).toBe(1);
  });

  test("the same actor and key with a different body is 409 IDEMPOTENCY_CONFLICT", async () => {
    const effects = { count: 0 };
    const key = "conflict-key";
    await request(ALICE, key, { a: 1 }, effects);
    const conflict = await request(ALICE, key, { a: 2 }, effects);

    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(effects.count).toBe(1);
  });

  test("concurrent same-actor same-key same-body requests produce one effect and the same answer", async () => {
    const effects = { count: 0 };
    const key = "concurrent-key";
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(ALICE, key, { a: 1 }, effects, "winner")
      )
    );

    expect(effects.count).toBeGreaterThanOrEqual(1);
    for (const result of results) {
      expect(result.status).toBe(201);
      expect(result.body.data.by).toBe("winner");
    }

    // Exactly one stored row for that actor and key, whatever the interleaving.
    const rows = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_idempotency_keys
      WHERE tenant_id = ${TENANT} AND request_scope = ${SCOPE}
        AND idempotency_key = ${key}
    `) as { n: number }[];
    expect(rows[0]!.n).toBe(1);
  });

  test("concurrent different-actor same-key requests each get their own row and effect", async () => {
    const effects = { count: 0 };
    const key = "two-actors-concurrent";
    const [a, b] = await Promise.all([
      request(ALICE, key, { a: 1 }, effects, "alice"),
      request(BOB, key, { a: 1 }, effects, "bob")
    ]);

    expect(a.body.data.by).toBe("alice");
    expect(b.body.data.by).toBe("bob");
    expect(effects.count).toBe(2);
  });

  test("the stored request hash is a keyed HMAC, not the plain SHA-256 of the body", async () => {
    const effects = { count: 0 };
    const key = "hash-shape-key";
    const payload = { reason: "short secret" };
    await request(ALICE, key, payload, effects);

    const stored = await withTenant(pool, TENANT, (tx) =>
      findIdempotencyRecord(tx, TENANT, SCOPE, key, ALICE)
    );
    const plain = new Bun.CryptoHasher("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");

    expect((stored as { requestHash: string }).requestHash).toBe(
      computeRequestHash(payload)
    );
    expect((stored as { requestHash: string }).requestHash).not.toBe(plain);
  });

  test("anonymous and machine principals are their own namespaces", async () => {
    const effects = { count: 0 };
    const key = "principal-kinds";
    await request(ALICE, key, { a: 1 }, effects, "alice");

    const seen = await withTenant(pool, TENANT, async (tx) => ({
      anon: await findIdempotencyRecord(
        tx,
        TENANT,
        SCOPE,
        key,
        ANONYMOUS_IDEMPOTENCY_ACTOR
      ),
      machine: await findIdempotencyRecord(
        tx,
        TENANT,
        SCOPE,
        key,
        machineIdempotencyActor("m-1")
      )
    }));

    expect((seen as { anon: unknown }).anon).toBeNull();
    expect((seen as { machine: unknown }).machine).toBeNull();
  });

  async function seedLegacy(key: string, ageHours: number): Promise<void> {
    await getAdminSql()`
      INSERT INTO awcms_idempotency_keys
        (tenant_id, request_scope, actor_key, idempotency_key, request_hash, response_status, response_body, created_at)
      VALUES (${TENANT}, ${SCOPE}, ${LEGACY_UNSCOPED_IDEMPOTENCY_ACTOR}, ${key}, 'x', 200, '{"secret":"victim"}'::jsonb,
              now() - make_interval(hours => ${ageHours}))
    `;
  }

  test("a RECENT pre-migration row answers 409 for a same-key retry: no re-execution, no leak (deploy-straddle guard)", async () => {
    const key = "legacy-recent-key";
    await seedLegacy(key, 1);
    const effects = { count: 0 };
    const result = await request(BOB, key, { a: 1 }, effects, "bob");

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(JSON.stringify(result.body)).not.toContain("victim");
    expect(effects.count).toBe(0);
  });

  test("an OLD pre-migration row no longer blocks: the key is usable and the legacy body is never replayed", async () => {
    const key = "legacy-old-key";
    await seedLegacy(key, 48);
    const effects = { count: 0 };
    const result = await request(BOB, key, { a: 1 }, effects, "bob");

    expect(result.status).toBe(201);
    expect(result.body.data.by).toBe("bob");
    expect(JSON.stringify(result.body)).not.toContain("victim");
    expect(effects.count).toBe(1);
  });

  test("the straddle guard is per (scope, key): another key is unaffected", async () => {
    await seedLegacy("legacy-other-key", 1);
    const effects = { count: 0 };
    const result = await request(BOB, "unrelated-key", { a: 1 }, effects);

    expect(result.status).toBe(201);
    expect(effects.count).toBe(1);
  });

  test("the database refuses a row without a well-formed actor_key", async () => {
    const error = await assertRejected(
      getAdminSql()`
        INSERT INTO awcms_idempotency_keys
          (tenant_id, request_scope, actor_key, idempotency_key, request_hash, response_status, response_body)
        VALUES (${TENANT}, ${SCOPE}, 'someone', 'bad-actor', 'x', 200, '{}'::jsonb)
      `,
      "an idempotency row whose actor_key has no recognised shape"
    );
    expect(String(error.message)).toMatch(/actor_key_shape|check/i);
  });
});
