/**
 * Two `security:readiness` detections added for Issue #1279 (audit of #1274,
 * findings X3 and X4). Both were established as UNCAUGHT by the full gate before
 * this file existed: `GRANT CREATE ON SCHEMA public TO awcms_social_dispatch`
 * and `ALTER POLICY awcms_blog_posts_tenant_isolation ... USING (true)` each
 * left every check green.
 *
 * Kept in a file of its own (like `worker-secret-probe.ts`) so the checks can
 * import nothing from `security-readiness.ts`; the thin `SecurityCheckResult`
 * wrappers live there. Everything here takes the SQL client as an argument.
 */

class ProbeRollback extends Error {}

// ---------------------------------------------------------------------------
// X3: no schema-level (or database-level) CREATE for a restricted role
// ---------------------------------------------------------------------------

/**
 * Every SECURITY DEFINER function and trigger guard in this repository pins
 * `search_path = public, pg_temp`. A role that can CREATE in `public` can plant
 * an object those bodies then resolve, so the privilege is held by the schema
 * owner and by nobody else: not `PUBLIC`, not the runtime, worker, setup or
 * dedicated dispatch roles, not any NOLOGIN definer-owner role.
 *
 * The allow-list is explicit: the owner of the schema and of the database (the
 * migrator) plus the roles named in `migrators` (a deployment whose migrator is
 * a LOGIN member of a NOLOGIN owner role). The owner is exempt BY ROLE, never by
 * identity alone: an owner that is itself a restricted role (`awcms_*` or a
 * documented definer owner) is reported, because `ALTER SCHEMA public OWNER TO
 * awcms_worker` and `ALTER DATABASE ... OWNER TO awcms_app` (the latter makes it
 * a member of `pg_database_owner`, the PG15+ owner of `public`) grant CREATE as
 * surely as a GRANT does. Superusers hold it implicitly and are outside what a
 * GRANT can change.
 *
 * The effective-privilege stage covers every non-superuser role that can LOG IN
 * as well as the restricted roles, so a throwaway `rdy_evil` that is a member of
 * the owner is reported even though its name says nothing.
 *
 * TEMP is not reported as a privilege: PostgreSQL grants it to PUBLIC by default
 * and `pg_temp` is the LAST entry of every pinned search_path. That premise is
 * enforced here instead (stage 3): every SECURITY DEFINER function must carry
 * exactly `search_path=public, pg_temp`, else a temp table could shadow a
 * `public` one inside a definer body.
 *
 * The schema is the literal `public`, never `current_schema()`: a schema named
 * after the connecting role ("$user") would otherwise redirect every query here.
 *
 * Returns the findings (empty when clean). Never throws on a clean database; a
 * driver error propagates to the caller, which reports it as a failure.
 */
