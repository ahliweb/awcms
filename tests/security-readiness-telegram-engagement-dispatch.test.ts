/**
 * `security:readiness` pins the customer Telegram dispatcher's role (sql/353,
 * Issue #1156, audit H-2 of PR #1260). Proven both ways against a migrated
 * database: it PASSES on the real schema, FAILS when the restrictive secret
 * policy is dropped or widened or a column grant drifts, and passes again once
 * the policy is restored from the migration's own text.
 *
 * Gated on `DATABASE_URL` (a database migrated through sql/353).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  checkTelegramEngagementDispatchRole,
  normalizeWorkerPolicyExpression,
  TELEGRAM_ENGAGEMENT_DISPATCH_COLUMN_GRANTS,
  TELEGRAM_ENGAGEMENT_DISPATCH_POLICIES,
  TELEGRAM_ENGAGEMENT_DISPATCH_POLICY
} from "../scripts/security-readiness";

const DATABASE_URL = process.env.DATABASE_URL;
const describeOrSkip = DATABASE_URL ? describe : describe.skip;

/** The CREATE POLICY statement exactly as sql/353 ships it. */
function policyFromMigration(): string {
  const source = readFileSync(
    "sql/353_awcms_telegram_engagement_dispatch_role.sql",
    "utf8"
  );
  const start = source.indexOf(
    `CREATE POLICY ${TELEGRAM_ENGAGEMENT_DISPATCH_POLICY}`
  );

  expect(start).toBeGreaterThan(0);

  return source.slice(start);
}

