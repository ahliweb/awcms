/**
 * Issue #1405, ADR-0168 slice S2 — the schema and domain changes that come
 * BEFORE any passkey surface:
 *
 * - A1 (`sql/442`): recovery codes are owned by the PRINCIPAL and independent
 *   of factor type. The migration keeps exactly the codes that were spendable
 *   before it ran, and nothing else.
 * - A2 (`sql/443`): every session records how it reached `aal2`; a handoff code
 *   snapshots it; no row can claim a passkey step-up while no credential table
 *   exists; `origin_auth` admits `passkey` (Q7).
 *
 * Every application-level assertion runs as the real least-privilege
 * `awcms_app` login (`getAppRoleSql`), never as a superuser. The two migration
 * replays run the REAL files from disk as the NON-SUPERUSER, NOBYPASSRLS table
 * owner (`getOwnerSql`), the only posture in which `sql/443`'s `NO FORCE`
 * toggle is what makes the backfill see rows at all.
 *
 * MUTATION PROOFS (each was applied, observed RED, and reverted):
 * - `sql/442`: delete the DELETE step -> the replay keeps the dead codes ->
 *   "keeps exactly the codes" RED.
 * - `sql/442`: drop `f.status = 'active'` from the DELETE -> the disabled and
 *   pending factors' codes survive -> same test RED.
 * - `consumeRecoveryCode`: drop the `EXISTS (... status = 'active')` guard ->
 *   a principal with no factor spends a code -> "refused once no factor" RED.
 * - `replaceRecoveryCodes`: drop the delete-first -> regenerate leaves the old
 *   set spendable -> "regenerate replaces" RED.
 * - `sql/443`: delete the `NO FORCE` toggle around the sessions UPDATE -> the
 *   owner's backfill errors/sees nothing and the CHECK refuses the populated
 *   table -> "sql/443 backfill" RED.
 * - `sql/443`: delete `awcms_sessions_passkey_step_up_unavailable` -> a passkey
 *   step-up with an arbitrary id is stored -> "no passkey step-up" RED.
 * - `stepUpSession`: drop `stepped_up_method` from the refresh UPDATE -> the
 *   refreshed session keeps claiming the old method -> "refresh replaces" RED.
 */
import { readFileSync } from "node:fs";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  appRoleActivated,
  getAdminSql,
  getAppRoleSql,
  getOwnerSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  generateSessionToken,
  hashSessionToken
} from "../../src/lib/auth/session-token";
import { hashRecoveryCode } from "../../src/lib/auth/mfa-recovery-code";
import { linkIdentityToPrincipal } from "../../src/modules/identity-access/application/principal-store";
import {
  consumeRecoveryCode,
  disableLiveFactors
} from "../../src/modules/identity-access/application/principal-mfa-store";
import {
  disableMfa,
  regenerateRecoveryCodes
} from "../../src/modules/identity-access/application/mfa";
import {
  createSessionWithAssurance,
  resolveSessionAssurance,
  stepUpSession
} from "../../src/modules/identity-access/application/mfa-session-assurance";

const TENANT = "d1405000-0000-4000-8000-000000000001";
const OTHER_TENANT = "d1405000-0000-4000-8000-000000000002";

const describeIt = integrationEnabled ? describe : describe.skip;

type Person = { identityId: string; principalId: string; login: string };

async function seedTenant(tenantId: string, code: string): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${tenantId}, ${code}, ${code})
  `;
}

async function seedPerson(tenantId: string, login: string): Promise<Person> {
  const admin = getAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${login})
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${login}, 'x')
    RETURNING id
  `) as { id: string }[];
  const identityId = identity[0]!.id;

  const principalId = await withTenantOrThrow(app(), tenantId, (tx) =>
    linkIdentityToPrincipal(tx, identityId, login)
  );

  return { identityId, principalId, login };
}

