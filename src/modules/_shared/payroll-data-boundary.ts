/**
 * The payroll data boundary (Issue #978, finding PS-18 (b);
 * `docs/awcms/hr-payroll.md` section 13.2 and section 17).
 *
 * ## The problem
 *
 * Payroll tables hold one person's salary per row. The permission that guards
 * them (`compensation.read`, `runs.read`, `payslips.read`) is narrow on purpose,
 * and the controls above it (step-up, audited reads, masking) all assume the
 * data leaves through a payroll route. A DERIVED copy skips every one of them:
 *
 * - a **reporting projection** over a payroll table is readable by whoever holds
 *   the report permission, which is a much wider audience than whoever holds
 *   `compensation.read`; and an "aggregate" over a one-employee tenant, or over
 *   a one-person department, IS that employee's salary;
 * - a **site-search source** or a **comments resource** publishes a table's
 *   rows to the public index or the public comment engine;
 * - an **edge-cache surface** lets a shared cache store a response;
 * - a **report export** writes a file that outlives the request, is not behind
 *   the per-route step-up, and is opened in a spreadsheet.
 *
 * None of those has a reason to name a payroll table, and a mistake in one is a
 * disclosure rather than a bug.
 *
 * ## One rule, enforced by every registry that can name a table
 *
 * This file is the single place the forbidden names are written down. Every gate
 * that validates a registry imports it, so a table renamed or added here is
 * refused everywhere at once and there is no second list to forget:
 *
 * | Registry                                  | Enforced by                                                                  |
 * | ----------------------------------------- | ---------------------------------------------------------------------------- |
 * | reporting projection (`reportingProjections`) | `reporting/domain/projection-registry.ts` + the three engines' SQL builders + `generateProjectionExport` |
 * | site-search source (`searchSources`)      | `site-search/domain/search-source-registry.ts` + `assertSafeTableName`         |
 * | comments resource (`commentableResources`)| `comments/domain/commentable-resource-registry.ts` + `assertSafeTableName`     |
 * | edge-cache surface                        | `scripts/edge-cache-surfaces-check.ts` (`findPayrollSurfaces`)               |
 * | report export (scheduled or manual)       | exports are produced FROM a projection, so the projection rule above covers  |
 * |                                           | them, and `generateProjectionExport` refuses again at write time             |
 *
 * `tests/payroll-data-boundary.test.ts` additionally reads `module-contract.ts`
 * and fails when a NEW descriptor type that names a table appears, so the next
 * kind of registry has to decide (enforce, or be listed below) instead of
 * silently being a gap.
 *
 * ## The two registries that are deliberately NOT bound
 *
 * `dataLifecycle` and `subjectData` MUST name every payroll table, and PS-17
 * requires it: retention and legal hold are decided per table, and a subject's
 * access request has to find every row about them. Those are not derived copies
 * for a wider audience. They are governed by their own controls:
 *
 * - **subject data** exports the data subject's OWN rows, with `redactedColumns`
 *   (account ciphertext, hash and mask never ride out) and the request itself
 *   audited;
 * - **data lifecycle** archives and purges under retention with legal-hold
 *   override; its CSV archives are formula-neutralised too
 *   (`src/lib/security/csv-formula.ts`).
 *
 * ## The route for a future payroll report
 *
 * There is none today, on purpose. A report over payroll data needs ALL of: its
 * own permission (never `reporting.*` alone), a minimum cohort size below which
 * the figure is withheld (so an aggregate cannot be one person), its own ADR
 * deciding both, and the sensitive-read audit of
 * `src/modules/_shared/sensitive-reads.ts` on every read and export. Lifting
 * this boundary means changing THIS file in a PR that carries that ADR; the
 * `tests/payroll-data-boundary.test.ts` assertions will fail until it does, which
 * is the intended speed bump. See `hr-payroll.md` section 13.2.
 *
 * Zero imports: the registry validators in `src/modules/*` and the gate scripts
 * import this, and it must be reachable from all of them without a cycle.
 */

