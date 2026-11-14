/**
 * Issue #1347 (follow-up of #1279). `security:readiness` had no check for views:
 * every earlier check read `relkind IN ('r', 'p')`. A view owned by a superuser
 * or BYPASSRLS role over a FORCE-RLS table is read without RLS by whoever holds
 * SELECT on it. These tests mutate a migrated database (restoring it in
 * `finally`) and prove the check goes RED for the mutation and GREEN on the clean
 * schema.
 *
 * Gated on `DATABASE_URL` (a migrated database reached as a superuser).
 */
import { describe, expect, test } from "bun:test";

import { checkNoViewBypassesRls } from "../scripts/security-readiness";
import {
  evaluateViewRlsBypass,
  findViewRlsBypass,
  type ViewGrantRow,
  type ViewRow
} from "../scripts/lib/view-rls-bypass-readiness";

const DATABASE_URL = process.env.DATABASE_URL;
const describeOrSkip = DATABASE_URL ? describe : describe.skip;

describe("evaluateViewRlsBypass (pure)", () => {
  const view = (over: Partial<ViewRow> = {}): ViewRow => ({
    relname: "awcms_v",
    relkind: "v",
    owner: "postgres",
    owner_bypasses_rls: true,
    security_invoker: false,
    forced_tables: ["awcms_blog_posts"],
    ...over
  });
  const grant = (over: Partial<ViewGrantRow> = {}): ViewGrantRow => ({
    relname: "awcms_v",
    grantee: "awcms_app",
    privileges: ["SELECT"],
    ...over
  });

  test("a bypassing owner without security_invoker is a finding, with or without grants", () => {
    expect(evaluateViewRlsBypass([view()], [], [])[0]).toContain(
      "view awcms_v reads FORCE-RLS table(s) awcms_blog_posts as its owner postgres"
    );
  });

  test("security_invoker, or an owner that cannot bypass RLS, is clean", () => {
    expect(
      evaluateViewRlsBypass([view({ security_invoker: true })], [], [])
    ).toEqual([]);
    expect(
      evaluateViewRlsBypass([view({ owner_bypasses_rls: false })], [], [])
    ).toEqual([]);
  });

  test("a view over no FORCE-RLS table is not an RLS finding", () => {
    expect(
      evaluateViewRlsBypass([view({ forced_tables: [] })], [], [])
    ).toEqual([]);
  });

  test("a materialized view over a FORCE-RLS table is a finding once a role can SELECT it", () => {
    const mv = view({ relkind: "m", owner_bypasses_rls: false });

    expect(evaluateViewRlsBypass([mv], [], [])).toEqual([]);
    expect(
      evaluateViewRlsBypass([mv], [grant()], [{ ...reviewed("SELECT") }])[0]
    ).toContain("no row level security of its own");
  });

  function reviewed(...privileges: ViewGrantRow["privileges"]) {
    return {
      view: "awcms_v",
      role: "awcms_app",
      privileges: privileges as ("SELECT" | "INSERT")[]
    };
  }

  test("a grant outside the reviewed view grant matrix is a finding; exact match passes", () => {
    const safe = view({ security_invoker: true });

    expect(evaluateViewRlsBypass([safe], [grant()], [])[0]).toContain(
      "not in the reviewed view grant matrix"
    );
    expect(
      evaluateViewRlsBypass([safe], [grant()], [reviewed("SELECT")])
    ).toEqual([]);
    expect(
      evaluateViewRlsBypass(
        [safe],
        [grant({ privileges: ["SELECT", "INSERT"] })],
        [reviewed("SELECT")]
      )[0]
    ).toContain("holds INSERT on view awcms_v, which is beyond");
  });

  test("a reviewed grant that vanished is reported", () => {
    expect(
      evaluateViewRlsBypass(
        [view({ security_invoker: true })],
        [],
        [reviewed("SELECT")]
      )[0]
    ).toContain("no longer exists");
  });
});