async function seedFactor(
  principalId: string,
  status: "active" | "pending" | "disabled"
): Promise<string> {
  const rows = (await getAdminSql()`
    INSERT INTO awcms_principal_mfa_factors
      (principal_id, factor_type, secret_ciphertext, status, activated_at, disabled_at)
    VALUES (${principalId}, 'totp', 'ciphertext-not-used', ${status},
            ${status === "pending" ? null : new Date()},
            ${status === "disabled" ? new Date() : null})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function seedCode(principalId: string, raw: string): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_principal_mfa_recovery_codes (principal_id, code_hash)
    VALUES (${principalId}, ${hashRecoveryCode(raw)})
  `;
}

function app(): Bun.SQL {
  return getAppRoleSql();
}

async function spend(person: Person, raw: string): Promise<boolean> {
  return withTenantOrThrow(app(), TENANT, (tx) =>
    consumeRecoveryCode(
      tx,
      person.principalId,
      hashRecoveryCode(raw),
      new Date()
    )
  );
}

/** Runs a real migration file as the non-superuser, NOBYPASSRLS owner. */
async function replayAsOwner(file: string): Promise<void> {
  const text = readFileSync(file, "utf8");
  const reserved = await getOwnerSql().reserve();
  try {
    await reserved.unsafe(text);
  } finally {
    reserved.release();
  }
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = (await getAdminSql()`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = ${table} AND column_name = ${column}
  `) as unknown[];

  return rows.length > 0;
}

async function insertSessionAsApp(values: {
  identityId: string;
  assuranceLevel: string;
  method: string | null;
  passkeyId?: string | null;
  originAuth?: string;
}): Promise<void> {
  await withTenantOrThrow(app(), TENANT, async (tx) => {
    await tx`
      INSERT INTO awcms_sessions
        (tenant_id, identity_id, token_hash, expires_at, assurance_level,
         stepped_up_at, stepped_up_method, stepped_up_passkey_id, origin_auth)
      VALUES (${TENANT}, ${values.identityId},
              ${hashSessionToken(generateSessionToken())},
              now() + interval '1 hour', ${values.assuranceLevel},
              ${values.assuranceLevel === "aal2" ? new Date() : null},
              ${values.method}, ${values.passkeyId ?? null},
              ${values.originAuth ?? "password"})
    `;
  });
}

/**
 * The constraint that refused the write, or `null` when it was accepted.
 * Asserting the NAME rather than "it threw" keeps an unrelated failure (an FK,
 * a missing tenant context) from passing as the control under test.
 */
async function refusedBy(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    const match = /constraint "([^"]+)"/.exec(String(error));
    return match ? match[1]! : `unexpected: ${String(error)}`;
  }
}

