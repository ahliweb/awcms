/**
 * The payroll boundary read from the MIGRATED CATALOG (Issue #1015, M-B;
 * `docs/awcms/hr-payroll.md` section 13.3).
 *
 * `payroll:sql-boundary:check` reads migration TEXT, and text can be written
 * around: dynamic `EXECUTE` with a name built from pieces, a `;` in a literal,
 * a view renamed after it is created, a function chain, a trigger body in
 * single quotes. The database cannot be written around. Whatever the text did,
 * the migrated catalog says which relation depends on which, and which function
 * returns or names which row type. This module asks the catalog.
 *
 * ## The rule
 *
 * A relation, rule, function, trigger or grant that touches a payroll table must
 * itself be in the payroll family (a payroll-family NAME, `isPayrollTable`, so
 * every registry gate already refuses it). Concretely, against a database where
 * every migration has run:
 *
 * | Code                            | Source of truth                                   | Fails when                                                                                                      |
 * | ------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
 * | `relation-over-payroll`         | `pg_rewrite` + `pg_depend`                        | a view, materialised view or rule on a non-family relation depends on a payroll relation or function           |
 * | `relation-over-leaking-function`| same                                              | such a relation depends on a non-family function that is itself a finding (a view over a `SETOF` leak)         |
 * | `payroll-rule-writes-outside`   | same                                              | a rule on a payroll table (not its view definition) depends on a non-family relation (`DO ALSO INSERT ...`)    |
 * | `function-payroll-row-type`     | `pg_proc.prorettype` / argument types / `pg_depend` | a non-family function returns, takes or depends on a payroll row type (`RETURNS SETOF <payroll table>`)        |
 * | `function-reads-payroll`        | `pg_proc.prosrc`                                  | a non-family function body names a payroll table (single-quoted bodies, `SECURITY DEFINER`, any language)      |
 * | `function-calls-payroll-function` | `pg_proc.prosrc`                                | a non-family function calls a payroll-family function (a chain through a family function)                      |
 * | `function-chain`                | `pg_proc.prosrc`                                  | a non-family function calls another non-family finding (the transitive closure; trigger -> f1 -> f2 -> payroll)|
 * | `function-dynamic-sql`          | `pg_proc.prosrc`                                  | a non-family plpgsql function runs `EXECUTE`: its relation names are strings no scan can hold to the rule      |
 * | `trigger-foreign-function`      | `pg_trigger` -> `pg_proc`                         | a trigger on a payroll table runs a non-family function, or a trigger on any other table runs a family one     |
 * | `payroll-grant`                 | `relacl` / `attacl` / `proacl`                    | a payroll relation (or column, or SECURITY DEFINER family function) is granted to a role outside `PAYROLL_ALLOWED_GRANTEES`, `PUBLIC` included |
 * | `inheritance-crosses-boundary`  | `pg_inherits`                                     | a payroll table and a non-family relation are parent and child                                                 |
 *
 * Issue #1077 added, to the same rule:
 *
 * | Code                            | Source of truth                                   | Fails when                                                                                                      |
 * | ------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
 * | `payroll-marker-outside-family` | `pg_class` + `obj_description`                    | a relation carrying the `payroll-boundary` comment has no family name (a RENAME or SET SCHEMA took it out)      |
 * | `payroll-marker-missing`        | same                                              | a payroll-family table has no marker                                                                            |
 * | `payroll-table-missing`         | `PAYROLL_REQUIRED_TABLES`                         | a required payroll table is not a table in `public` (renamed, moved, dropped)                                  |
 * | `function-indirect-read`        | `pg_proc.prosrc`                                  | a non-family SECURITY DEFINER body uses `schema_to_xml`/`query_to_xml`/`table_to_xml`/`regclass`/`format()`/`ts_stat`/`dblink`/`U&"..."` |
 * | `function-opaque-language`      | `pg_language`                                     | any function is written in a language other than sql/plpgsql (its body cannot be read)                         |
 * | `payroll-owner`                 | `relowner` / `proowner`                           | a payroll relation or family function is owned by a runtime role (`PAYROLL_FORBIDDEN_OWNERS`)                  |
 * | `payroll-role-membership`       | `pg_auth_members`                                 | a role is, directly or transitively, a member of an allowed grantee or of a payroll owner                      |
 * | `payroll-publication`           | `pg_publication`, `_rel`, `_namespace`            | a publication is FOR ALL TABLES, names a payroll table, or publishes the `public` schema                       |
 * | `payroll-foreign-table`         | `pg_foreign_table`                                | a foreign table wears a payroll name or its options name a payroll table                                       |
 * | `dependent-on-payroll`          | `pg_depend` over policies, constraints, defaults, indexes, statistics, columns of a row type | such an object sits on a non-family table and depends on a payroll relation, function or row type |
 *
 * Findings of the first four function codes are about objects that exist; the
 * check makes no judgement about intent. The fix is always the same: name the
 * object in the payroll family, or do not create it.
 *
 * ## What it cannot see
 *
 * - A one-shot data copy (`INSERT ... SELECT`, `SELECT ... INTO`, `CREATE TABLE
 *   AS`) run by a migration and left no object behind: no dependency exists to
 *   read. That is the static layer's job (`payroll-sql-boundary-check.ts`), for
 *   the names it can resolve.
 * - Objects in an extension.
 * - A superuser (it bypasses every grant and every policy by definition), and a
 *   role with `BYPASSRLS`.
 * - A trigger WHEN clause or a rule that depends on a payroll object through an
 *   object class `pg_depend` does not record for it.
 * - `NO FORCE` / `DISABLE ROW LEVEL SECURITY` on a payroll table (other RLS
 *   gates own those).
 *
 * Audit hardening of #1077 added `payroll-trigger-missing` (required triggers),
 * `payroll-named-object-outside` (a family-named index, constraint, policy or
 * trigger on a non-family relation), `payroll-role-bypass` (a runtime role with
 * BYPASSRLS), members of `pg_read_all_data`/`pg_write_all_data`/`pg_maintain` and
 * of superuser or BYPASSRLS roles, the migration-ledger owner as the expected
 * owner, and domain CHECK constraints in the dependency sweep.
 *
 * Second audit added `payroll-trigger-disabled` (a required trigger with
 * `tgenabled <> 'O'`), `payroll-fk-missing` (a required foreign key between
 * payroll tables is gone), `payroll-lookalike` (a non-family relation sharing 70%
 * of a required table's columns) and `payroll-ledger-missing` (no migration
 * ledger and no PAYROLL_EXPECTED_OWNERS: fail closed).
 *
 * The model, stated honestly: this check and the static scan are defence in
 * depth against accidental and obvious leaks, and DETECT what a determined
 * author of a reviewed migration leaves behind; they do not prevent it. Review
 * of every `sql/` change touching payroll remains the primary control. A
 * non-family table with RLS off that is granted to the worker or PUBLIC is not
 * flagged in general (too many legitimate global tables).
 *
 * NARROWED, not closed: a determined reviewed migration can still rebuild a
 * payroll table behind constructs the text layer does not model (this layer then
 * DETECTS the leftovers, it does not prevent them); logical replication SLOTS are
 * not read; a superuser is trusted by definition.
 *
 * Closed by #1077 and no longer a limit: policies, CHECK and FOREIGN KEY
 * constraints, column defaults and index expressions (`dependent-on-payroll`),
 * privileges held through role membership, relation ownership, publications and
 * foreign tables.
 *
 * Pure analysis plus one loader. The loader takes any Bun.SQL-shaped tagged
 * template, so the same code runs in the integration test (inside a transaction
 * it rolls back, to plant a probe) and in `payroll:catalog-boundary:check`.
 */