describeOrSkip("security:readiness — views (database)", () => {
  async function withAdmin<T>(work: (sql: Bun.SQL) => Promise<T>): Promise<T> {
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
    await withAdmin((sql) => sql.unsafe(undo));
    await withAdmin((sql) => sql.unsafe(apply));
    try {
      await run();
    } finally {
      await withAdmin((sql) => sql.unsafe(undo));
    }
  }

  // ALTER DEFAULT PRIVILEGES (sql/021) hands the runtime roles DML on every new
  // relation, views included: a view is "ungranted" only after this REVOKE.
  const stripDefaultGrants = (view: string) =>
    `REVOKE ALL ON public.${view} FROM awcms_app, awcms_worker, awcms_setup, PUBLIC;`;

  const undo = `
    DROP VIEW IF EXISTS public.awcms_rdy_view_chain;
    DROP VIEW IF EXISTS public.awcms_rdy_view;
    DROP MATERIALIZED VIEW IF EXISTS public.awcms_rdy_matview;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awcms_rdy_owner') THEN
        REVOKE ALL ON public.awcms_blog_posts FROM awcms_rdy_owner;
        DROP ROLE awcms_rdy_owner;
      END IF;
    END $$;
  `;

  test("the clean schema passes (this repository defines no view)", async () => {
    const result = await checkNoViewBypassesRls();

    expect(result.status).toBe("pass");
    expect(result.evidence).toContain("view(s)/materialized view(s)");
  });

  test("a superuser-owned view over awcms_blog_posts granted to awcms_app fails and names it", async () => {
    await mutated(
      `CREATE VIEW public.awcms_rdy_view AS SELECT * FROM public.awcms_blog_posts;
       GRANT SELECT ON public.awcms_rdy_view TO awcms_app;`,
      undo,
      async () => {
        const result = await checkNoViewBypassesRls();

        expect(result.status).toBe("fail");
        expect(result.evidence).toContain("awcms_rdy_view");
        expect(result.evidence).toContain("awcms_blog_posts");
        expect(result.evidence).toContain("superuser or BYPASSRLS");
        expect(result.evidence).toContain(
          "awcms_app holds SELECT, INSERT, UPDATE, DELETE on view awcms_rdy_view"
        );
      }
    );
  });

  test("security_invoker alone is not enough: the grant must still be in the reviewed matrix", async () => {
    await mutated(
      `CREATE VIEW public.awcms_rdy_view WITH (security_invoker = true)
         AS SELECT * FROM public.awcms_blog_posts;
       GRANT SELECT ON public.awcms_rdy_view TO awcms_app;`,
      undo,
      async () => {
        const { findings } = await withAdmin((sql) => findViewRlsBypass(sql));

        expect(findings.length).toBe(1);
        expect(findings[0]).toContain("not in the reviewed view grant matrix");
        expect(findings[0]).not.toContain("superuser or BYPASSRLS");
      }
    );
  });

  test("an ungranted security_invoker view is clean; dropping security_invoker turns it red", async () => {
    await mutated(
      `CREATE VIEW public.awcms_rdy_view WITH (security_invoker = true)
         AS SELECT * FROM public.awcms_blog_posts;
       ${stripDefaultGrants("awcms_rdy_view")}`,
      undo,
      async () => {
        expect(
          (await withAdmin((sql) => findViewRlsBypass(sql))).findings
        ).toEqual([]);
        await withAdmin((sql) =>
          sql.unsafe(
            "ALTER VIEW public.awcms_rdy_view SET (security_invoker = false)"
          )
        );
        expect(
          (await withAdmin((sql) => findViewRlsBypass(sql))).findings[0]
        ).toContain("superuser or BYPASSRLS");
      }
    );
  });

  test("a nested view is followed transitively and PUBLIC counts as a grantee", async () => {
    await mutated(
      `CREATE VIEW public.awcms_rdy_view WITH (security_invoker = true)
         AS SELECT * FROM public.awcms_blog_posts;
       CREATE VIEW public.awcms_rdy_view_chain AS SELECT * FROM public.awcms_rdy_view;
       GRANT SELECT ON public.awcms_rdy_view_chain TO PUBLIC;`,
      undo,
      async () => {
        const { findings } = await withAdmin((sql) => findViewRlsBypass(sql));
        const text = findings.join("; ");

        expect(text).toContain("view awcms_rdy_view_chain reads FORCE-RLS");
        expect(text).toContain(
          "PUBLIC holds SELECT on view awcms_rdy_view_chain"
        );
      }
    );
  });

  test("an owner that is neither superuser nor BYPASSRLS passes the owner rule", async () => {
    await mutated(
      `CREATE ROLE awcms_rdy_owner NOLOGIN;
       GRANT SELECT ON public.awcms_blog_posts TO awcms_rdy_owner;
       CREATE VIEW public.awcms_rdy_view AS SELECT * FROM public.awcms_blog_posts;
       ALTER VIEW public.awcms_rdy_view OWNER TO awcms_rdy_owner;
       ${stripDefaultGrants("awcms_rdy_view")}`,
      `${undo}`,
      async () => {
        const { findings } = await withAdmin((sql) => findViewRlsBypass(sql));

        expect(findings).toEqual([]);
        await withAdmin((sql) =>
          sql.unsafe("ALTER ROLE awcms_rdy_owner BYPASSRLS")
        );
        expect(
          (await withAdmin((sql) => findViewRlsBypass(sql))).findings[0]
        ).toContain("superuser or BYPASSRLS");
      }
    );
  });

  test("a materialized view over awcms_blog_posts readable by awcms_app fails", async () => {
    await mutated(
      `CREATE MATERIALIZED VIEW public.awcms_rdy_matview AS SELECT * FROM public.awcms_blog_posts;
       GRANT SELECT ON public.awcms_rdy_matview TO awcms_app;`,
      undo,
      async () => {
        const { findings } = await withAdmin((sql) => findViewRlsBypass(sql));
        const text = findings.join("; ");

        expect(text).toContain("materialized view awcms_rdy_matview");
        expect(text).toContain("no row level security of its own");
      }
    );
  });
});
