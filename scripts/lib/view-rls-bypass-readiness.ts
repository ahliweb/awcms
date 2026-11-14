/**
 * `security:readiness` detection added for Issue #1347 (follow-up of the #1279
 * audit). A view is evaluated with the privileges of its OWNER unless it is
 * `security_invoker`. A view owned by a superuser or a BYPASSRLS role over a
 * FORCE-RLS table is therefore read WITHOUT row level security by whoever holds
 * SELECT on the view: `FORCE` only binds a table's owner, and a superuser /
 * BYPASSRLS role is exempt from it. Materialized views are worse: they have no
 * RLS and no `security_invoker`, so the rows stored at refresh time are served
 * to every reader whatever tenant they act for.
 *
 * Every earlier check looked at `relkind IN ('r', 'p')` only, so a view was
 * invisible to all of them, including the runtime grant matrix.
 *
 * Kept in a file of its own (like `schema-create-and-tenant-policy-readiness.ts`)
 * so nothing here imports `security-readiness.ts`; everything takes the SQL
 * client as an argument.
 *
 * Known limit: only relation dependencies are followed (tables and nested
 * views). A view that reaches a FORCE-RLS table solely through a function body
 * is not visible in `pg_depend`.
 */

const VIEW_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "TRIGGER",
  "REFERENCES"
] as const;

export type ViewPrivilege = (typeof VIEW_PRIVILEGES)[number];

/**
 * The view grant matrix. A view or materialized view in schema `public` that a
 * restricted role (any non-superuser `awcms_*` role other than the view's own
 * owner, and `PUBLIC`) can touch must be declared here with EXACTLY the
 * privileges it may hold; any other privilege is a finding. Empty today: this
 * repository defines no view. Adding one is a migration AND an edit here, on
 * purpose, the same contract as `REVIEWED_PERMISSIVE_POLICIES`.
 */
export type ReviewedViewGrant = {
  view: string;
  /** A role name or `PUBLIC`. */
  role: string;
  privileges: readonly ViewPrivilege[];
};

export const REVIEWED_VIEW_GRANTS: readonly ReviewedViewGrant[] = [];

export type ViewRow = {
  relname: string;
  relkind: "v" | "m";
  owner: string;
  owner_bypasses_rls: boolean;
  security_invoker: boolean;
  /** FORCE-RLS tables the view reaches, transitively through nested views. */
  forced_tables: string[];
};

export type ViewGrantRow = {
  relname: string;
  grantee: string;
  privileges: string[];
};

/** Pure decision over the catalog rows, exported for the unit tests. */
export function evaluateViewRlsBypass(
  views: readonly ViewRow[],
  grants: readonly ViewGrantRow[],
  reviewed: readonly ReviewedViewGrant[] = REVIEWED_VIEW_GRANTS
): string[] {
  const findings: string[] = [];

  for (const view of views) {
    if (view.forced_tables.length === 0) continue;

    const label = `${view.relkind === "m" ? "materialized view" : "view"} ${view.relname}`;
    const over = view.forced_tables.join(", ");

    if (view.owner_bypasses_rls && !view.security_invoker) {
      findings.push(
        `${label} reads FORCE-RLS table(s) ${over} as its owner ${view.owner}, which is a superuser or BYPASSRLS role: every reader sees all tenants' rows (set security_invoker = true, or give it an owner that is neither)`
      );
    }

    if (view.relkind === "m") {
      const readers = grants
        .filter(
          (grant) =>
            grant.relname === view.relname &&
            grant.privileges.includes("SELECT")
        )
        .map((grant) => grant.grantee);

      if (readers.length > 0) {
        findings.push(
          `${label} stores rows of FORCE-RLS table(s) ${over} with no row level security of its own, yet ${readers.join(", ")} can SELECT it`
        );
      }
    }
  }

  const key = (view: string, role: string) => `${view}\u0000${role}`;
  const pinnedBy = new Map(
    reviewed.map((entry) => [key(entry.view, entry.role), entry])
  );
  const seen = new Set<string>();

  for (const grant of grants) {
    const pinned = pinnedBy.get(key(grant.relname, grant.grantee));
    const excess = grant.privileges.filter(
      (privilege) => !pinned?.privileges.includes(privilege as ViewPrivilege)
    );

    if (pinned) seen.add(key(grant.relname, grant.grantee));
    if (excess.length > 0) {
      findings.push(
        `${grant.grantee} holds ${excess.join(", ")} on view ${grant.relname}, which is ${pinned ? "beyond" : "not in"} the reviewed view grant matrix (REVIEWED_VIEW_GRANTS)`
      );
    }
  }

  const present = new Set(views.map((view) => view.relname));

  for (const entry of reviewed) {
    if (present.has(entry.view) && !seen.has(key(entry.view, entry.role))) {
      findings.push(
        `${entry.view} has a reviewed grant to ${entry.role} that no longer exists (remove it from REVIEWED_VIEW_GRANTS)`
      );
    }
  }

  return findings;
}