describeIt(
  "ADR-0168 S2 — principal-owned recovery codes and step-up method",
  () => {
    beforeAll(async () => {
      await setupIntegrationDatabase();
    });

    afterAll(async () => {
      await teardownIntegrationDatabase();
    });

    beforeEach(async () => {
      await resetDatabase();
      await seedTenant(TENANT, "s2-passkey");
      await seedTenant(OTHER_TENANT, "s2-passkey-other");
    });

    // ---- A1 ------------------------------------------------------------------

    test("A1: a code is the principal's — no factor column, and removing the factor row does not cascade to it", async () => {
      expect(appRoleActivated).toBe(true);
      expect(
        await columnExists("awcms_principal_mfa_recovery_codes", "factor_id")
      ).toBe(false);

      const person = await seedPerson(TENANT, "a1-cascade@example.test");
      const factorId = await seedFactor(person.principalId, "active");
      await seedCode(person.principalId, "AAAA-0001");

      // A hard delete of the issuing factor is what `ON DELETE CASCADE` used to
      // turn into "every recovery code gone".
      await getAdminSql()`
      DELETE FROM awcms_principal_mfa_factors WHERE id = ${factorId}
    `;

      const left = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_principal_mfa_recovery_codes
      WHERE principal_id = ${person.principalId}
    `) as { n: number }[];
      expect(left[0]!.n).toBe(1);
    });

    test("A1: a code is spendable while the principal has an active factor, and refused once none is left", async () => {
      const person = await seedPerson(TENANT, "a1-live@example.test");
      await seedFactor(person.principalId, "active");
      await seedCode(person.principalId, "AAAA-0002");
      await seedCode(person.principalId, "AAAA-0003");

      expect(await spend(person, "AAAA-0002")).toBe(true);
      // Single use.
      expect(await spend(person, "AAAA-0002")).toBe(false);

      await withTenantOrThrow(app(), TENANT, (tx) =>
        disableLiveFactors(tx, person.principalId, new Date(), null)
      );

      // The code still EXISTS (nothing cascaded), yet it is refused: a person
      // with no second factor has nothing a recovery code may stand in for.
      expect(await spend(person, "AAAA-0003")).toBe(false);
    });

    test("A1: a code of one principal is never spendable by another", async () => {
      const owner = await seedPerson(TENANT, "a1-owner@example.test");
      const other = await seedPerson(TENANT, "a1-other@example.test");
      await seedFactor(owner.principalId, "active");
      await seedFactor(other.principalId, "active");
      await seedCode(owner.principalId, "AAAA-0004");

      expect(await spend(other, "AAAA-0004")).toBe(false);
      expect(await spend(owner, "AAAA-0004")).toBe(true);
    });

    test("A1: regenerate replaces the principal's whole set — the old codes die", async () => {
      const person = await seedPerson(TENANT, "a1-regen@example.test");
      await seedFactor(person.principalId, "active");
      await seedCode(person.principalId, "AAAA-0005");

      const result = await withTenantOrThrow(app(), TENANT, (tx) =>
        regenerateRecoveryCodes(tx, TENANT, person.identityId)
      );
      expect(result.ok).toBe(true);
      const fresh = result.ok ? result.recoveryCodes : [];
      expect(fresh).toHaveLength(10);

      expect(await spend(person, "AAAA-0005")).toBe(false);
      expect(await spend(person, fresh[0]!)).toBe(true);

      const count = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_principal_mfa_recovery_codes
      WHERE principal_id = ${person.principalId}
    `) as { n: number }[];
      expect(count[0]!.n).toBe(10);
    });

    test("A1: self-service disable leaves the principal with no factor, so the codes go too", async () => {
      const person = await seedPerson(TENANT, "a1-disable@example.test");
      await seedFactor(person.principalId, "active");
      await seedCode(person.principalId, "AAAA-0006");

      const result = await withTenantOrThrow(app(), TENANT, (tx) =>
        disableMfa(tx, TENANT, person.identityId, new Date())
      );
      expect(result.ok).toBe(true);

      const count = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_principal_mfa_recovery_codes
      WHERE principal_id = ${person.principalId}
    `) as { n: number }[];
      expect(count[0]!.n).toBe(0);
    });

    // ---- A2 ------------------------------------------------------------------

    test("A2: as awcms_app, an aal2 session cannot be stored without a method, nor an aal1 with one", async () => {
      const person = await seedPerson(TENANT, "a2-check@example.test");

      expect(
        await refusedBy(() =>
          insertSessionAsApp({
            identityId: person.identityId,
            assuranceLevel: "aal2",
            method: null
          })
        )
      ).toBe("awcms_sessions_stepped_up_method_level_check");
      expect(
        await refusedBy(() =>
          insertSessionAsApp({
            identityId: person.identityId,
            assuranceLevel: "aal1",
            method: "totp"
          })
        )
      ).toBe("awcms_sessions_stepped_up_method_level_check");
      expect(
        await refusedBy(() =>
          insertSessionAsApp({
            identityId: person.identityId,
            assuranceLevel: "aal2",
            method: "sms"
          })
        )
      ).toBe("awcms_sessions_stepped_up_method_check");
      // A credential id without the passkey method is meaningless.
      expect(
        await refusedBy(() =>
          insertSessionAsApp({
            identityId: person.identityId,
            assuranceLevel: "aal2",
            method: "recovery_code",
            passkeyId: crypto.randomUUID()
          })
        )
      ).toBe("awcms_sessions_stepped_up_passkey_id_check");

      // The legitimate shapes are accepted.
      await insertSessionAsApp({
        identityId: person.identityId,
        assuranceLevel: "aal2",
        method: "recovery_code"
      });
      await insertSessionAsApp({
        identityId: person.identityId,
        assuranceLevel: "aal1",
        method: null
      });
    });

    test("A2: no passkey step-up can be stored while no credential table exists, even with an id", async () => {
      const person = await seedPerson(TENANT, "a2-passkey@example.test");

      expect(
        await refusedBy(() =>
          insertSessionAsApp({
            identityId: person.identityId,
            assuranceLevel: "aal2",
            method: "passkey",
            passkeyId: crypto.randomUUID()
          })
        )
      ).toBe("awcms_sessions_passkey_step_up_unavailable");
    });

    test("Q7: origin_auth admits `passkey` and still refuses an unknown value", async () => {
      const person = await seedPerson(TENANT, "q7-origin@example.test");

      await insertSessionAsApp({
        identityId: person.identityId,
        assuranceLevel: "aal1",
        method: null,
        originAuth: "passkey"
      });
      expect(
        await refusedBy(() =>
          insertSessionAsApp({
            identityId: person.identityId,
            assuranceLevel: "aal1",
            method: null,
            originAuth: "webauthn"
          })
        )
      ).toBe("awcms_sessions_origin_auth_check");
    });

    test("A2: a rotation records the proof that raised it, and a refresh REPLACES the method", async () => {
      const person = await seedPerson(TENANT, "a2-rotate@example.test");
      const now = new Date();

      const aal1 = await withTenantOrThrow(app(), TENANT, (tx) =>
        createSessionWithAssurance(tx, {
          tenantId: TENANT,
          identityId: person.identityId,
          assurance: { level: "aal1" },
          ttlMin: 60,
          now,
          issue: { originAuth: "password" }
        })
      );

      const rotated = await withTenantOrThrow(app(), TENANT, async (tx) => {
        const session = await resolveSessionAssurance(
          tx,
          TENANT,
          hashSessionToken(aal1.token),
          now
        );
        expect(session!.steppedUpBy).toBeNull();

        return stepUpSession(tx, {
          tenantId: TENANT,
          session: session!,
          proof: { method: "recovery_code" },
          ttlMin: 60,
          now
        });
      });
      expect(rotated.rotated).toBe(true);
      const token = rotated.rotated ? rotated.token : "";

      const afterRotate = await withTenantOrThrow(app(), TENANT, (tx) =>
        resolveSessionAssurance(tx, TENANT, hashSessionToken(token), now)
      );
      expect(afterRotate!.assuranceLevel).toBe("aal2");
      expect(afterRotate!.steppedUpBy).toEqual({ method: "recovery_code" });

      const refreshed = await withTenantOrThrow(app(), TENANT, (tx) =>
        stepUpSession(tx, {
          tenantId: TENANT,
          session: afterRotate!,
          proof: { method: "totp" },
          ttlMin: 60,
          now
        })
      );
      expect(refreshed.rotated).toBe(false);

      const afterRefresh = await withTenantOrThrow(app(), TENANT, (tx) =>
        resolveSessionAssurance(tx, TENANT, hashSessionToken(token), now)
      );
      expect(afterRefresh!.steppedUpBy).toEqual({ method: "totp" });
    });

    // ---- Migration replays (run LAST: they rebuild the schema in place) -------

    test("sql/442 replay keeps exactly the codes that were spendable before it, used_at included", async () => {
      const admin = getAdminSql();
      // Restore the pre-442 shape: the factor column and its cascade.
      await admin`
      ALTER TABLE awcms_principal_mfa_recovery_codes
        ADD COLUMN factor_id uuid
        REFERENCES awcms_principal_mfa_factors (id) ON DELETE CASCADE
    `;

      const live = await seedPerson(TENANT, "r442-live@example.test");
      const pending = await seedPerson(TENANT, "r442-pending@example.test");
      const foreign = await seedPerson(TENANT, "r442-foreign@example.test");

      const activeF = await seedFactor(live.principalId, "active");
      const disabledF = await seedFactor(live.principalId, "disabled");
      const pendingF = await seedFactor(pending.principalId, "pending");
      const foreignF = await seedFactor(foreign.principalId, "active");

      const seed = async (
        principalId: string,
        factorId: string,
        raw: string,
        used: boolean
      ) => admin`
      INSERT INTO awcms_principal_mfa_recovery_codes
        (principal_id, factor_id, code_hash, used_at)
      VALUES (${principalId}, ${factorId}, ${hashRecoveryCode(raw)},
              ${used ? new Date() : null})
    `;

      await seed(live.principalId, activeF, "KEEP-UNUSED", false);
      await seed(live.principalId, activeF, "KEEP-SPENT", true);
      await seed(live.principalId, disabledF, "DEAD-DISABLED", false);
      await seed(pending.principalId, pendingF, "DEAD-PENDING", false);
      // A code whose factor belongs to SOMEBODY ELSE — never spendable, because
      // the factor id handed to the old `consumeRecoveryCode` always came from
      // the code owner's own active factor.
      await seed(live.principalId, foreignF, "DEAD-FOREIGN", false);

      await replayAsOwner(
        "sql/442_awcms_principal_recovery_codes_factor_independent.sql"
      );

      expect(
        await columnExists("awcms_principal_mfa_recovery_codes", "factor_id")
      ).toBe(false);

      const rows = (await admin`
      SELECT code_hash, used_at IS NOT NULL AS spent
      FROM awcms_principal_mfa_recovery_codes
      ORDER BY spent
    `) as { code_hash: string; spent: boolean }[];

      expect(rows).toEqual([
        { code_hash: hashRecoveryCode("KEEP-UNUSED"), spent: false },
        { code_hash: hashRecoveryCode("KEEP-SPENT"), spent: true }
      ]);

      // And the kept code works through the new reader, while the spent one is
      // not revived.
      expect(await spend(live, "KEEP-UNUSED")).toBe(true);
      expect(await spend(live, "KEEP-SPENT")).toBe(false);
    });

    test("sql/443 replay as the NOBYPASSRLS owner backfills live aal2 rows in every tenant", async () => {
      const admin = getAdminSql();
      const a = await seedPerson(TENANT, "r443-a@example.test");
      const b = await seedPerson(OTHER_TENANT, "r443-b@example.test");

      // Undo sql/443 so the real file can run against pre-443 rows.
      await admin.unsafe(`
      ALTER TABLE awcms_sessions
        DROP CONSTRAINT awcms_sessions_stepped_up_method_check,
        DROP CONSTRAINT awcms_sessions_stepped_up_method_level_check,
        DROP CONSTRAINT awcms_sessions_stepped_up_passkey_id_check,
        DROP CONSTRAINT awcms_sessions_passkey_step_up_unavailable,
        DROP COLUMN stepped_up_method,
        DROP COLUMN stepped_up_passkey_id,
        DROP CONSTRAINT awcms_sessions_origin_auth_check;
      ALTER TABLE awcms_sessions ADD CONSTRAINT awcms_sessions_origin_auth_check
        CHECK (origin_auth IN ('password', 'sso', 'handoff', 'switch', 'delegated'));
      ALTER TABLE awcms_session_handoff_codes
        DROP CONSTRAINT awcms_session_handoff_codes_stepped_up_method_check,
        DROP CONSTRAINT awcms_session_handoff_codes_stepped_up_method_level_check,
        DROP CONSTRAINT awcms_session_handoff_codes_stepped_up_passkey_id_check,
        DROP CONSTRAINT awcms_session_handoff_codes_passkey_step_up_unavailable,
        DROP COLUMN stepped_up_method,
        DROP COLUMN stepped_up_passkey_id;
    `);

      for (const [tenantId, person, level] of [
        [TENANT, a, "aal2"],
        [TENANT, a, "aal1"],
        [OTHER_TENANT, b, "aal2"]
      ] as const) {
        await admin`
        INSERT INTO awcms_sessions
          (tenant_id, identity_id, token_hash, expires_at, assurance_level, stepped_up_at)
        VALUES (${tenantId}, ${person.identityId},
                ${hashSessionToken(generateSessionToken())},
                now() + interval '1 hour', ${level},
                ${level === "aal2" ? new Date() : null})
      `;
      }

      await replayAsOwner("sql/443_awcms_session_step_up_method.sql");

      const rows = (await admin`
      SELECT tenant_id, assurance_level, stepped_up_method, stepped_up_passkey_id
      FROM awcms_sessions
      ORDER BY tenant_id, assurance_level
    `) as {
        tenant_id: string;
        assurance_level: string;
        stepped_up_method: string | null;
        stepped_up_passkey_id: string | null;
      }[];

      expect(rows).toEqual([
        {
          tenant_id: TENANT,
          assurance_level: "aal1",
          stepped_up_method: null,
          stepped_up_passkey_id: null
        },
        {
          tenant_id: TENANT,
          assurance_level: "aal2",
          stepped_up_method: "recovery_code",
          stepped_up_passkey_id: null
        },
        {
          tenant_id: OTHER_TENANT,
          assurance_level: "aal2",
          stepped_up_method: "recovery_code",
          stepped_up_passkey_id: null
        }
      ]);

      // FORCE is back on after the toggle — the backfill did not leave the
      // table open.
      const force = (await admin`
      SELECT relname, relforcerowsecurity FROM pg_class
      WHERE relname IN ('awcms_sessions', 'awcms_session_handoff_codes')
      ORDER BY relname
    `) as { relname: string; relforcerowsecurity: boolean }[];
      expect(force.every((r) => r.relforcerowsecurity)).toBe(true);
      expect(force).toHaveLength(2);
    });
  }
);