describeOrSkip("security:readiness — customer Telegram dispatcher role", () => {
  async function withAdmin<T>(work: (sql: Bun.SQL) => Promise<T>): Promise<T> {
    const sql = new Bun.SQL(DATABASE_URL!, { max: 1 });

    try {
      return await work(sql);
    } finally {
      await sql.close({ timeout: 1 });
    }
  }

  async function roleExists(): Promise<boolean> {
    return withAdmin(
      async (sql) =>
        (
          (await sql`
          SELECT 1 FROM pg_roles WHERE rolname = 'awcms_telegram_engagement_dispatch'
        `) as unknown[]
        ).length > 0
    );
  }

  test("the real schema passes", async () => {
    if (!(await roleExists())) return;

    const result = await checkTelegramEngagementDispatchRole();

    expect(result.status, result.evidence).toBe("pass");
  });

  test("a dropped policy fails, and restoring it from the migration passes again", async () => {
    if (!(await roleExists())) return;

    await withAdmin((sql) =>
      sql.unsafe(
        `DROP POLICY ${TELEGRAM_ENGAGEMENT_DISPATCH_POLICY} ON awcms_channel_secrets`
      )
    );

    try {
      const dropped = await checkTelegramEngagementDispatchRole();

      expect(dropped.status).toBe("fail");
      expect(dropped.evidence).toContain("is missing");
    } finally {
      await withAdmin((sql) => sql.unsafe(policyFromMigration()));
    }

    expect((await checkTelegramEngagementDispatchRole()).status).toBe("pass");
  });

  /**
   * The eleven widening mutations of the re-audit of PR #1260 (M-A), applied to
   * the migration's own text. A substring check let nine of them through; the
   * exact pin must turn every one red.
   */
  const MUTATIONS: Record<string, (text: string) => string> = {
    "M1 drop the account-secret correlation": (t) =>
      t.replace("AND a.secret_id = awcms_channel_secrets.id", ""),
    "M2 drop the endpoint-secret correlation": (t) =>
      t.replace("AND e.secret_id = awcms_channel_secrets.id", ""),
    "M3 true OR (...)": (t) => t.replace("USING (\n", "USING (true OR\n"),
    "M4 admit revoked and disabled accounts": (t) =>
      t.replaceAll(
        "a.status IN ('pending', 'connected', 'degraded')",
        "a.status IN ('pending', 'connected', 'degraded', 'revoked', 'disabled')"
      ),
    "M5 every purpose but bot_token": (t) =>
      t.replace("USING (\n", "USING (purpose <> 'bot_token' OR\n"),
    "M6 add oauth_pkce_verifier": (t) =>
      t.replace("USING (\n", "USING (purpose = 'oauth_pkce_verifier' OR\n"),
    "M7 drop the provider": (t) =>
      t.replace(
        "AND a.provider = 'telegram'\n          AND a.account_kind",
        "AND a.account_kind"
      ),
    "M8 admit revoked endpoints": (t) =>
      t.replace(
        "AND (e.state <> 'revoked' OR e.provider_action = 'delete')",
        "AND true"
      ),
    "M9 drop deleted_at in the seed branch": (t) =>
      t.replace(
        "AND a.deleted_at IS NULL\n          AND a.status IN ('pending', 'connected', 'degraded')\n      )\n    )\n  );",
        "AND a.status IN ('pending', 'connected', 'degraded')\n      )\n    )\n  );"
      ),
    "M10 drop the tenant correlation": (t) =>
      t.replace(
        "WHERE a.tenant_id = awcms_channel_secrets.tenant_id\n",
        "WHERE true\n"
      ),
    "M11 PERMISSIVE": (t) => t.replace("AS RESTRICTIVE", "AS PERMISSIVE")
  };

  test("every one of the eleven widening mutations fails the check", async () => {
    if (!(await roleExists())) return;

    const original = policyFromMigration();

    try {
      for (const [label, mutate] of Object.entries(MUTATIONS)) {
        const mutated = mutate(original);

        expect(mutated, label).not.toBe(original);

        await withAdmin(async (sql) => {
          await sql.unsafe(
            `DROP POLICY ${TELEGRAM_ENGAGEMENT_DISPATCH_POLICY} ON awcms_channel_secrets`
          );
          await sql.unsafe(mutated);
        });

        const result = await checkTelegramEngagementDispatchRole();

        expect(result.status, label).toBe("fail");
        expect(result.evidence, label).toContain(
          TELEGRAM_ENGAGEMENT_DISPATCH_POLICY
        );
      }
    } finally {
      await withAdmin(async (sql) => {
        await sql.unsafe(
          `DROP POLICY IF EXISTS ${TELEGRAM_ENGAGEMENT_DISPATCH_POLICY} ON awcms_channel_secrets`
        );
        await sql.unsafe(original);
      });
    }

    expect((await checkTelegramEngagementDispatchRole()).status).toBe("pass");
  });

  test("the behavioural probe alone catches a widening the pin is told to accept", async () => {
    if (!(await roleExists())) return;

    const original = policyFromMigration();
    const widened =
      MUTATIONS["M4 admit revoked and disabled accounts"]!(original);

    await withAdmin(async (sql) => {
      await sql.unsafe(
        `DROP POLICY ${TELEGRAM_ENGAGEMENT_DISPATCH_POLICY} ON awcms_channel_secrets`
      );
      await sql.unsafe(widened);
    });

    try {
      // Accept the widened text as the pin: only the probe can object now.
      const actual = await withAdmin(
        async (sql) =>
          (
            (await sql`
            SELECT pg_get_expr(polqual, polrelid) AS expr FROM pg_policy
            WHERE polname = ${TELEGRAM_ENGAGEMENT_DISPATCH_POLICY}
          `) as { expr: string }[]
          )[0]!.expr
      );
      const policies = TELEGRAM_ENGAGEMENT_DISPATCH_POLICIES.map((pin) =>
        pin.name === TELEGRAM_ENGAGEMENT_DISPATCH_POLICY
          ? { ...pin, using: normalizeWorkerPolicyExpression(actual) }
          : pin
      );
      const result = await checkTelegramEngagementDispatchRole({ policies });

      expect(result.status).toBe("fail");
      expect(result.evidence).toContain(
        "the dispatch role can read a disabled bot's token"
      );
      expect(result.evidence).not.toContain("differs from its pin");
    } finally {
      await withAdmin(async (sql) => {
        await sql.unsafe(
          `DROP POLICY IF EXISTS ${TELEGRAM_ENGAGEMENT_DISPATCH_POLICY} ON awcms_channel_secrets`
        );
        await sql.unsafe(original);
      });
    }

    expect((await checkTelegramEngagementDispatchRole()).status).toBe("pass");
  });

  test("dropping any write-bounding policy fails (pin AND probe)", async () => {
    if (!(await roleExists())) return;

    // sql/374 (the #1271 audit, M1) adds the event read-back policy.
    const source =
      readFileSync(
        "sql/353_awcms_telegram_engagement_dispatch_role.sql",
        "utf8"
      ) +
      readFileSync("sql/374_awcms_telegram_dispatch_outbox_bounds.sql", "utf8");

    for (const pin of TELEGRAM_ENGAGEMENT_DISPATCH_POLICIES) {
      if (pin.name === TELEGRAM_ENGAGEMENT_DISPATCH_POLICY) continue;

      const start = source.indexOf(`CREATE POLICY ${pin.name}`);
      const statement = source.slice(start, source.indexOf(");", start) + 2);

      expect(start, pin.name).toBeGreaterThan(0);

      await withAdmin((sql) =>
        sql.unsafe(`DROP POLICY ${pin.name} ON ${pin.table}`)
      );

      try {
        const result = await checkTelegramEngagementDispatchRole();

        expect(result.status, pin.name).toBe("fail");
        expect(result.evidence, pin.name).toContain(
          `${pin.name} (TO awcms_telegram_engagement_dispatch) is missing`
        );
      } finally {
        await withAdmin((sql) => sql.unsafe(statement));
      }
    }

    expect((await checkTelegramEngagementDispatchRole()).status).toBe("pass");
  });

  test("a column grant that drifts from the pinned list fails", async () => {
    if (!(await roleExists())) return;

    const narrower = structuredClone(
      TELEGRAM_ENGAGEMENT_DISPATCH_COLUMN_GRANTS
    );

    narrower.awcms_channel_secrets = { SELECT: ["id", "tenant_id", "purpose"] };

    const result = await checkTelegramEngagementDispatchRole({
      columns: narrower
    });

    expect(result.status).toBe("fail");
    expect(result.evidence).toContain(
      "over-granted: SELECT on awcms_channel_secrets(ciphertext)"
    );
  });
});