/**
 * Table-name patterns that no derived surface may name. Prefix patterns are
 * intentional: `awcms_hr_payroll_*` is the whole family, and the singular and
 * plural spellings of the other three are both caught so a rename in the
 * phase-3 schema cannot slip past a pattern that was exact.
 */
export const FORBIDDEN_PAYROLL_TABLE_PATTERNS: readonly RegExp[] = [
  // Any table whose name carries a pay word as a whole `_`-delimited segment,
  // singular or plural, with or without a module prefix: `awcms_hr_payroll_runs`,
  // `awcms_hr_compensations`, `awcms_hr_employee_compensation`,
  // `awcms_hr_salary_history`, `awcms_payroll_records`. Whole segments, so
  // `awcms_hr_payrollish_not` and `awcms_hr_pay_rule_sets` are left alone.
  /^awcms_(?:[a-z0-9]+_)*(?:payrolls?|compensations?|salary|salaries|wages?|payslips?|payouts?)(?:_|$)/,
  // Personal earnings with the same small-cohort risk (owner decision on the
  // #978 audit): commission accruals are one employee's pay.
  // The accrual ledger and its transition log are one unit (a trigger on the
  // log reads the accrual).
  /^awcms_hr_commission_(?:accruals?|transitions)(_|$)/
];

/**
 * Database roles that may hold a privilege on a payroll relation (Issue #1015,
 * the catalog layer in `scripts/lib/payroll-catalog-boundary.ts`): the request
 * role only. The owner is implicit. Every OTHER role (`PUBLIC` included, the
 * implicit grantee of a new function; and `awcms_worker`, which runs unattended
 * jobs and so must never read a person's pay row by row) fails. Widening this
 * list is a security decision made in a PR that says why.
 */
export const PAYROLL_ALLOWED_GRANTEES: readonly string[] = ["awcms_app"];

/**
 * Roles that may EXECUTE a payroll-family SECURITY DEFINER function only under
 * the narrow terms below. A worker needs a COUNT (is anything due, how many
 * rows would a purge touch), never a row.
 *
 * A function qualifies when ALL hold: it is named in
 * {@link PAYROLL_WORKER_EXECUTE_ALLOWLIST} (bare function names, EMPTY today;
 * an issue that needs a count adds its function here, in a PR that says why),
 * it does not return a set, it returns one of
 * {@link PAYROLL_WORKER_SCALAR_RETURN_TYPES}, and no payroll row type appears
 * in its signature.
 */
export const PAYROLL_WORKER_ROLES: readonly string[] = ["awcms_worker"];

export const PAYROLL_WORKER_EXECUTE_ALLOWLIST: readonly string[] = [];

/** `regtype` spellings of int2, int4, int8 and bool. */
export const PAYROLL_WORKER_SCALAR_RETURN_TYPES: readonly string[] = [
  "smallint",
  "integer",
  "bigint",
  "boolean"
];

/**
 * Migration files (by name) whose `DO` block runs dynamic SQL (`EXECUTE`) and
 * is accepted by the static payroll gate, each with the reason. A relation name
 * built at run time is a name no text scan can hold to the boundary (the
 * catalog layer still sees whatever object results), so every such block is
 * named here deliberately. Empty today for payroll-adjacent migrations.
 */
export const PAYROLL_DO_EXECUTE_ALLOWLIST: Readonly<Record<string, string>> = {
  "099_awcms_sync_outbox_retire.sql":
    "a one-line row count over awcms_sync_outbox (a literal table, no payroll relation) to refuse retiring a non-empty table",
  "142_awcms_delegated_access_expiry_sweep.sql":
    "creates a policy per table of a fixed list of access-grant tables for the expiry-sweep role; the loop variable ranges over literals in the same file, none a payroll relation",
  "310_awcms_setup_role_credential_column_revoke.sql":
    "one GRANT EXECUTE on awcms_ensure_principal_id(text) to the migration role (current_user); the only run-time part is a ROLE name, no relation, payroll or otherwise"
};