export async function findRestrictedCreatePrivileges(
  sql: Bun.SQL,
  definerOwners: readonly string[],
  migrators: readonly string[] = []
): Promise<string[]> {
  const findings: string[] = [];

  // 1. The ACLs themselves: any grantee other than the owner that holds CREATE,
  //    `PUBLIC` included. `acldefault` stands in for a NULL ACL (the defaults).
  const schemaGrants = (await sql`
    SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee
    FROM pg_namespace n,
         LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
    WHERE n.nspname = 'public'
      AND a.privilege_type = 'CREATE'
      AND a.grantee <> n.nspowner
      AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) <> ALL(${sql.array([...migrators], "text")}))
    ORDER BY 1
  `) as { grantee: string }[];

  for (const row of schemaGrants) {
    findings.push(`${row.grantee} holds CREATE on schema public`);
  }

  const databaseGrants = (await sql`
    SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee
    FROM pg_database d,
         LATERAL aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
    WHERE d.datname = current_database()
      AND a.privilege_type = 'CREATE'
      AND a.grantee <> d.datdba
      AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) <> ALL(${sql.array([...migrators], "text")}))
    ORDER BY 1
  `) as { grantee: string }[];

  for (const row of databaseGrants) {
    findings.push(`${row.grantee} holds CREATE on the database`);
  }

  // 2. The EFFECTIVE privilege: catches a grant that arrives through membership
  //    (`GRANT <owner-ish role> TO <anyone>`) which no ACL names. Scope = every
  //    non-superuser role that can LOG IN, every `awcms_*` role, every documented
  //    definer owner, every owner of a SECURITY DEFINER function in the schema
  //    and the role this check connects as. Exempt: superusers, the allow-listed
  //    migrators and the schema/database owner, the owner only while it is NOT
  //    itself a restricted role (see the header).
  const effective = (await sql`
    SELECT r.rolname,
           has_schema_privilege(r.oid, 'public', 'CREATE') AS on_schema,
           has_database_privilege(r.oid, current_database(), 'CREATE') AS on_database
    FROM pg_roles r
    WHERE NOT r.rolsuper
      AND r.rolname NOT LIKE 'pg\_%'
      AND r.rolname <> ALL(${sql.array([...migrators], "text")})
      AND (
        r.oid NOT IN (
          (SELECT datdba FROM pg_database WHERE datname = current_database()),
          (SELECT nspowner FROM pg_namespace WHERE nspname = 'public')
        )
        OR r.rolname LIKE 'awcms\_%'
        OR r.rolname = ANY(${sql.array([...definerOwners], "text")})
      )
      AND (
        r.rolcanlogin
        OR r.rolname LIKE 'awcms\_%'
        OR r.rolname = current_user
        OR r.rolname = ANY(${sql.array([...definerOwners], "text")})
        OR r.oid IN (
          SELECT p.proowner
          FROM pg_proc p
          JOIN pg_namespace pn ON pn.oid = p.pronamespace
          WHERE p.prosecdef AND pn.nspname = 'public'
            AND NOT EXISTS (
              SELECT 1 FROM pg_depend d
              WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
                AND d.deptype = 'e'
            )
        )
      )
    ORDER BY r.rolname
  `) as { rolname: string; on_schema: boolean; on_database: boolean }[];

  for (const row of effective) {
    if (row.on_schema) {
      findings.push(
        `${row.rolname} can CREATE on schema public (directly, through a membership, or as its owner)`
      );
    }
    if (row.on_database) {
      findings.push(
        `${row.rolname} can CREATE on the database (directly, through a membership, or as its owner)`
      );
    }
  }

  // 3. The premise behind not reporting TEMP: every SECURITY DEFINER function
  //    pins exactly `search_path=public, pg_temp`. A function without it (or
  //    with `public` alone, which makes pg_temp implicitly FIRST for relations)
  //    lets a temp object shadow a `public` table inside the definer body.
  const unpinned = (await sql`
    SELECT p.oid::regprocedure::text AS fn
    FROM pg_proc p
    JOIN pg_namespace pn ON pn.oid = p.pronamespace
    WHERE p.prosecdef AND pn.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
          AND d.deptype = 'e'
      )
      AND p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
    ORDER BY 1
  `) as { fn: string }[];

  for (const row of unpinned) {
    findings.push(
      `SECURITY DEFINER function ${row.fn} does not pin exactly search_path = public, pg_temp`
    );
  }

  return [...new Set(findings)];
}

// ---------------------------------------------------------------------------
// X4: the tenant isolation policy of every FORCE-RLS table keeps its shape
// ---------------------------------------------------------------------------

/**
 * The three reviewed spellings of "this row's tenant is the transaction's
 * tenant" (`pg_get_expr`, whitespace collapsed). All three are fail-closed: the
 * first raises when the setting is absent, the other two compare against NULL
 * and see no row. Anything else (`true`, `true OR ...`, a dropped correlation, a
 * different column) is not tenant isolation.
 */
export const CANONICAL_TENANT_ISOLATION_EXPRESSIONS: readonly string[] = [
  "(tenant_id = (current_setting('app.current_tenant_id'::text))::uuid)",
  "(tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)",
  "(tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)"
];

/**
 * A reviewed PERMISSIVE policy that is not the tenant-isolation policy: a
 * narrow, role-scoped read or write that a SECURITY DEFINER owner needs
 * across tenants (the sweepers, the bootstrap reads, the partner view). Each is
 * pinned to its exact roles, command and expressions; adding one is a migration
 * AND an edit here, on purpose. `withCheck: null` means the policy has none.
 */
