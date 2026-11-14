/**
 * Issue #1279 (audit of #1274, X3 and X4). The full `security:readiness` run
 * stayed green for `GRANT CREATE ON SCHEMA public TO awcms_social_dispatch` and
 * for `ALTER POLICY awcms_blog_posts_tenant_isolation ... USING (true)`. These
 * tests mutate a migrated database (restoring it in `finally`) and prove both
 * checks go RED for the mutation and GREEN on the clean schema, including when
 * the checking connection is a real least-privilege LOGIN role.
 *
 * Gated on `DATABASE_URL` (a migrated database reached as a superuser).
 */
import { describe, expect, test } from "bun:test";

import {
  checkNoRestrictedSchemaCreate,
  checkTenantIsolationPoliciesCanonical,
  DEFINER_OWNER_ROLES
} from "../scripts/security-readiness";
import {
  CANONICAL_TENANT_ISOLATION_EXPRESSIONS,
  evaluateTenantIsolationPolicies,
  findRestrictedCreatePrivileges,
  findTenantIsolationPolicyDrift,
  probeTenantIsolationUnderDefinerRead,
  REVIEWED_PERMISSIVE_POLICIES
} from "../scripts/lib/schema-create-and-tenant-policy-readiness";

const DATABASE_URL = process.env.DATABASE_URL;
const describeOrSkip = DATABASE_URL ? describe : describe.skip;

type PolicyRow = Parameters<typeof evaluateTenantIsolationPolicies>[1][number];

describe("evaluateTenantIsolationPolicies (pure)", () => {
  const canonical = CANONICAL_TENANT_ISOLATION_EXPRESSIONS[0]!;
  const row = (over: Partial<PolicyRow> = {}): PolicyRow => ({
    relname: "awcms_x",
    polname: "awcms_x_tenant_isolation",
    polcmd: "*",
    roles: ["PUBLIC"],
    using: canonical,
    with_check: null,
    ...over
  });

  test("the canonical policy passes", () => {
    expect(evaluateTenantIsolationPolicies(["awcms_x"], [row()], [])).toEqual(
      []
    );
  });

  test("every widening is a finding", () => {
    for (const over of [
      { using: "true" },
      { using: `(${canonical} OR true)` },
      { using: "(tenant_id IS NOT NULL)" },
      { using: null },
      { with_check: "true" },
      { polcmd: "r" },
      { roles: ["awcms_app"] }
    ] as Partial<PolicyRow>[]) {
      const findings = evaluateTenantIsolationPolicies(
        ["awcms_x"],
        [row(over)],
        []
      );

      expect(findings.length).toBe(1);
      expect(findings[0]).toContain("awcms_x.awcms_x_tenant_isolation");
    }
  });

  test("a missing isolation policy and an unreviewed second permissive policy are findings", () => {
    expect(evaluateTenantIsolationPolicies(["awcms_x"], [], [])[0]).toContain(
      "awcms_x has no *_tenant_isolation policy"
    );
    expect(
      evaluateTenantIsolationPolicies(
        ["awcms_x"],
        [row(), row({ polname: "awcms_x_open", using: "true" })],
        []
      )[0]
    ).toContain("not a reviewed exception");
  });

  test("a reviewed exception must match exactly, and a vanished one is reported", () => {
    const pinned = {
      table: "awcms_x",
      policy: "awcms_x_sweep",
      command: "r" as const,
      roles: ["awcms_sweeper"],
      using: "true",
      withCheck: null
    };
    const sweep = row({
      polname: "awcms_x_sweep",
      polcmd: "r",
      roles: ["awcms_sweeper"],
      using: "true"
    });

    expect(
      evaluateTenantIsolationPolicies(["awcms_x"], [row(), sweep], [pinned])
    ).toEqual([]);
    expect(
      evaluateTenantIsolationPolicies(
        ["awcms_x"],
        [row(), { ...sweep, roles: ["PUBLIC"] }],
        [pinned]
      )[0]
    ).toContain("drifted");
    expect(
      evaluateTenantIsolationPolicies(["awcms_x"], [row()], [pinned])[0]
    ).toContain("no longer exists");
  });
});