/**
 * Catalog objects (`schema.name`) the catalog layer accepts although they sit
 * across the boundary, each with the reason. Empty today and meant to stay so:
 * an entry is the maintainer saying "this object may read payroll", which is
 * what the payroll-family NAME is for. A stale entry (the object no longer
 * exists) is reported.
 */
export const PAYROLL_CATALOG_EXEMPTIONS: Readonly<Record<string, string>> = {};

/**
 * The marker a payroll table carries in the catalog (Issue #1077, M1):
 * `COMMENT ON TABLE <t> IS 'payroll-boundary ...'`. The family is NAME-based, so
 * a table renamed out of it would leave both layers silent; the comment travels
 * with the table through `RENAME`, so the catalog layer can say "this marked
 * relation no longer has a family name". The text after the marker is free.
 */
export const PAYROLL_BOUNDARY_MARKER = "payroll-boundary";

/**
 * Payroll tables that MUST exist in the migrated catalog, in `public`, carrying
 * the marker (Issue #1077, M1). A rename (or a drop) of one is a finding even if
 * the comment was also removed. A phase-3 payroll table is appended here in the
 * migration that creates it, together with its marker.
 */
export const PAYROLL_REQUIRED_TABLES: readonly string[] = [
  "awcms_hr_commission_accruals",
  "awcms_hr_commission_transitions"
];

/**
 * Tables written or declared by a payroll-owner module
 * ({@link PAYROLL_OWNER_MODULE_KEYS}), or named with the module's own prefix,
 * that are NOT payroll data, each with the reason (Issue #1077, M1). Every other
 * table such a module owns must satisfy `isPayrollTable`, so a phase-3 table
 * (run lines, periods, rules) cannot fall outside the family by being named
 * unluckily. A stale entry is reported.
 */
export const PAYROLL_OWNED_NON_PAYROLL_TABLES: Readonly<
  Record<string, string>
> = {
  awcms_hr_commission_rules:
    "the tenant's commercial terms (a rule version, a rate); it names no employee and no amount earned by one. Accruals cite it but it carries no per-person pay (subject-data rationale in hr-commission/module.ts)"
};

/**
 * Migrations (by name) that change the owner of a payroll object, each with the
 * reason (Issue #1077 audit, M5). Empty: payroll objects are owned by the role
 * that ran the migrations.
 */
export const PAYROLL_OWNER_CHANGE_ALLOWLIST: Readonly<Record<string, string>> =
  {};

/**
 * Roles that may not OWN a payroll relation or a payroll-family function
 * (Issue #1077, M4): an owner holds every privilege and can regrant it, so the
 * request and worker roles must never be it.
 */
export const PAYROLL_FORBIDDEN_OWNERS: readonly string[] = [
  "awcms_app",
  "awcms_worker"
];

/**
 * Roles that may be a MEMBER of a role that holds payroll privileges (an
 * allowed grantee, or the owner of a payroll relation). Empty: membership is
 * inheritance, so a role that is a member of `awcms_app` reads payroll without
 * ever appearing in an ACL (Issue #1077, M4).
 */
export const PAYROLL_ALLOWED_ROLE_MEMBERS: readonly string[] = [];

/**
 * Publications accepted although they carry payroll tables (or every table),
 * each with the reason (Issue #1077, M4). A logical-replication publication
 * copies rows to another database, outside every grant here. Empty today.
 */
export const PAYROLL_PUBLICATION_EXEMPTIONS: Readonly<Record<string, string>> =
  {};

/**
 * Functions and operators that read a relation named by a STRING or an OID, so
 * the body never spells the table (Issue #1077, M2): the XML exporters, the
 * regclass casts, `format()` assembling a name, `ts_stat()` and `dblink` running
 * a query text, and a Unicode-escaped identifier `U&"..."`. A SECURITY DEFINER
 * function outside the payroll family may not use them unless it is named in
 * `PAYROLL_CATALOG_EXEMPTIONS`; the static layer refuses the same tokens in a
 * migration's non-family SECURITY DEFINER function.
 */