export type ReviewedPermissivePolicy = {
  table: string;
  policy: string;
  /** `pg_policy.polcmd`: r SELECT, a INSERT, w UPDATE, d DELETE, * ALL. */
  command: "r" | "a" | "w" | "d" | "*";
  /** The roles it applies to, sorted, `PUBLIC` for everyone. */
  roles: readonly string[];
  using: string;
  withCheck: string | null;
};

const REVIEWED_NARROW = (
  table: string,
  policy: string,
  command: ReviewedPermissivePolicy["command"],
  role: string,
  using = "true",
  withCheck: string | null = null
): ReviewedPermissivePolicy => ({
  table,
  policy,
  command,
  roles: [role],
  using,
  withCheck
});

export const REVIEWED_PERMISSIVE_POLICIES: readonly ReviewedPermissivePolicy[] =
  [
    REVIEWED_NARROW(
      "awcms_delegated_access_grants",
      "awcms_delegated_access_grants_delegated_expiry_sweep",
      "r",
      "awcms_delegated_expiry"
    ),
    REVIEWED_NARROW(
      "awcms_delegated_access_grants",
      "awcms_delegated_access_grants_delegated_expiry_write",
      "w",
      "awcms_delegated_expiry",
      "true",
      "true"
    ),
    REVIEWED_NARROW(
      "awcms_hr_commission_intake_settings",
      "awcms_hr_commission_intake_settings_counter_select",
      "r",
      "awcms_hr_commission_lifecycle_counter"
    ),
    REVIEWED_NARROW(
      "awcms_identities",
      "awcms_identities_principal_reach_read",
      "r",
      "awcms_principal_reach"
    ),
    REVIEWED_NARROW(
      "awcms_partner_managed_tenants",
      "awcms_partner_managed_tenants_partner_read",
      "r",
      "awcms_partner_view"
    ),
    REVIEWED_NARROW(
      "awcms_partners",
      "awcms_partners_partner_view_read",
      "r",
      "awcms_partner_view"
    ),
    REVIEWED_NARROW(
      "awcms_sessions",
      "awcms_sessions_delegated_expiry_sweep",
      "r",
      "awcms_delegated_expiry"
    ),
    REVIEWED_NARROW(
      "awcms_sessions",
      "awcms_sessions_delegated_expiry_write",
      "w",
      "awcms_delegated_expiry",
      "true",
      "true"
    ),
    REVIEWED_NARROW(
      "awcms_telegram_bindings",
      "awcms_telegram_bindings_bootstrap_read",
      "r",
      "awcms_telegram_bootstrap"
    ),
    REVIEWED_NARROW(
      "awcms_telegram_link_codes",
      "awcms_telegram_link_codes_bootstrap_read",
      "r",
      "awcms_telegram_bootstrap"
    ),
    REVIEWED_NARROW(
      "awcms_tenant_domains",
      "awcms_tenant_domains_bootstrap_read",
      "r",
      "awcms_domain_bootstrap"
    ),
    REVIEWED_NARROW(
      "awcms_tenant_modules",
      "awcms_tenant_modules_commission_intake_counter_select",
      "r",
      "awcms_hr_commission_lifecycle_counter",
      "(tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)"
    ),
    REVIEWED_NARROW(
      "awcms_tenant_users",
      "awcms_tenant_users_delegated_expiry_sweep",
      "r",
      "awcms_delegated_expiry"
    ),
    REVIEWED_NARROW(
      "awcms_tenant_users",
      "awcms_tenant_users_delegated_expiry_write",
      "w",
      "awcms_delegated_expiry",
      "true",
      "true"
    )
  ];

/**
 * A FORCE-RLS table that legitimately has no tenant-isolation policy (it holds
 * no tenant rows). Empty today: every one of the FORCE-RLS tables carries one.
 */
export const TENANT_ISOLATION_TABLE_EXCEPTIONS: Readonly<
  Record<string, string>
> = {};

const ISOLATION_POLICY_SUFFIX = "_tenant_isolation";

type PolicyRow = {
  relname: string;
  polname: string;
  polcmd: string;
  roles: string[];
  using: string | null;
  with_check: string | null;
};