import {
  PAYROLL_ALLOWED_GRANTEES,
  PAYROLL_ALLOWED_ROLE_MEMBERS,
  PAYROLL_BOUNDARY_MARKER,
  PAYROLL_CATALOG_EXEMPTIONS,
  PAYROLL_EXPECTED_OWNERS,
  PAYROLL_FORBIDDEN_OWNERS,
  PAYROLL_INDIRECT_READ_PATTERN,
  PAYROLL_LOOKALIKE_COLUMN_SHARE,
  PAYROLL_LOOKALIKE_MIN_COLUMNS,
  PAYROLL_OWNER_REFERENCE_TABLE,
  PAYROLL_PRIVILEGED_PREDEFINED_ROLES,
  PAYROLL_PUBLICATION_EXEMPTIONS,
  PAYROLL_READABLE_LANGUAGES,
  PAYROLL_REQUIRED_FOREIGN_KEYS,
  PAYROLL_REQUIRED_TABLES,
  PAYROLL_REQUIRED_TRIGGERS,
  PAYROLL_WORKER_EXECUTE_ALLOWLIST,
  PAYROLL_WORKER_ROLES,
  PAYROLL_WORKER_SCALAR_RETURN_TYPES,
  isPayrollTable
} from "../../src/modules/_shared/payroll-data-boundary";

/** `schema.name`, both unquoted and as stored (lower case unless quoted at creation). */
type Qualified = string;

export type CatalogRule = {
  relation: Qualified;
  /** `pg_class.relkind`: r table, v view, m materialised view, p partitioned table, f foreign table. */
  relkind: string;
  rule: string;
  /** `pg_rewrite.ev_type`: 1 is the SELECT rule a view is made of; 2/3/4 are user rules. */
  eventType: string;
  dependsOnRelations: Qualified[];
  dependsOnFunctions: Qualified[];
};

export type CatalogFunction = {
  name: Qualified;
  language: string;
  securityDefiner: boolean;
  returnsTrigger: boolean;
  /** `proretset`: returns a set of rows. */
  returnsSet: boolean;
  /** `prorettype::regtype`, e.g. `bigint`, `jsonb`, `trigger`. */
  returnType: string;
  owner: string;
  source: string;
  /** Relations whose row type appears in the signature (return or argument, array element included). */
  rowTypeRelations: Qualified[];
  /** Relations the function depends on in `pg_depend` (SQL-standard `BEGIN ATOMIC` bodies record them). */
  dependsOnRelations: Qualified[];
  executeGrantees: string[];
};

export type CatalogTrigger = {
  relation: Qualified;
  name: string;
  function: Qualified;
  /** `pg_trigger.tgenabled`: `O` fires, `D` disabled, `R` replica only, `A` always. */
  enabled?: string;
};

export type CatalogGrant = {
  relation: Qualified;
  owner: string;
  grantee: string;
  privilege: string;
  column: string | null;
};

export type CatalogInheritance = { parent: Qualified; child: Qualified };

/** A table, view, materialised view, partitioned or foreign table, with its owner and `COMMENT`. */
export type CatalogRelation = {
  name: Qualified;
  relkind: string;
  owner: string;
  comment: string | null;
};

/** `member` inherits the privileges of `role` (`pg_auth_members`). */
export type CatalogMembership = { role: string; member: string };

export type CatalogPublication = {
  name: string;
  allTables: boolean;
  relations: Qualified[];
  /** Schemas published whole (`FOR TABLES IN SCHEMA`, PostgreSQL 15+). */
  schemas: string[];
};

export type CatalogForeignTable = {
  name: Qualified;
  owner: string;
  /** `ftoptions` and the server's `srvoptions`, as `key=value` text. */
  options: string;
};

/**
 * A non-trigger, non-rule, non-function object that depends on a relation, a
 * function or a row type (Issue #1077, M6): a policy, a CHECK or FOREIGN KEY
 * constraint, a column default, an index expression, a column of a row type.
 * `relation` is the table the object belongs to, which is what decides whether
 * it is inside the family.
 */
export type CatalogDependency = {
  kind: string;
  object: string;
  relation: Qualified;
  referenced: Qualified;
};

/** A role as `pg_roles` has it (Issue #1077 audit, M4). */
export type CatalogRole = {
  name: string;
  superuser: boolean;
  bypassRls: boolean;
};

/** An index, constraint or policy, with the relation it sits on (Issue #1077 audit, H1). */
export type CatalogNamedObject = {
  kind: string;
  name: string;
  relation: Qualified;
};

/** The columns of a relation, `name:type`, in order (Issue #1077 audit, HIGH-1). */
export type CatalogColumns = { relation: Qualified; columns: string[] };

/** A foreign key between two relations. */
export type CatalogForeignKey = { from: Qualified; to: Qualified };

export type CatalogSnapshot = {
  columns: CatalogColumns[];
  foreignKeys: CatalogForeignKey[];
  /** Owner of the migration ledger: the role that ran the migrations, or null when unknown. */
  migrationOwner: string | null;
  roles: CatalogRole[];
  namedObjects: CatalogNamedObject[];
  rules: CatalogRule[];
  functions: CatalogFunction[];
  triggers: CatalogTrigger[];
  grants: CatalogGrant[];
  inheritance: CatalogInheritance[];
  relations: CatalogRelation[];
  memberships: CatalogMembership[];
  publications: CatalogPublication[];
  foreignTables: CatalogForeignTable[];
  dependencies: CatalogDependency[];
};

export type CatalogFinding = {
  code: string;
  object: Qualified;
  message: string;
};

type SqlTag = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => PromiseLike<unknown[]>;