/**
 * Reads every view/materialized view in schema `public` (relkind v/m) with its
 * transitive FORCE-RLS dependencies and the privileges restricted roles hold on
 * it, then applies `evaluateViewRlsBypass`. Never throws on a clean database; a
 * driver error propagates to the caller.
 */
export async function findViewRlsBypass(
  sql: Bun.SQL,
  reviewed: readonly ReviewedViewGrant[] = REVIEWED_VIEW_GRANTS
): Promise<{ checkedViews: number; findings: string[] }> {
  const views = (await sql`
    SELECT c.relname::text AS relname, c.relkind::text AS relkind,
           o.rolname::text AS owner,
           (o.rolsuper OR o.rolbypassrls) AS owner_bypasses_rls,
           EXISTS (
             SELECT 1 FROM pg_options_to_table(c.reloptions) opt
             WHERE opt.option_name = 'security_invoker'
               AND lower(opt.option_value) IN ('true', 'on', 'yes', 'y', 't', '1')
           ) AS security_invoker,
           ARRAY(
             SELECT t.relname::text
             FROM pg_class t
             WHERE t.relkind IN ('r', 'p')
               AND t.relrowsecurity AND t.relforcerowsecurity
               AND t.oid IN (
                 WITH RECURSIVE edges AS (
                   SELECT r.ev_class AS view_oid, d.refobjid AS ref_oid
                   FROM pg_rewrite r
                   JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass
                                   AND d.objid = r.oid
                                   AND d.refclassid = 'pg_class'::regclass
                   WHERE d.refobjid <> r.ev_class
                 ), reach AS (
                   SELECT ref_oid FROM edges WHERE view_oid = c.oid
                   UNION
                   SELECT e.ref_oid FROM reach JOIN edges e ON e.view_oid = reach.ref_oid
                 )
                 SELECT ref_oid FROM reach
               )
             ORDER BY 1
           ) AS forced_tables
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles o ON o.oid = c.relowner
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
    ORDER BY c.relname
  `) as ViewRow[];

  const grantRows = (await sql`
    SELECT c.relname::text AS relname, g.name AS grantee,
           ARRAY(
             SELECT p FROM unnest(${sql.array([...VIEW_PRIVILEGES], "text")}::text[]) AS p
             WHERE CASE WHEN g.oid = 0
                        THEN EXISTS (
                          SELECT 1
                          FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                          WHERE a.grantee = 0 AND a.privilege_type = p)
                        ELSE has_table_privilege(g.oid, c.oid, p) END
           ) AS privileges
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL (
      SELECT 0::oid AS oid, 'PUBLIC'::text AS name
      UNION ALL
      SELECT r.oid, r.rolname::text
      FROM pg_roles r
      WHERE r.rolname LIKE 'awcms\_%' AND NOT r.rolsuper AND r.oid <> c.relowner
    ) g
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
    ORDER BY c.relname, g.name
  `) as ViewGrantRow[];

  return {
    checkedViews: views.length,
    findings: evaluateViewRlsBypass(
      views,
      grantRows.filter((row) => row.privileges.length > 0),
      reviewed
    )
  };
}