function collapse(expression: string | null): string | null {
  return expression === null ? null : expression.replace(/\s+/g, " ").trim();
}

/**
 * The generic rule behind the X4 pin: for EVERY table in the schema with FORCE
 * ROW LEVEL SECURITY,
 *
 *  1. there is a PERMISSIVE policy named `*_tenant_isolation`, FOR ALL, TO
 *     PUBLIC, whose USING is one of `CANONICAL_TENANT_ISOLATION_EXPRESSIONS`
 *     exactly and whose WITH CHECK is absent or equally canonical; and
 *  2. every OTHER permissive policy is a reviewed exception pinned exactly.
 *
 * Permissive policies are OR-ed, so widening is done either by editing the
 * isolation policy or by adding a second one; the rule rejects both. Restrictive
 * policies can only narrow and are pinned by the dedicated-role checks.
 *
 * Expressions are compared with `pg_get_expr` text, whitespace collapsed (the
 * same normalisation as `normalizePolicyExpression`); a substring pin would pass
 * `... OR true`.
 */
export function evaluateTenantIsolationPolicies(
  tables: readonly string[],
  policies: readonly PolicyRow[],
  reviewed: readonly ReviewedPermissivePolicy[] = REVIEWED_PERMISSIVE_POLICIES,
  tableExceptions: Readonly<
    Record<string, string>
  > = TENANT_ISOLATION_TABLE_EXCEPTIONS
): string[] {
  const findings: string[] = [];
  const canonical = new Set(CANONICAL_TENANT_ISOLATION_EXPRESSIONS);
  const byTable = new Map<string, PolicyRow[]>();

  for (const policy of policies) {
    const list = byTable.get(policy.relname) ?? [];

    list.push(policy);
    byTable.set(policy.relname, list);
  }

  const reviewedKey = (table: string, policy: string) =>
    `${table}\u0000${policy}`;
  const reviewedByKey = new Map(
    reviewed.map((entry) => [reviewedKey(entry.table, entry.policy), entry])
  );
  const seenReviewed = new Set<string>();

  for (const table of tables) {
    const own = byTable.get(table) ?? [];
    const isolation = own.filter((policy) =>
      policy.polname.endsWith(ISOLATION_POLICY_SUFFIX)
    );

    if (isolation.length === 0 && !(table in tableExceptions)) {
      findings.push(`${table} has no *_tenant_isolation policy`);
    }

    for (const policy of isolation) {
      const using = collapse(policy.using);
      const withCheck = collapse(policy.with_check);
      const problems: string[] = [];

      if (policy.polcmd !== "*") problems.push("is not FOR ALL");
      if (policy.roles.join(",") !== "PUBLIC") {
        problems.push(`is scoped to ${policy.roles.join(",")}, not PUBLIC`);
      }
      if (using === null || !canonical.has(using)) {
        problems.push(`USING is ${using === null ? "absent" : `\`${using}\``}`);
      }
      if (withCheck !== null && !canonical.has(withCheck)) {
        problems.push(`WITH CHECK is \`${withCheck}\``);
      }
      if (problems.length > 0) {
        findings.push(
          `${table}.${policy.polname} is not the canonical tenant isolation policy: ${problems.join("; ")}`
        );
      }
    }

    for (const policy of own) {
      if (policy.polname.endsWith(ISOLATION_POLICY_SUFFIX)) continue;

      const key = reviewedKey(table, policy.polname);
      const pinned = reviewedByKey.get(key);

      if (!pinned) {
        findings.push(
          `${table}.${policy.polname} is a permissive policy that is not a reviewed exception (USING ${collapse(policy.using) ?? "absent"})`
        );
        continue;
      }

      seenReviewed.add(key);

      const problems: string[] = [];

      if (policy.polcmd !== pinned.command) problems.push("command differs");
      if (
        [...policy.roles].sort().join(",") !==
        [...pinned.roles].sort().join(",")
      ) {
        problems.push(`roles are ${policy.roles.join(",")}`);
      }
      if (collapse(policy.using) !== pinned.using) {
        problems.push(`USING is ${collapse(policy.using) ?? "absent"}`);
      }
      if (collapse(policy.with_check) !== pinned.withCheck) {
        problems.push(
          `WITH CHECK is ${collapse(policy.with_check) ?? "absent"}`
        );
      }
      if (problems.length > 0) {
        findings.push(
          `${table}.${policy.polname} drifted from its reviewed shape: ${problems.join("; ")}`
        );
      }
    }
  }

  const present = new Set(tables);

  for (const entry of reviewed) {
    if (
      present.has(entry.table) &&
      !seenReviewed.has(reviewedKey(entry.table, entry.policy))
    ) {
      findings.push(
        `${entry.table}.${entry.policy} is a reviewed exception that no longer exists (remove it from REVIEWED_PERMISSIVE_POLICIES)`
      );
    }
  }

  return findings;
}