describeOrSkip(
  "security:readiness — schema CREATE and tenant isolation (database)",
  () => {
    async function withAdmin<T>(
      work: (sql: Bun.SQL) => Promise<T>
    ): Promise<T> {
      const sql = new Bun.SQL(DATABASE_URL!, { max: 1 });

      try {
        return await work(sql);
      } finally {
        await sql.close({ timeout: 1 });
      }
    }

    async function mutated(
      apply: string,
      undo: string,
      run: () => Promise<void>
    ): Promise<void> {
      await withAdmin((sql) => sql.unsafe(apply));
      try {
        await run();
      } finally {
        await withAdmin((sql) => sql.unsafe(undo));
      }
    }

    test("the clean schema passes both checks", async () => {
      const create = await checkNoRestrictedSchemaCreate();
      const policies = await checkTenantIsolationPoliciesCanonical();

      expect(create.status).toBe("pass");
      expect(policies.evidence).toContain("FORCE-RLS table(s)");
      expect(policies.status).toBe("pass");
    });

    test("every reviewed exception exists in the migrated schema", async () => {
      const { findings } = await withAdmin(findTenantIsolationPolicyDrift);

      expect(findings).toEqual([]);
      expect(REVIEWED_PERMISSIVE_POLICIES.length).toBeGreaterThan(0);
    });

    test("X3: CREATE on the schema for a dedicated role fails and names the role", async () => {
      await mutated(
        "GRANT CREATE ON SCHEMA public TO awcms_social_dispatch",
        "REVOKE CREATE ON SCHEMA public FROM awcms_social_dispatch",
        async () => {
          const result = await checkNoRestrictedSchemaCreate();

          expect(result.status).toBe("fail");
          expect(result.evidence).toContain("awcms_social_dispatch");
        }
      );
      expect((await checkNoRestrictedSchemaCreate()).status).toBe("pass");
    });

    test("X3: PUBLIC, a definer owner, the runtime role and a database-level CREATE all fail", async () => {
      const db = (await withAdmin(
        (sql) => sql`SELECT current_database() AS d`
      )) as { d: string }[];
      const database = `"${db[0]!.d}"`;

      for (const [apply, undo, who] of [
        [
          "GRANT CREATE ON SCHEMA public TO PUBLIC",
          "REVOKE CREATE ON SCHEMA public FROM PUBLIC",
          "PUBLIC"
        ],
        [
          "GRANT CREATE ON SCHEMA public TO awcms_social_source_check",
          "REVOKE CREATE ON SCHEMA public FROM awcms_social_source_check",
          "awcms_social_source_check"
        ],
        [
          "GRANT CREATE ON SCHEMA public TO awcms_app",
          "REVOKE CREATE ON SCHEMA public FROM awcms_app",
          "awcms_app"
        ],
        [
          `GRANT CREATE ON DATABASE ${database} TO awcms_worker`,
          `REVOKE CREATE ON DATABASE ${database} FROM awcms_worker`,
          "awcms_worker"
        ]
      ] as const) {
        await mutated(apply, undo, async () => {
          const findings = await withAdmin((sql) =>
            findRestrictedCreatePrivileges(sql, DEFINER_OWNER_ROLES)
          );

          expect(findings.join(" | ")).toContain(who);
        });
      }
    });

    test("X3: CREATE reached through a role membership fails", async () => {
      await withAdmin((sql) =>
        sql.unsafe(`
          CREATE ROLE awcms_rdy_creator NOLOGIN;
          GRANT CREATE ON SCHEMA public TO awcms_rdy_creator;
          GRANT awcms_rdy_creator TO awcms_worker;
        `)
      );
      try {
        const findings = await withAdmin((sql) =>
          findRestrictedCreatePrivileges(sql, DEFINER_OWNER_ROLES)
        );

        expect(findings.join(" | ")).toContain(
          "awcms_worker can CREATE on schema public (directly or through a membership)"
        );
      } finally {
        await withAdmin((sql) =>
          sql.unsafe(`
            REVOKE awcms_rdy_creator FROM awcms_worker;
            REVOKE CREATE ON SCHEMA public FROM awcms_rdy_creator;
            DROP ROLE awcms_rdy_creator;
          `)
        );
      }
    });

    async function restoreStatement(): Promise<string> {
      const rows = (await withAdmin(
        (sql) => sql`
          SELECT pg_get_expr(polqual, polrelid) AS using,
                 pg_get_expr(polwithcheck, polrelid) AS chk
          FROM pg_policy WHERE polname = 'awcms_blog_posts_tenant_isolation'
        `
      )) as { using: string; chk: string | null }[];
      const original = rows[0]!;

      // ALTER POLICY cannot clear a WITH CHECK, so restore by recreating.
      return `DROP POLICY awcms_blog_posts_tenant_isolation ON awcms_blog_posts; CREATE POLICY awcms_blog_posts_tenant_isolation ON awcms_blog_posts USING (${original.using})${original.chk ? ` WITH CHECK (${original.chk})` : ""}`;
    }

    test("X4: USING (true) on the blog posts isolation policy fails the pin AND the probe, naming the policy", async () => {
      const restore = await restoreStatement();

      await mutated(
        "ALTER POLICY awcms_blog_posts_tenant_isolation ON awcms_blog_posts USING (true)",
        restore,
        async () => {
          const result = await checkTenantIsolationPoliciesCanonical();

          expect(result.status).toBe("fail");
          expect(result.evidence).toContain(
            "awcms_blog_posts_tenant_isolation"
          );

          // The probe alone, with the pin out of the picture.
          const probe = await withAdmin((sql) =>
            probeTenantIsolationUnderDefinerRead(sql, [
              "awcms_app",
              "awcms_social_source_check"
            ])
          );

          expect(probe.ran).toBe(true);
          expect(probe.findings.join(" | ")).toContain(
            "reads ANOTHER tenant's awcms_blog_posts row"
          );
        }
      );
      expect((await checkTenantIsolationPoliciesCanonical()).status).toBe(
        "pass"
      );
    });

    test("X4: a dropped correlation, a `true OR`, a loosened WITH CHECK and an extra permissive policy all fail", async () => {
      const restore = await restoreStatement();
      const using = (
        (await withAdmin(
          (sql) => sql`
            SELECT pg_get_expr(polqual, polrelid) AS using
            FROM pg_policy WHERE polname = 'awcms_blog_posts_tenant_isolation'
          `
        )) as { using: string }[]
      )[0]!.using;

      for (const apply of [
        "ALTER POLICY awcms_blog_posts_tenant_isolation ON awcms_blog_posts USING (tenant_id IS NOT NULL)",
        `ALTER POLICY awcms_blog_posts_tenant_isolation ON awcms_blog_posts USING (true OR ${using})`,
        `ALTER POLICY awcms_blog_posts_tenant_isolation ON awcms_blog_posts USING (${using}) WITH CHECK (true)`
      ]) {
        await mutated(apply, restore, async () => {
          const result = await checkTenantIsolationPoliciesCanonical();

          expect(result.status).toBe("fail");
          expect(result.evidence).toContain(
            "awcms_blog_posts_tenant_isolation"
          );
        });
      }

      await mutated(
        "CREATE POLICY awcms_blog_posts_open ON awcms_blog_posts FOR SELECT TO awcms_app USING (true)",
        "DROP POLICY awcms_blog_posts_open ON awcms_blog_posts",
        async () => {
          const result = await checkTenantIsolationPoliciesCanonical();

          expect(result.status).toBe("fail");
          expect(result.evidence).toContain("awcms_blog_posts_open");
        }
      );
      expect((await checkTenantIsolationPoliciesCanonical()).status).toBe(
        "pass"
      );
    });

    test("X4: a reviewed role-scoped policy widened to PUBLIC fails", async () => {
      await mutated(
        "ALTER POLICY awcms_sessions_delegated_expiry_sweep ON awcms_sessions TO PUBLIC",
        "ALTER POLICY awcms_sessions_delegated_expiry_sweep ON awcms_sessions TO awcms_delegated_expiry",
        async () => {
          const result = await checkTenantIsolationPoliciesCanonical();

          expect(result.status).toBe("fail");
          expect(result.evidence).toContain(
            "awcms_sessions_delegated_expiry_sweep"
          );
        }
      );
    });

    test("a real least-privilege LOGIN role sees no false positive", async () => {
      await withAdmin((sql) =>
        sql.unsafe(
          "CREATE ROLE awcms_rdy_probe LOGIN PASSWORD 'rdy_probe_pw' IN ROLE awcms_app"
        )
      );
      try {
        const url = new URL(DATABASE_URL!);

        url.username = "awcms_rdy_probe";
        url.password = "rdy_probe_pw";

        const sql = new Bun.SQL(url.toString(), { max: 1 });

        try {
          const who = (await sql`
            SELECT current_user AS u, rolsuper FROM pg_roles WHERE rolname = current_user
          `) as { u: string; rolsuper: boolean }[];

          expect(who[0]).toEqual({ u: "awcms_rdy_probe", rolsuper: false });
          expect(
            await findRestrictedCreatePrivileges(sql, DEFINER_OWNER_ROLES)
          ).toEqual([]);
          expect((await findTenantIsolationPolicyDrift(sql)).findings).toEqual(
            []
          );
          expect(
            await probeTenantIsolationUnderDefinerRead(sql, ["awcms_app"])
          ).toEqual({ ran: false, findings: [] });
        } finally {
          await sql.close({ timeout: 1 });
        }
      } finally {
        await withAdmin((sql) => sql.unsafe("DROP ROLE awcms_rdy_probe"));
      }
    });
  }
);