/** Read the catalog. Every object outside the system schemas and outside extensions. */
export async function loadPayrollCatalogSnapshot(
  sql: SqlTag
): Promise<CatalogSnapshot> {
  const rules = (await sql`
    SELECT cn.nspname || '.' || c.relname AS relation,
           c.relkind::text AS relkind,
           r.rulename::text AS rule,
           r.ev_type::text AS event_type,
           COALESCE(
             jsonb_agg(DISTINCT dn.nspname || '.' || dc.relname)
               FILTER (WHERE dc.oid IS NOT NULL AND dc.oid <> c.oid),
             '[]'::jsonb
           ) AS depends_on_relations,
           COALESCE(
             jsonb_agg(DISTINCT pn.nspname || '.' || dp.proname)
               FILTER (WHERE dp.oid IS NOT NULL),
             '[]'::jsonb
           ) AS depends_on_functions
    FROM pg_rewrite r
    JOIN pg_class c ON c.oid = r.ev_class
    JOIN pg_namespace cn ON cn.oid = c.relnamespace
    JOIN pg_depend d
      ON d.classid = 'pg_rewrite'::regclass AND d.objid = r.oid
    LEFT JOIN pg_class dc
      ON d.refclassid = 'pg_class'::regclass AND dc.oid = d.refobjid
    LEFT JOIN pg_namespace dn ON dn.oid = dc.relnamespace
    LEFT JOIN pg_proc dp
      ON d.refclassid = 'pg_proc'::regclass AND dp.oid = d.refobjid
    LEFT JOIN pg_namespace pn ON pn.oid = dp.pronamespace
    WHERE cn.nspname NOT IN ('pg_catalog', 'information_schema')
      AND cn.nspname !~ '^pg_(toast|temp)'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend e
        WHERE e.classid = 'pg_class'::regclass AND e.objid = c.oid
          AND e.deptype = 'e'
      )
    GROUP BY cn.nspname, c.relname, c.relkind, c.oid, r.rulename, r.ev_type
  `) as {
    relation: string;
    relkind: string;
    rule: string;
    event_type: string;
    depends_on_relations: string[];
    depends_on_functions: string[];
  }[];

  const functions = (await sql`
    SELECT n.nspname || '.' || p.proname AS name,
           l.lanname::text AS language,
           p.prosecdef AS security_definer,
           (p.prorettype = 'pg_catalog.trigger'::regtype) AS returns_trigger,
           p.proretset AS returns_set,
           p.prorettype::regtype::text AS return_type,
           pg_get_userbyid(p.proowner)::text AS owner,
           CASE WHEN l.lanname IN ('sql', 'plpgsql') THEN p.prosrc ELSE '' END AS source,
           COALESCE((
             SELECT jsonb_agg(DISTINCT rn.nspname || '.' || rc.relname)
             FROM unnest(
               COALESCE(p.proallargtypes, p.proargtypes::oid[]) || p.prorettype
             ) AS a(type_oid)
             JOIN pg_type ty ON ty.oid = a.type_oid
             JOIN pg_type et
               ON et.oid = CASE WHEN ty.typcategory = 'A' THEN ty.typelem ELSE ty.oid END
             JOIN pg_class rc
               ON rc.oid = et.typrelid AND rc.relkind IN ('r', 'p', 'v', 'm', 'f')
             JOIN pg_namespace rn ON rn.oid = rc.relnamespace
           ), '[]'::jsonb) AS row_type_relations,
           COALESCE((
             SELECT jsonb_agg(DISTINCT dn.nspname || '.' || dc.relname)
             FROM pg_depend d
             JOIN pg_class dc ON dc.oid = d.refobjid
             JOIN pg_namespace dn ON dn.oid = dc.relnamespace
             WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
               AND d.refclassid = 'pg_class'::regclass
           ), '[]'::jsonb) AS depends_on_relations,
           COALESCE((
             SELECT jsonb_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END)
             FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
             WHERE a.privilege_type = 'EXECUTE'
           ), '[]'::jsonb) AS execute_grantees
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname !~ '^pg_(toast|temp)'
      AND p.prokind <> 'a'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend e
        WHERE e.classid = 'pg_proc'::regclass AND e.objid = p.oid
          AND e.deptype = 'e'
      )
  `) as {
    name: string;
    language: string;
    security_definer: boolean;
    returns_trigger: boolean;
    returns_set: boolean;
    return_type: string;
    owner: string;
    source: string;
    row_type_relations: string[];
    depends_on_relations: string[];
    execute_grantees: string[];
  }[];

  const triggers = (await sql`
    SELECT cn.nspname || '.' || c.relname AS relation,
           t.tgname::text AS name,
           fn.nspname || '.' || p.proname AS function,
           t.tgenabled::text AS enabled
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace cn ON cn.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace fn ON fn.oid = p.pronamespace
    WHERE NOT t.tgisinternal
      AND cn.nspname NOT IN ('pg_catalog', 'information_schema')
  `) as {
    relation: string;
    name: string;
    function: string;
    enabled: string;
  }[];

  const grants = (await sql`
    SELECT cn.nspname || '.' || c.relname AS relation,
           pg_get_userbyid(c.relowner)::text AS owner,
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END AS grantee,
           a.privilege_type::text AS privilege,
           NULL::text AS "column"
    FROM pg_class c
    JOIN pg_namespace cn ON cn.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND cn.nspname NOT IN ('pg_catalog', 'information_schema')
    UNION ALL
    SELECT cn.nspname || '.' || c.relname,
           pg_get_userbyid(c.relowner)::text,
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
           a.privilege_type::text,
           at.attname::text
    FROM pg_attribute at
    JOIN pg_class c ON c.oid = at.attrelid
    JOIN pg_namespace cn ON cn.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(at.attacl) a
    WHERE at.attacl IS NOT NULL AND NOT at.attisdropped
      AND cn.nspname NOT IN ('pg_catalog', 'information_schema')
  `) as {
    relation: string;
    owner: string;
    grantee: string;
    privilege: string;
    column: string | null;
  }[];

  const inheritance = (await sql`
    SELECT pn.nspname || '.' || parent.relname AS parent,
           cn.nspname || '.' || child.relname AS child
    FROM pg_inherits i
    JOIN pg_class parent ON parent.oid = i.inhparent
    JOIN pg_namespace pn ON pn.oid = parent.relnamespace
    JOIN pg_class child ON child.oid = i.inhrelid
    JOIN pg_namespace cn ON cn.oid = child.relnamespace
  `) as { parent: string; child: string }[];

  const relations = (await sql`
    SELECT n.nspname || '.' || c.relname AS name,
           c.relkind::text AS relkind,
           pg_get_userbyid(c.relowner)::text AS owner,
           obj_description(c.oid, 'pg_class') AS comment
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname !~ '^pg_(toast|temp)'
  `) as {
    name: string;
    relkind: string;
    owner: string;
    comment: string | null;
  }[];

  const roles = (await sql`
    SELECT rolname::text AS name, rolsuper AS superuser, rolbypassrls AS bypass_rls
    FROM pg_roles
  `) as { name: string; superuser: boolean; bypass_rls: boolean }[];

  const namedObjects = (await sql`
    SELECT 'index' AS kind, i.relname::text AS name, n.nspname || '.' || c.relname AS relation
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class c ON c.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    UNION ALL
    SELECT 'constraint', con.conname::text, n.nspname || '.' || c.relname
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    UNION ALL
    SELECT 'policy', pol.polname::text, n.nspname || '.' || c.relname
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
  `) as { kind: string; name: string; relation: string }[];

  const columns = (await sql`
    SELECT n.nspname || '.' || c.relname AS relation,
           array_agg(a.attname::text || ':' || format_type(a.atttypid, NULL)
                     ORDER BY a.attnum) AS columns
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname !~ '^pg_(toast|temp)'
    GROUP BY n.nspname, c.relname
  `) as { relation: string; columns: string[] }[];

  const foreignKeys = (await sql`
    SELECT fn.nspname || '.' || f.relname AS "from",
           tn.nspname || '.' || t.relname AS "to"
    FROM pg_constraint con
    JOIN pg_class f ON f.oid = con.conrelid
    JOIN pg_namespace fn ON fn.oid = f.relnamespace
    JOIN pg_class t ON t.oid = con.confrelid
    JOIN pg_namespace tn ON tn.oid = t.relnamespace
    WHERE con.contype = 'f'
  `) as { from: string; to: string }[];

  const migrationOwnerRows = (await sql`
    SELECT pg_get_userbyid(c.relowner)::text AS owner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ${PAYROLL_OWNER_REFERENCE_TABLE}
  `) as { owner: string }[];

  const memberships = (await sql`
    SELECT pg_get_userbyid(roleid)::text AS role,
           pg_get_userbyid(member)::text AS member
    FROM pg_auth_members
  `) as { role: string; member: string }[];

  const publicationRows = (await sql`
    SELECT p.pubname::text AS name,
           p.puballtables AS all_tables,
           COALESCE(
             jsonb_agg(n.nspname || '.' || c.relname)
               FILTER (WHERE c.oid IS NOT NULL),
             '[]'::jsonb
           ) AS relations
    FROM pg_publication p
    LEFT JOIN pg_publication_rel pr ON pr.prpubid = p.oid
    LEFT JOIN pg_class c ON c.oid = pr.prrelid
    LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
    GROUP BY p.oid, p.pubname, p.puballtables
  `) as { name: string; all_tables: boolean; relations: string[] }[];

  // `FOR TABLES IN SCHEMA` exists from PostgreSQL 15; the catalog is absent before.
  const hasPublicationSchemas = (
    (await sql`
      SELECT to_regclass('pg_catalog.pg_publication_namespace') IS NOT NULL AS present
    `) as { present: boolean }[]
  )[0]?.present;
  const publicationSchemas = hasPublicationSchemas
    ? ((await sql`
        SELECT p.pubname::text AS name, n.nspname::text AS schema
        FROM pg_publication_namespace pn
        JOIN pg_publication p ON p.oid = pn.pnpubid
        JOIN pg_namespace n ON n.oid = pn.pnnspid
      `) as { name: string; schema: string }[])
    : [];

  const foreignTables = (await sql`
    SELECT n.nspname || '.' || c.relname AS name,
           pg_get_userbyid(c.relowner)::text AS owner,
           COALESCE(array_to_string(ft.ftoptions, ' '), '') || ' ' ||
             COALESCE(array_to_string(s.srvoptions, ' '), '') AS options
    FROM pg_foreign_table ft
    JOIN pg_class c ON c.oid = ft.ftrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_foreign_server s ON s.oid = ft.ftserver
  `) as { name: string; owner: string; options: string }[];

  // Policies, CHECK / FOREIGN KEY constraints, column defaults, index
  // expressions, statistics and columns of a row type that depend on a relation,
  // function or row type in `public` (the only schema the family lives in). Which
  // of them reach a PAYROLL object is decided in TypeScript, from the one
  // definition of the family (`isPayrollTable`).
  const dependencies = (await sql`
    SELECT x.kind, x.object, x.relation,
           COALESCE(
             rn.nspname || '.' || rc.relname,
             pn.nspname || '.' || rp.proname,
             tn.nspname || '.' || tc.relname
           ) AS referenced
    FROM (
      SELECT 'policy' AS kind, pol.polname::text AS object,
             cn.nspname || '.' || c.relname AS relation,
             d.refclassid, d.refobjid
      FROM pg_depend d
      JOIN pg_policy pol ON d.classid = 'pg_policy'::regclass AND pol.oid = d.objid
      JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace cn ON cn.oid = c.relnamespace
      WHERE d.deptype = 'n'
      UNION ALL
      SELECT 'constraint', con.conname::text, cn.nspname || '.' || c.relname,
             d.refclassid, d.refobjid
      FROM pg_depend d
      JOIN pg_constraint con ON d.classid = 'pg_constraint'::regclass AND con.oid = d.objid
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace cn ON cn.oid = c.relnamespace
      WHERE d.deptype = 'n'
      UNION ALL
      SELECT 'domain-constraint', con.conname::text, tn.nspname || '.' || t.typname,
             d.refclassid, d.refobjid
      FROM pg_depend d
      JOIN pg_constraint con ON d.classid = 'pg_constraint'::regclass AND con.oid = d.objid
        AND con.conrelid = 0 AND con.contypid <> 0
      JOIN pg_type t ON t.oid = con.contypid
      JOIN pg_namespace tn ON tn.oid = t.typnamespace
      WHERE d.deptype = 'n'
      UNION ALL
      SELECT 'column-default', a.attname::text, cn.nspname || '.' || c.relname,
             d.refclassid, d.refobjid
      FROM pg_depend d
      JOIN pg_attrdef ad ON d.classid = 'pg_attrdef'::regclass AND ad.oid = d.objid
      JOIN pg_class c ON c.oid = ad.adrelid
      JOIN pg_namespace cn ON cn.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
      WHERE d.deptype = 'n'
      UNION ALL
      SELECT 'index', i.relname::text, cn.nspname || '.' || c.relname,
             d.refclassid, d.refobjid
      FROM pg_depend d
      JOIN pg_class i ON d.classid = 'pg_class'::regclass AND i.oid = d.objid
        AND i.relkind IN ('i', 'I') AND d.objsubid = 0
      JOIN pg_index ix ON ix.indexrelid = i.oid
      JOIN pg_class c ON c.oid = ix.indrelid
      JOIN pg_namespace cn ON cn.oid = c.relnamespace
      WHERE d.deptype = 'n'
      UNION ALL
      SELECT 'statistics', se.stxname::text, cn.nspname || '.' || c.relname,
             d.refclassid, d.refobjid
      FROM pg_depend d
      JOIN pg_statistic_ext se ON d.classid = 'pg_statistic_ext'::regclass AND se.oid = d.objid
      JOIN pg_class c ON c.oid = se.stxrelid
      JOIN pg_namespace cn ON cn.oid = c.relnamespace
      WHERE d.deptype = 'n'
      UNION ALL
      SELECT 'column-type', a.attname::text, cn.nspname || '.' || c.relname,
             d.refclassid, d.refobjid
      FROM pg_depend d
      JOIN pg_class c ON d.classid = 'pg_class'::regclass AND c.oid = d.objid
        AND c.relkind IN ('r', 'p', 'f') AND d.objsubid > 0
      JOIN pg_namespace cn ON cn.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid
      WHERE d.deptype = 'n'
    ) x
    LEFT JOIN pg_class rc
      ON x.refclassid = 'pg_class'::regclass AND rc.oid = x.refobjid
    LEFT JOIN pg_namespace rn ON rn.oid = rc.relnamespace
    LEFT JOIN pg_proc rp
      ON x.refclassid = 'pg_proc'::regclass AND rp.oid = x.refobjid
    LEFT JOIN pg_namespace pn ON pn.oid = rp.pronamespace
    LEFT JOIN pg_type rt
      ON x.refclassid = 'pg_type'::regclass AND rt.oid = x.refobjid
    LEFT JOIN pg_type et
      ON et.oid = CASE WHEN rt.typcategory = 'A' THEN rt.typelem ELSE rt.oid END
    LEFT JOIN pg_class tc ON tc.oid = et.typrelid AND tc.relkind IN ('r', 'p', 'v', 'm', 'f')
    LEFT JOIN pg_namespace tn ON tn.oid = tc.relnamespace
    WHERE COALESCE(
            rn.nspname || '.' || rc.relname,
            pn.nspname || '.' || rp.proname,
            tn.nspname || '.' || tc.relname
          ) LIKE 'public.%'
      AND x.relation <> COALESCE(
            rn.nspname || '.' || rc.relname,
            tn.nspname || '.' || tc.relname,
            ''
          )
  `) as {
    kind: string;
    object: string;
    relation: string;
    referenced: string;
  }[];

  return {
    columns,
    foreignKeys,
    migrationOwner: migrationOwnerRows[0]?.owner ?? null,
    roles: roles.map((row) => ({
      name: row.name,
      superuser: row.superuser,
      bypassRls: row.bypass_rls
    })),
    namedObjects,
    relations,
    memberships,
    foreignTables,
    dependencies,
    publications: publicationRows.map((row) => ({
      name: row.name,
      allTables: row.all_tables,
      relations: row.relations,
      schemas: publicationSchemas
        .filter((entry) => entry.name === row.name)
        .map((entry) => entry.schema)
    })),
    rules: rules.map((row) => ({
      relation: row.relation,
      relkind: row.relkind,
      rule: row.rule,
      eventType: row.event_type,
      dependsOnRelations: row.depends_on_relations,
      dependsOnFunctions: row.depends_on_functions
    })),
    functions: functions.map((row) => ({
      name: row.name,
      language: row.language,
      securityDefiner: row.security_definer,
      returnsTrigger: row.returns_trigger,
      returnsSet: row.returns_set,
      returnType: row.return_type,
      owner: row.owner,
      source: row.source,
      rowTypeRelations: row.row_type_relations,
      dependsOnRelations: row.depends_on_relations,
      executeGrantees: row.execute_grantees
    })),
    triggers,
    grants,
    inheritance
  };
}