/** Reads the FORCE-RLS tables and their permissive policies from the catalog. */
export async function findTenantIsolationPolicyDrift(
  sql: Bun.SQL
): Promise<{ checkedTables: number; findings: string[] }> {
  const tables = (
    (await sql`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND c.relrowsecurity AND c.relforcerowsecurity
      ORDER BY c.relname
    `) as { relname: string }[]
  ).map((row) => row.relname);

  const rows = (await sql`
    SELECT c.relname,
           p.polname::text AS polname,
           p.polcmd::text AS polcmd,
           ARRAY(
             SELECT CASE WHEN o = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(o) END
             FROM unnest(p.polroles) AS o
             ORDER BY 1
           ) AS roles,
           pg_get_expr(p.polqual, p.polrelid) AS using,
           pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relforcerowsecurity
      AND p.polpermissive
    ORDER BY c.relname, p.polname
  `) as PolicyRow[];

  const findings = evaluateTenantIsolationPolicies(tables, rows);

  // A pin over zero tables passes vacuously; a database that has FORCE-RLS
  // tables at all must show them here.
  if (tables.length === 0) {
    findings.push(
      "no FORCE-RLS table was found in schema public, so the tenant isolation pin checked nothing"
    );
  }

  return { checkedTables: tables.length, findings };
}

/**
 * The behavioural half of the X4 pin: a rolled-back transaction that seeds a
 * row for each of two tenants in the two tables the SECURITY DEFINER source
 * re-check functions (sql/386) read on a dedicated role's behalf, then reads as
 * the runtime role and as the definer owner under ONE tenant. It must see its
 * own row (the positive control: the probe is not blind) and never the other
 * tenant's. A policy widened to `USING (true)` shows the foreign row.
 *
 * Needs a superuser connection to seed and to assume the roles; otherwise the
 * probe does not run (`ran: false`) and the exact expression pin above is the
 * guard.
 *
 * A listed role that is a superuser or holds BYPASSRLS is a FINDING, not a role
 * to skip: it reads every tenant's rows whatever the policies say, so its
 * isolation cannot be probed and does not exist. The result names the roles that
 * were probed and the ones that could not be (not provisioned, no read grant),
 * so a caller's evidence never claims a probe that did not happen.
 */