export const PAYROLL_INDIRECT_READ_PATTERN =
  /(?<![\w$])"?(?:(?:schema|table|query|database|cursor)_to_xml\w*|to_regclass|to_regtype|regclass|ts_stat|ts_rewrite|crosstab\w*|connectby|dblink\w*|lo_from_bytea|lo_import|lo_export|lo_put|pg_read_file|pg_read_binary_file)"?(?![\w$])|(?<![\w$])"?format"?\s*\(|\bU&\s*"/i;

/**
 * The subset that RUNS A QUERY TEXT or reads/writes outside the SQL text (Issue
 * #1077 audit, H2): refused anywhere in a migration, quoted or not, whether or
 * not a `(` follows (`"query_to_xml"(...)` and `pg_catalog."ts_rewrite"(...)`
 * are the same call). Nothing in `sql/` uses one.
 */
export const PAYROLL_QUERY_TEXT_HELPER_PATTERN =
  /(?<![\w$])"?(?:(?:schema|table|query|database|cursor)_to_xml\w*|ts_stat|ts_rewrite|crosstab\w*|connectby|dblink\w*|lo_from_bytea|lo_import|lo_export|lo_put|pg_read_file|pg_read_binary_file)"?(?![\w$])/i;

/**
 * Owners accepted for a payroll relation or family function in addition to the
 * role that owns the migration ledger (`awcms_schema_migrations`), which is
 * discovered from the catalog: the role that ran the migrations is the role
 * that should own what they created (Issue #1077 audit, M5). Empty by default;
 * a deployment whose objects are owned by a separate owner role names it here.
 */
export const PAYROLL_EXPECTED_OWNERS: readonly string[] = [];

/** The migration ledger table whose owner is the expected owner. */
export const PAYROLL_OWNER_REFERENCE_TABLE = "awcms_schema_migrations";

/**
 * Foreign keys between required payroll tables that must exist (Issue #1077
 * audit, HIGH-1): when the real ledger is renamed away, the log that references
 * it follows the rename, so the edge to the family name disappears.
 */
export const PAYROLL_REQUIRED_FOREIGN_KEYS: readonly {
  from: string;
  to: string;
}[] = [
  {
    from: "awcms_hr_commission_transitions",
    to: "awcms_hr_commission_accruals"
  }
];

/**
 * A non-family relation that shares at least this share of a required payroll
 * table's columns (same name and type) is that table renamed away, or a copy of
 * it (Issue #1077 audit, HIGH-1). The ledger has ~35 columns; no ordinary table
 * comes near.
 */
export const PAYROLL_LOOKALIKE_COLUMN_SHARE = 0.7;
export const PAYROLL_LOOKALIKE_MIN_COLUMNS = 5;

/**
 * Predefined roles that read or write every table without an ACL entry (Issue
 * #1077 audit, M4). A member of one reads payroll; so is a member of any
 * superuser or BYPASSRLS role (computed from `pg_roles`).
 */
export const PAYROLL_PRIVILEGED_PREDEFINED_ROLES: readonly string[] = [
  "pg_read_all_data",
  "pg_write_all_data",
  "pg_maintain"
];

/**
 * Triggers every required payroll table must carry (Issue #1077 audit, H1): a
 * look-alike table created under the family name after the real one was renamed
 * away has none of them. Keyed by bare table name.
 */
export const PAYROLL_REQUIRED_TRIGGERS: Readonly<
  Record<string, readonly string[]>
> = {
  awcms_hr_commission_accruals: [
    "awcms_hr_commission_accruals_born_valid",
    "awcms_hr_commission_accruals_immutable",
    "awcms_hr_commission_accruals_log_birth",
    "awcms_hr_commission_accruals_log_change"
  ],
  awcms_hr_commission_transitions: ["awcms_hr_commission_transitions_guard"]
};

/** Function languages the catalog layer can read the body of. */
export const PAYROLL_READABLE_LANGUAGES: readonly string[] = ["sql", "plpgsql"];

/**
 * Modules that own payroll data. A derived surface they OWN is refused even if
 * the table it reads has a name the patterns above do not know — a renamed
 * table, a view, a materialised copy. The set is a list so a later
 * payroll-bearing module (a bonus or loan ledger) can be added in one place.
 */
export const PAYROLL_OWNER_MODULE_KEYS: readonly string[] = [
  "hr_payroll",
  "hr_commission"
];

/**
 * Words that mark a payroll URL or surface key. Edge-cache surfaces name no
 * table, only a path pattern, so the check there is lexical over the surface key
 * and the pattern source.
 */
export const PAYROLL_PATH_VOCABULARY =
  /payroll|payslip|compensation|payout|salary|salaries|wage|commission|accrual/i;

/**
 * Concrete paths a payroll route can take, written as paths rather than as
 * words (Issue #1014 L5). A lexical check on the surface pattern misses
 * `^/api/v1/hr/[^/]+/runs`, which names no pay word at all; testing the pattern
 * as a REGEX against these probes does not. The module-declared routes are
 * probed too (`findPayrollSurfaces`), so this list only has to cover the
 * period before a payroll module declares any route.
 */
export const PAYROLL_ROUTE_PROBES: readonly string[] = [
  "/api/v1/hr/payroll/runs",
  "/api/v1/hr/payroll/runs/00000000-0000-4000-8000-000000000001",
  "/api/v1/hr/runs",
  "/api/v1/hr/payslips/00000000-0000-4000-8000-000000000001",
  "/api/v1/hr/employees/00000000-0000-4000-8000-000000000001/compensation",
  "/api/v1/hr-payroll/runs",
  "/api/v1/hr-payroll/payslips",
  "/api/v1/hr-commission/accruals",
  "/api/v1/payroll/runs",
  "/admin/hr/payroll",
  "/admin/hr-payroll/runs",
  "/me/payslips"
];

/**
 * URL namespaces that belong to the HR modules. No public cache surface has a
 * reason to sit under them, so a pattern whose literal prefix is one of these
 * (or that a probe under one matches) is refused whatever its words are.
 */
export const PAYROLL_ROUTE_NAMESPACES: readonly string[] = [
  "/api/v1/hr/",
  "/api/v1/hr-",
  "/admin/hr/",
  "/admin/hr-"
];

/**
 * Event types a payroll module emits (`awcms.hr.payroll.*`,
 * `awcms.hr.commission.*`, `hr_payroll.*`). Reuses the path vocabulary: the
 * words that make a URL payroll make an event type payroll.
 */
export function isPayrollEventType(eventType: string): boolean {
  return PAYROLL_PATH_VOCABULARY.test(String(eventType));
}

/**
 * `"public"."awcms_hr_payslips"`, `Public.AWCMS_HR_PAYSLIPS` and
 * `awcms_hr_payslips` are the same table to PostgreSQL, so the comparison is on
 * the unquoted, lower-cased, schema-stripped name.
 */
export function normalizeTableNameForBoundary(name: string): string {
  const unquoted = String(name).replace(/"/g, "").trim().toLowerCase();
  const lastDot = unquoted.lastIndexOf(".");

  return lastDot === -1 ? unquoted : unquoted.slice(lastDot + 1);
}

/** True when `name` is a payroll table (or a member of the payroll family). */
export function isPayrollTable(name: string): boolean {
  const normalized = normalizeTableNameForBoundary(name);

  return FORBIDDEN_PAYROLL_TABLE_PATTERNS.some((pattern) =>
    pattern.test(normalized)
  );
}

/** The payroll tables among `names`, deduplicated, in first-seen order. */
export function findPayrollTables(names: Iterable<string>): string[] {
  const found: string[] = [];

  for (const name of names) {
    if (isPayrollTable(name) && !found.includes(name)) {
      found.push(name);
    }
  }

  return found;
}

/** True when `moduleKey` is a module that owns payroll data. */
export function isPayrollOwnerModule(moduleKey: string | null | undefined) {
  return Boolean(moduleKey) && PAYROLL_OWNER_MODULE_KEYS.includes(moduleKey!);
}

/** Refusal for a projection that consumes a payroll domain event. */
export function payrollEventMessage(surface: string, eventType: string) {
  return (
    `${surface} consumes the payroll event "${eventType}". An event payload is ` +
    "a derived copy of per-employee pay, readable by whoever holds the report " +
    "permission (hr-payroll.md section 13.2, PS-18). See " +
    "src/modules/_shared/payroll-data-boundary.ts."
  );
}

/**
 * The refusal text every registry uses, so a failing gate reads the same
 * wherever it fires and a reader searching the repo for it finds this file.
 */
export function payrollBoundaryMessage(
  surface: string,
  table: string,
  where: string
): string {
  return (
    `${where} names the payroll table "${table}". A ${surface} is a derived ` +
    "copy readable by a wider audience than compensation.read, and an aggregate " +
    "over a small cohort is one person's salary (hr-payroll.md section 13.2, " +
    "PS-18). A payroll report needs its own permission, a minimum cohort size " +
    "and its own ADR; see src/modules/_shared/payroll-data-boundary.ts."
  );
}

/** Refusal for a surface whose OWNING module is a payroll module. */
export function payrollOwnerMessage(surface: string, moduleKey: string) {
  return (
    `module "${moduleKey}" owns payroll data and may not declare a ${surface}: ` +
    "it is a derived copy readable by a wider audience than the payroll " +
    "permissions (hr-payroll.md section 13.2, PS-18). See " +
    "src/modules/_shared/payroll-data-boundary.ts for the route to a payroll report."
  );
}

/**
 * Throws when `name` is a payroll table. Used at the point a table name is
 * about to be interpolated into SQL, so a descriptor that somehow bypassed the
 * registry gate still cannot make an engine read payroll.
 */
export function assertNotPayrollTable(name: string, engine: string): string {
  if (isPayrollTable(name)) {
    throw new Error(
      `${engine}: refusing to read the payroll table ${JSON.stringify(name)} ` +
        "(hr-payroll.md section 13.2, PS-18). " +
        "See src/modules/_shared/payroll-data-boundary.ts."
    );
  }

  return name;
}

/**
 * The registries that name a table and are deliberately NOT bound by this rule,
 * each with the control that governs it instead. A contract test requires every
 * descriptor type in `module-contract.ts` that names a table to be either
 * enforced (listed in {@link PAYROLL_BOUND_DESCRIPTOR_TYPES}) or here.
 */
export const PAYROLL_EXEMPT_DESCRIPTOR_TYPES: Readonly<Record<string, string>> =
  {
    HighVolumeTableDescriptor:
      "data lifecycle must name every table to set retention and honour legal hold (PS-17); CSV archives are formula-neutralised",
    SubjectDataDescriptor:
      "a subject's own rows, with redactedColumns, are what an access request must return (ADR-0094, PS-17)"
  };

/** Descriptor types in `module-contract.ts` that name a table and ARE bound. */
export const PAYROLL_BOUND_DESCRIPTOR_TYPES: Readonly<Record<string, string>> =
  {
    ProjectionCursorStream:
      "reporting/domain/projection-registry.ts (source and rebuild streams)",
    SearchSourceDescriptor:
      "site-search/domain/search-source-registry.ts (source table)",
    SearchSourceTermFacet:
      "site-search/domain/search-source-registry.ts (join link and value tables)",
    CommentableResourceDescriptor:
      "comments/domain/commentable-resource-registry.ts (source table)"
  };