/**
 * Family membership by qualified name. Only `public` carries payroll tables, so
 * a payroll-LOOKING name in another schema is not family: it is an object that
 * borrowed a name, and it fails the boundary exactly like any other.
 */
export function isPayrollFamily(qualified: Qualified): boolean {
  const dot = qualified.indexOf(".");

  return (
    qualified.slice(0, dot) === "public" &&
    isPayrollTable(qualified.slice(dot + 1))
  );
}

const TABLE_TOKEN = /\bawcms_[a-z0-9_]+\b/gi;

/** A body without comments, string-concatenation seams, or quoting. */
function normaliseBody(source: string): string {
  let text = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  let previous: string;

  do {
    previous = text;
    text = text.replace(
      /'((?:[^']|'')*)'\s*\|\|\s*'((?:[^']|'')*)'/g,
      "'$1$2'"
    );
  } while (text !== previous);

  return text;
}

function payrollTokens(body: string): string[] {
  return [
    ...new Set(
      [...body.matchAll(TABLE_TOKEN)]
        .map((match) => match[0].toLowerCase())
        .filter((token) => isPayrollTable(token))
    )
  ];
}

function bare(qualified: Qualified): string {
  return qualified.slice(qualified.indexOf(".") + 1);
}

function calls(body: string, qualified: Qualified): boolean {
  const name = bare(qualified).replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");

  // `name(`, `"name"(`, `public."name"(` and `public . name (` are all calls.
  return new RegExp(`(?<![\\w$])"?${name}"?\\s*\\(`, "i").test(body);
}