export async function probeTenantIsolationUnderDefinerRead(
  sql: Bun.SQL,
  roles: readonly string[]
): Promise<{
  ran: boolean;
  findings: string[];
  probedRoles: string[];
  skippedRoles: string[];
}> {
  const can = (await sql`
    SELECT rolsuper AS can FROM pg_roles WHERE rolname = current_user
  `) as { can: boolean }[];

  if (!can[0]?.can) {
    return {
      ran: false,
      findings: [],
      probedRoles: [],
      skippedRoles: [...roles]
    };
  }

  const existing = (await sql`
    SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
    WHERE rolname = ANY(${sql.array([...roles], "text")})
    ORDER BY rolname
  `) as { rolname: string; rolsuper: boolean; rolbypassrls: boolean }[];
  const findings: string[] = [];
  const probedRoles = new Set<string>();
  const exempt = new Set<string>();

  for (const row of existing) {
    if (row.rolsuper || row.rolbypassrls) {
      exempt.add(row.rolname);
      findings.push(
        `${row.rolname} is ${row.rolsuper ? "a superuser" : "BYPASSRLS"}: it reads every tenant's rows whatever the policies say, so tenant isolation cannot hold for it`
      );
    }
  }

  let probed = 0;

  try {
    await sql.begin(async (tx) => {
      const mine = crypto.randomUUID();
      const other = crypto.randomUUID();
      const actor = crypto.randomUUID();

      for (const id of [mine, other]) {
        const code = `rdy-${id.slice(0, 8)}`;

        await tx`
          INSERT INTO public.awcms_tenants (id, tenant_code, tenant_name)
          VALUES (${id}, ${code}, ${code})
        `;
      }

      const post = async (tenantId: string): Promise<string> => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        const rows = (await tx`
          INSERT INTO public.awcms_blog_posts
            (tenant_id, author_tenant_user_id, title, slug, content_json,
             content_text, status, visibility, published_at)
          VALUES (${tenantId}, ${actor}, 'probe', ${`probe-${tenantId.slice(0, 8)}`},
                  '{}'::jsonb, 'probe', 'published', 'public', now())
          RETURNING id
        `) as { id: string }[];

        return rows[0]!.id;
      };
      const media = async (tenantId: string): Promise<string> => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        const id = crypto.randomUUID();

        await tx`
          INSERT INTO public.awcms_news_media_objects
            (id, tenant_id, bucket_name, object_key, public_url, mime_type,
             status, created_by_tenant_user_id, copyright_status,
             rights_verification_status)
          VALUES (${id}, ${tenantId}, 'probe',
                  ${`news-media/${tenantId}/2026/11/${id}.jpg`},
                  ${`https://media.example/${id}.jpg`}, 'image/jpeg',
                  'verified', ${actor}, 'owned', 'unverified')
        `;

        return id;
      };

      const mineIds = {
        awcms_blog_posts: await post(mine),
        awcms_news_media_objects: await media(mine)
      };
      const otherIds = {
        awcms_blog_posts: await post(other),
        awcms_news_media_objects: await media(other)
      };

      await tx`SELECT set_config('app.current_tenant_id', ${mine}, true)`;

      for (const { rolname } of existing) {
        if (exempt.has(rolname)) continue;

        for (const table of [
          "awcms_blog_posts",
          "awcms_news_media_objects"
        ] as const) {
          const allowed = (await tx`
            SELECT has_column_privilege(${rolname}, ${table}, 'id', 'SELECT') AS ok
          `) as { ok: boolean }[];

          if (!allowed[0]?.ok) continue;

          // One savepoint per read: a refused read rolls back to it (and the
          // SET LOCAL ROLE with it) instead of aborting the transaction and
          // hiding the real error behind "current transaction is aborted".
          let seen: string[] = [];

          try {
            seen = await tx.savepoint(async (sp) => {
              await sp.unsafe(
                `SET LOCAL ROLE "${rolname.replace(/"/g, '""')}"`
              );

              const rows = (await sp.unsafe(
                `SELECT id::text AS id FROM public."${table}" WHERE id = ANY($1::uuid[])`,
                [`{${mineIds[table]},${otherIds[table]}}`]
              )) as { id: string }[];

              await sp.unsafe("RESET ROLE");

              return rows.map((row) => row.id);
            });
          } catch (error) {
            findings.push(
              `${rolname} could not read ${table} during the isolation probe: ${error instanceof Error ? error.message : String(error)}`
            );
            continue;
          }

          probedRoles.add(rolname);
          probed += 1;

          if (!seen.includes(mineIds[table])) {
            findings.push(
              `${rolname} cannot see its own tenant's ${table} row (the isolation probe is blind)`
            );
          }
          if (seen.includes(otherIds[table])) {
            findings.push(
              `${rolname} reads ANOTHER tenant's ${table} row under this tenant's setting`
            );
          }
        }
      }

      throw new ProbeRollback();
    });
  } catch (error) {
    if (!(error instanceof ProbeRollback)) {
      return {
        ran: true,
        findings: [
          `the tenant-isolation probe could not run: ${error instanceof Error ? error.message : String(error)}`
        ],
        probedRoles: [...probedRoles],
        skippedRoles: []
      };
    }
  }

  return {
    ran: probed > 0,
    findings,
    probedRoles: [...probedRoles].sort(),
    skippedRoles: roles.filter((role) => !probedRoles.has(role))
  };
}
