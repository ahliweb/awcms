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
 * - A policy or CHECK constraint that mentions a payroll table.
 * - A privilege held through role MEMBERSHIP (`GRANT awcms_app TO x`).
 * - Objects in an extension.
 *
 * Pure analysis plus one loader. The loader takes any Bun.SQL-shaped tagged
 * template, so the same code runs in the integration test (inside a transaction
 * it rolls back, to plant a probe) and in `payroll:catalog-boundary:check`.
 */
import {
  PAYROLL_ALLOWED_GRANTEES,
  PAYROLL_CATALOG_EXEMPTIONS,
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
};

export type CatalogGrant = {
  relation: Qualified;
  owner: string;
  grantee: string;
  privilege: string;
  column: string | null;
};

export type CatalogInheritance = { parent: Qualified; child: Qualified };

export type CatalogSnapshot = {
  rules: CatalogRule[];
  functions: CatalogFunction[];
  triggers: CatalogTrigger[];
  grants: CatalogGrant[];
  inheritance: CatalogInheritance[];
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
           fn.nspname || '.' || p.proname AS function
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace cn ON cn.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace fn ON fn.oid = p.pronamespace
    WHERE NOT t.tgisinternal
      AND cn.nspname NOT IN ('pg_catalog', 'information_schema')
  `) as { relation: string; name: string; function: string }[];

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

  return {
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
  const name = bare(qualified).replace(/[$]/g, "\\$");

  // `name(`, `"name"(`, `public."name"(` and `public . name (` are all calls.
  return new RegExp(`(?<![\\w$])"?${name}"?\\s*\\(`, "i").test(body);
}

export type AnalyseOptions = {
  allowedGrantees?: readonly string[];
  workerRoles?: readonly string[];
  workerExecuteAllowlist?: readonly string[];
  exemptions?: Readonly<Record<string, string>>;
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
    ...snapshot.inheritance.map((edge) => edge.child)
  ]);

  return Object.keys(exemptions).filter((object) => !known.has(object));
}