export type AnalyseOptions = {
  allowedGrantees?: readonly string[];
  workerRoles?: readonly string[];
  workerExecuteAllowlist?: readonly string[];
  exemptions?: Readonly<Record<string, string>>;
  requiredTables?: readonly string[];
  forbiddenOwners?: readonly string[];
  allowedRoleMembers?: readonly string[];
  publicationExemptions?: Readonly<Record<string, string>>;
  requiredTriggers?: Readonly<Record<string, readonly string[]>>;
  expectedOwners?: readonly string[];
  privilegedRoles?: readonly string[];
};

export function analysePayrollCatalog(
  snapshot: CatalogSnapshot,
  options: AnalyseOptions = {}
): CatalogFinding[] {
  const allowed = options.allowedGrantees ?? PAYROLL_ALLOWED_GRANTEES;
  const workers = options.workerRoles ?? PAYROLL_WORKER_ROLES;
  const workerAllowlist =
    options.workerExecuteAllowlist ?? PAYROLL_WORKER_EXECUTE_ALLOWLIST;
  const exemptions = options.exemptions ?? PAYROLL_CATALOG_EXEMPTIONS;
  const requiredTables = options.requiredTables ?? PAYROLL_REQUIRED_TABLES;
  const forbiddenOwners = options.forbiddenOwners ?? PAYROLL_FORBIDDEN_OWNERS;
  const allowedMembers =
    options.allowedRoleMembers ?? PAYROLL_ALLOWED_ROLE_MEMBERS;
  const publicationExemptions =
    options.publicationExemptions ?? PAYROLL_PUBLICATION_EXEMPTIONS;
  const requiredTriggers =
    options.requiredTriggers ?? PAYROLL_REQUIRED_TRIGGERS;
  const expectedOwners = options.expectedOwners ?? PAYROLL_EXPECTED_OWNERS;
  const privilegedRoles =
    options.privilegedRoles ?? PAYROLL_PRIVILEGED_PREDEFINED_ROLES;
  const findings: CatalogFinding[] = [];
  const add = (code: string, object: Qualified, message: string): void => {
    findings.push({ code, object, message });
  };

  const familyFunctions = snapshot.functions.filter((fn) =>
    isPayrollFamily(fn.name)
  );
  const outside = snapshot.functions.filter((fn) => !isPayrollFamily(fn.name));
  const flagged = new Set<Qualified>();

  for (const fn of outside) {
    const body = normaliseBody(fn.source);
    const rowTypes = fn.rowTypeRelations.filter(isPayrollFamily);
    const depends = fn.dependsOnRelations.filter(isPayrollFamily);
    // A payroll FUNCTION's name looks like a payroll table's; calling one is
    // its own finding (below), not a read of a table.
    const named = payrollTokens(body).filter(
      (token) => !familyFunctions.some((family) => bare(family.name) === token)
    );

    if (rowTypes.length > 0 || depends.length > 0) {
      add(
        "function-payroll-row-type",
        fn.name,
        `${fn.name}${fn.securityDefiner ? " (SECURITY DEFINER)" : ""} returns, takes or depends on the row type of ${[...rowTypes, ...depends].join(", ")} but is not itself a payroll function. A SETOF payroll-row function hands every row to its caller${fn.securityDefiner ? " with the owner's rights, past RLS" : ""}.`
      );
      flagged.add(fn.name);
    }

    if (named.length > 0) {
      add(
        "function-reads-payroll",
        fn.name,
        `${fn.name} names ${named.join(", ")} in its body but is not itself a payroll function.`
      );
      flagged.add(fn.name);
    }

    const through = familyFunctions
      .filter((family) => calls(body, family.name))
      .map((family) => family.name);

    if (through.length > 0) {
      add(
        "function-calls-payroll-function",
        fn.name,
        `${fn.name} calls the payroll function ${through.join(", ")} but is not itself a payroll function.`
      );
      flagged.add(fn.name);
    }

    if (
      fn.language === "plpgsql" &&
      /(?<![\w$])EXECUTE\s+(?!FUNCTION\b|PROCEDURE\b)/i.test(body)
    ) {
      add(
        "function-dynamic-sql",
        fn.name,
        `${fn.name} runs dynamic SQL (EXECUTE) and is not a payroll function. The relation it touches is a string built at run time; no scan can hold it to the rule, so it may not exist outside the payroll family.`
      );
      flagged.add(fn.name);
    }

    // A SECURITY DEFINER body that reads a relation named by a string or an OID
    // never has to spell the table (Issue #1077, M2).
    if (fn.securityDefiner && PAYROLL_INDIRECT_READ_PATTERN.test(body)) {
      add(
        "function-indirect-read",
        fn.name,
        `${fn.name} is SECURITY DEFINER outside the payroll family and uses a helper that reads a relation named by a string or an OID (schema_to_xml, query_to_xml, table_to_xml, regclass, format(), ts_stat, dblink, U&"..."). Its body never needs to name the table, so no scan can hold it to the rule. Name it in the payroll family, or list it in PAYROLL_CATALOG_EXEMPTIONS with the reason.`
      );
      flagged.add(fn.name);
    }
  }

  // A function in a language whose body the catalog layer cannot read (C,
  // plperl, plpython...) is invisible to every check above (Issue #1077, info).
  for (const fn of snapshot.functions) {
    if (!PAYROLL_READABLE_LANGUAGES.includes(fn.language)) {
      add(
        "function-opaque-language",
        fn.name,
        `${fn.name} is written in ${fn.language}, a language whose body the payroll boundary cannot read. Rewrite it in sql or plpgsql, or list it in PAYROLL_CATALOG_EXEMPTIONS with the reason.`
      );
    }
  }

  // Transitive closure: f1 -> f2 -> payroll leaves f2 with a direct finding and
  // f1 with none of its own, but f1 reaches payroll all the same.
  for (let changed = true; changed;) {
    changed = false;

    for (const fn of outside) {
      if (flagged.has(fn.name)) continue;

      const body = normaliseBody(fn.source);
      const callee = [...flagged].find(
        (name) => name !== fn.name && calls(body, name)
      );

      if (callee) {
        add(
          "function-chain",
          fn.name,
          `${fn.name} calls ${callee}, which reaches payroll, but is not itself a payroll function.`
        );
        flagged.add(fn.name);
        changed = true;
      }
    }
  }

  for (const fn of familyFunctions) {
    if (!fn.securityDefiner || fn.returnsTrigger) continue;

    // The worker may run a COUNT, never a row: allow-listed by name, not a
    // set, a scalar integer/boolean result, no payroll row type in the signature.
    const workerMayExecute =
      workerAllowlist.includes(bare(fn.name)) &&
      !fn.returnsSet &&
      PAYROLL_WORKER_SCALAR_RETURN_TYPES.includes(fn.returnType) &&
      !fn.rowTypeRelations.some(isPayrollFamily);
    const wide = fn.executeGrantees.filter(
      (grantee) =>
        grantee !== fn.owner &&
        !allowed.includes(grantee) &&
        !(workers.includes(grantee) && workerMayExecute)
    );

    if (wide.length > 0) {
      add(
        "payroll-grant",
        fn.name,
        `${fn.name} is SECURITY DEFINER in the payroll family and EXECUTE is granted to ${wide.join(", ")} (allowed: ${allowed.join(", ")}; a worker role only on an allow-listed, non-set function returning ${PAYROLL_WORKER_SCALAR_RETURN_TYPES.join("/")} with no payroll row type in its signature: PAYROLL_WORKER_EXECUTE_ALLOWLIST). REVOKE ... FROM PUBLIC and grant only the request role.`
      );
    }
  }

  for (const rule of snapshot.rules) {
    const onFamily = isPayrollFamily(rule.relation);
    const payrollDeps = [
      ...rule.dependsOnRelations.filter(isPayrollFamily),
      ...rule.dependsOnFunctions.filter(isPayrollFamily)
    ];
    const leakingFunctions = rule.dependsOnFunctions.filter((name) =>
      flagged.has(name)
    );
    const kind =
      rule.relkind === "v"
        ? "view"
        : rule.relkind === "m"
          ? "materialised view"
          : `rule ${rule.rule} on`;

    if (!onFamily && payrollDeps.length > 0) {
      add(
        "relation-over-payroll",
        rule.relation,
        `${kind} ${rule.relation} depends on ${payrollDeps.join(", ")} but is not itself a payroll relation.`
      );
    }

    if (!onFamily && leakingFunctions.length > 0) {
      add(
        "relation-over-leaking-function",
        rule.relation,
        `${kind} ${rule.relation} reads through ${leakingFunctions.join(", ")}, which hands out payroll rows and is not a payroll function.`
      );
    }

    // The SELECT rule of a payroll VIEW may join anything; a user rule
    // (INSERT/UPDATE/DELETE) on a payroll relation may not push rows out.
    if (onFamily && rule.eventType !== "1") {
      const writes = rule.dependsOnRelations.filter(
        (name) => !isPayrollFamily(name)
      );

      if (writes.length > 0) {
        add(
          "payroll-rule-writes-outside",
          rule.relation,
          `rule ${rule.rule} on payroll relation ${rule.relation} depends on ${writes.join(", ")}, which is not a payroll relation. A rule can copy NEW/OLD into an ordinary table without ever naming the payroll table.`
        );
      }
    }
  }

  for (const trigger of snapshot.triggers) {
    const onFamily = isPayrollFamily(trigger.relation);
    const fnFamily = isPayrollFamily(trigger.function);

    if (onFamily && !fnFamily) {
      add(
        "trigger-foreign-function",
        `${trigger.relation}.${trigger.name}`,
        `trigger ${trigger.name} on payroll relation ${trigger.relation} runs ${trigger.function}, which is not a payroll function. Its body sees NEW and OLD without naming the table, so it can copy a payroll row anywhere.`
      );
    } else if (!onFamily && fnFamily) {
      add(
        "trigger-foreign-function",
        `${trigger.relation}.${trigger.name}`,
        `trigger ${trigger.name} on ${trigger.relation} runs the payroll function ${trigger.function}. A table that is not itself payroll must not carry payroll side effects.`
      );
    } else if (!onFamily && flagged.has(trigger.function)) {
      add(
        "trigger-foreign-function",
        `${trigger.relation}.${trigger.name}`,
        `trigger ${trigger.name} on ${trigger.relation} runs ${trigger.function}, which reaches payroll.`
      );
    }
  }

  for (const grant of snapshot.grants) {
    if (!isPayrollFamily(grant.relation)) continue;
    if (grant.grantee === grant.owner || allowed.includes(grant.grantee)) {
      continue;
    }

    add(
      "payroll-grant",
      grant.relation,
      `${grant.privilege}${grant.column ? ` (${grant.column})` : ""} on ${grant.relation} is granted to ${grant.grantee}, which is not a payroll role (allowed: ${allowed.join(", ")}).`
    );
  }

  for (const edge of snapshot.inheritance) {
    if (isPayrollFamily(edge.parent) !== isPayrollFamily(edge.child)) {
      add(
        "inheritance-crosses-boundary",
        edge.child,
        `${edge.child} inherits from ${edge.parent}; one is a payroll relation and the other is not, so a SELECT on the parent returns the child's rows.`
      );
    }
  }

  // M1: the family is a NAME. The marker on the table and the required-table
  // manifest are what survive a rename (Issue #1077).
  const marked = (relation: CatalogRelation): boolean =>
    relation.comment !== null &&
    relation.comment.startsWith(PAYROLL_BOUNDARY_MARKER);

  for (const relation of snapshot.relations) {
    if (marked(relation) && !isPayrollFamily(relation.name)) {
      add(
        "payroll-marker-outside-family",
        relation.name,
        `${relation.name} is marked '${PAYROLL_BOUNDARY_MARKER}' but its name is not in the payroll family: a payroll table was renamed (or moved to another schema) out of the boundary. Rename it back.`
      );
    }

    const isTable = relation.relkind === "r" || relation.relkind === "p";

    if (isPayrollFamily(relation.name) && isTable && !marked(relation)) {
      add(
        "payroll-marker-missing",
        relation.name,
        `${relation.name} is a payroll-family table without the '${PAYROLL_BOUNDARY_MARKER}' comment. COMMENT ON TABLE it, so a later rename cannot take it out of the boundary unseen.`
      );
    }
  }

  for (const table of requiredTables) {
    const relation = snapshot.relations.find(
      (entry) => entry.name === `public.${table}`
    );

    if (!relation || (relation.relkind !== "r" && relation.relkind !== "p")) {
      add(
        "payroll-table-missing",
        `public.${table}`,
        `public.${table} is a required payroll table and is not a table in the catalog: it was renamed, moved or dropped. If that is intended, change PAYROLL_REQUIRED_TABLES in the same PR.`
      );
    }
  }

  // The owner must be the role that ran the migrations (owner of the migration
  // ledger, read from the catalog) or one named in PAYROLL_EXPECTED_OWNERS, and
  // never a runtime role (Issue #1077 audit, M5).
  // With no ledger and no configured owner there is nothing to compare an owner
  // with: that is a finding, not a pass (Issue #1077 audit, MEDIUM-1).
  const ownerKnown =
    snapshot.migrationOwner !== null || expectedOwners.length > 0;

  if (!ownerKnown) {
    add(
      "payroll-ledger-missing",
      `public.${PAYROLL_OWNER_REFERENCE_TABLE}`,
      `public.${PAYROLL_OWNER_REFERENCE_TABLE} does not exist and PAYROLL_EXPECTED_OWNERS is empty, so the expected owner of the payroll objects cannot be determined. Restore the ledger, or name the owner role(s) in PAYROLL_EXPECTED_OWNERS (env: PAYROLL_EXPECTED_OWNERS=role1,role2).`
    );
  }

  function ownerRefused(owner: string): boolean {
    return (
      forbiddenOwners.includes(owner) ||
      (ownerKnown &&
        owner !== snapshot.migrationOwner &&
        !expectedOwners.includes(owner))
    );
  }

  // HIGH-2: a required trigger that exists but does not fire.
  for (const [table, triggers] of Object.entries(requiredTriggers)) {
    for (const trigger of snapshot.triggers) {
      if (
        trigger.relation === `public.${table}` &&
        triggers.includes(trigger.name) &&
        trigger.enabled !== undefined &&
        trigger.enabled !== "O"
      ) {
        add(
          "payroll-trigger-disabled",
          `public.${table}.${trigger.name}`,
          `trigger ${trigger.name} on public.${table} is not enabled (tgenabled=${trigger.enabled}): a disabled immutability or audit trigger lets the ledger be rewritten unseen.`
        );
      }
    }
  }

  // HIGH-1: the log that references the ledger follows a rename of it, so the
  // edge to the family name disappears; and a relation with the ledger's
  // columns that is not in the family IS the ledger, renamed away or copied.
  for (const edge of PAYROLL_REQUIRED_FOREIGN_KEYS) {
    const from = snapshot.relations.some(
      (relation) => relation.name === `public.${edge.from}`
    );

    if (
      from &&
      !snapshot.foreignKeys.some(
        (fk) =>
          fk.from === `public.${edge.from}` && fk.to === `public.${edge.to}`
      )
    ) {
      add(
        "payroll-fk-missing",
        `public.${edge.from}`,
        `public.${edge.from} no longer references public.${edge.to} (PAYROLL_REQUIRED_FOREIGN_KEYS): the table it referenced was renamed or replaced.`
      );
    }
  }

  for (const table of requiredTables) {
    const real = snapshot.columns.find(
      (entry) => entry.relation === `public.${table}`
    );

    if (!real || real.columns.length < PAYROLL_LOOKALIKE_MIN_COLUMNS) continue;

    const wanted = new Set(real.columns);

    for (const entry of snapshot.columns) {
      if (isPayrollFamily(entry.relation)) continue;

      const shared = entry.columns.filter((column) => wanted.has(column));

      if (shared.length >= PAYROLL_LOOKALIKE_COLUMN_SHARE * wanted.size) {
        add(
          "payroll-lookalike",
          entry.relation,
          `${entry.relation} is not in the payroll family but shares ${shared.length} of the ${wanted.size} columns of public.${table}: it is that table renamed away, or a copy of it.`
        );
      }
    }
  }

  // H1: a look-alike under the family name has none of the real table's
  // triggers, and the real table's indexes, constraints, policies and triggers
  // keep their family names on whatever it was renamed to.
  for (const [table, triggers] of Object.entries(requiredTriggers)) {
    if (
      !snapshot.relations.some(
        (relation) => relation.name === `public.${table}`
      )
    ) {
      continue;
    }

    for (const trigger of triggers) {
      if (
        !snapshot.triggers.some(
          (entry) =>
            entry.relation === `public.${table}` && entry.name === trigger
        )
      ) {
        add(
          "payroll-trigger-missing",
          `public.${table}.${trigger}`,
          `public.${table} lacks its trigger ${trigger}: the immutability and audit triggers are what make a payroll table a ledger, and a look-alike table created under the family name after the real one was renamed away has none (PAYROLL_REQUIRED_TRIGGERS).`
        );
      }
    }
  }

  for (const object of snapshot.namedObjects) {
    if (isPayrollTable(object.name) && !isPayrollFamily(object.relation)) {
      add(
        "payroll-named-object-outside",
        `${object.relation}.${object.name}`,
        `${object.kind} ${object.name} carries a payroll-family name but sits on ${object.relation}, which is not in the family: a payroll table was renamed away and its objects stayed behind.`
      );
    }
  }

  for (const trigger of snapshot.triggers) {
    if (
      isPayrollTable(trigger.name) &&
      !isPayrollFamily(trigger.relation) &&
      !isPayrollFamily(trigger.function)
    ) {
      add(
        "payroll-named-object-outside",
        `${trigger.relation}.${trigger.name}`,
        `trigger ${trigger.name} carries a payroll-family name but sits on ${trigger.relation}, which is not in the family.`
      );
    }
  }

  // M4: who OWNS payroll, who INHERITS it, and where rows are COPIED to.
  const familyOwners = new Set<string>();

  for (const relation of snapshot.relations) {
    if (!isPayrollFamily(relation.name)) continue;

    familyOwners.add(relation.owner);

    if (ownerRefused(relation.owner)) {
      add(
        "payroll-owner",
        relation.name,
        `${relation.name} is owned by ${relation.owner}. An owner holds every privilege and can regrant it; the request and worker roles must not own payroll (forbidden owners: ${forbiddenOwners.join(", ")}).`
      );
    }
  }

  for (const fn of familyFunctions) {
    familyOwners.add(fn.owner);

    if (ownerRefused(fn.owner)) {
      add(
        "payroll-owner",
        fn.name,
        `${fn.name} is owned by ${fn.owner}. A payroll-family function must not be owned by a runtime role (forbidden owners: ${forbiddenOwners.join(", ")}).`
      );
    }
  }

  // Membership is inheritance: whoever is a member of a role that holds payroll
  // (or owns it), directly or through other roles, holds it too.
  const holders = new Set<string>([
    ...allowed,
    ...familyOwners,
    ...privilegedRoles,
    ...snapshot.roles
      .filter((role) => role.superuser || role.bypassRls)
      .map((role) => role.name)
  ]);

  // A runtime role that skips row-level security reads every tenant's payroll.
  for (const role of snapshot.roles) {
    if (
      (role.superuser || role.bypassRls) &&
      (allowed.includes(role.name) || workers.includes(role.name))
    ) {
      add(
        "payroll-role-bypass",
        `role:${role.name}`,
        `runtime role ${role.name} is ${role.superuser ? "a superuser" : "BYPASSRLS"}: it ignores every row-level policy and every grant on payroll.`
      );
    }
  }

  for (const holder of holders) {
    const seen = new Set<string>([holder]);
    const queue: { role: string; via: string[] }[] = [
      { role: holder, via: [] }
    ];

    while (queue.length > 0) {
      const { role, via } = queue.shift()!;

      for (const edge of snapshot.memberships) {
        if (edge.role !== role || seen.has(edge.member)) continue;

        seen.add(edge.member);
        queue.push({ role: edge.member, via: [...via, role] });

        if (!allowedMembers.includes(edge.member)) {
          add(
            "payroll-role-membership",
            `role:${edge.member}`,
            `role ${edge.member} is a member of ${role}${via.length > 0 ? ` (through ${via.join(" -> ")})` : ""}, which holds ${holder === role ? "" : `${holder}'s `}payroll privileges, so it inherits them without appearing in any ACL (PAYROLL_ALLOWED_ROLE_MEMBERS: ${allowedMembers.join(", ") || "none"}).`
          );
        }
      }
    }
  }

  for (const publication of snapshot.publications) {
    if (Object.hasOwn(publicationExemptions, publication.name)) continue;

    const payrollRelations = publication.relations.filter(isPayrollFamily);
    const reason = publication.allTables
      ? "publishes ALL tables"
      : payrollRelations.length > 0
        ? `publishes ${payrollRelations.join(", ")}`
        : publication.schemas.includes("public")
          ? "publishes the whole public schema"
          : "";

    if (reason) {
      add(
        "payroll-publication",
        `publication:${publication.name}`,
        `publication ${publication.name} ${reason}: logical replication copies payroll rows to another database, outside every grant here. List it in PAYROLL_PUBLICATION_EXEMPTIONS with the reason, or narrow it.`
      );
    }
  }

  for (const foreign of snapshot.foreignTables) {
    const named = [
      ...payrollTokens(foreign.name.slice(foreign.name.indexOf(".") + 1)),
      ...payrollTokens(foreign.options)
    ];

    if (isPayrollFamily(foreign.name) || named.length > 0) {
      add(
        "payroll-foreign-table",
        foreign.name,
        `foreign table ${foreign.name} ${isPayrollFamily(foreign.name) ? "is a payroll-family name but its rows live elsewhere" : `points at ${[...new Set(named)].join(", ")}`}: a foreign table is a second path to payroll rows (a loopback fdw reads them with another role's rights).`
      );
    }
  }

  // M6: policies, CHECK / FOREIGN KEY constraints, column defaults, index
  // expressions and columns of a payroll row type belong to the table they
  // sit on; that table has to be in the family when what they depend on is.
  for (const dependency of snapshot.dependencies) {
    if (
      isPayrollFamily(dependency.referenced) &&
      !isPayrollFamily(dependency.relation)
    ) {
      add(
        "dependent-on-payroll",
        `${dependency.relation}.${dependency.object}`,
        `${dependency.kind} ${dependency.object} on ${dependency.relation} depends on ${dependency.referenced}, but ${dependency.relation} is not a payroll relation. A policy, constraint, default, index or column of a payroll type is a read of payroll from outside the family.`
      );
    }
  }

  return findings.filter(
    (finding) => !Object.hasOwn(exemptions, finding.object)
  );
}

/** Exemptions naming an object the catalog no longer has. */
export function staleCatalogExemptions(
  snapshot: CatalogSnapshot,
  exemptions: Readonly<Record<string, string>> = PAYROLL_CATALOG_EXEMPTIONS
): string[] {
  const known = new Set<string>([
    ...snapshot.functions.map((fn) => fn.name),
    ...snapshot.rules.map((rule) => rule.relation),
    ...snapshot.grants.map((grant) => grant.relation),
    ...snapshot.triggers.map(
      (trigger) => `${trigger.relation}.${trigger.name}`
    ),
    ...snapshot.inheritance.map((edge) => edge.child),
    ...snapshot.relations.map((relation) => relation.name),
    ...snapshot.foreignTables.map((foreign) => foreign.name),
    ...snapshot.publications.map(
      (publication) => `publication:${publication.name}`
    ),
    ...snapshot.memberships.map((edge) => `role:${edge.member}`),
    ...snapshot.dependencies.map(
      (dependency) => `${dependency.relation}.${dependency.object}`
    )
  ]);

  return Object.keys(exemptions).filter((object) => !known.has(object));
}
