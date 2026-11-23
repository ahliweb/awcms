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
    "the tenant's commercial terms (a rule version, a rate); it names no employee and no amount earned by one. Accruals cite it but it carries no per-person pay (subject-data rationale in hr-commission/module.ts)",
  awcms_hr_commission_intents:
    "ADR-0147 / Issue #1189: the TRANSIENT intake queue an event-driven consumer (awcms_worker) INSERTs into and the awcms_app poster drains into the ledger. Deliberately outside the family: the worker's only privilege is INSERT on it, which is the whole point of the design, and listing it here is not a catalog exemption (PAYROLL_CATALOG_EXEMPTIONS stays empty). It is derived data (a base amount and an employment id) for a short retention window and carries no settled pay; the accrual it becomes is the payroll-family record.",
  awcms_hr_commission_intake_settings:
    "ADR-0147 / Issue #1189: one boolean per tenant (commission_intake_enabled), readable by awcms_worker so the port can answer disabled. It names no person and no amount."
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
 * The STABLE FINGERPRINT of each required payroll table (Issue #1436,
 * ADR-0173): what the table IS, independent of what it is called.
 *
 * - `columns`: every column as `name:type` (`format_type` without typmod), as
 *   a set. A migration that adds, drops, renames or retypes a column of a
 *   required table updates this list in the same PR; the catalog check fails
 *   (`payroll-fingerprint-drift`) until it does.
 * - `triggers`: every required trigger with the function it runs and its
 *   `pg_trigger.tgtype` bitmask (timing, level, events).
 * - `foreignKeys`: every foreign key the table declares, by target table and
 *   referencing columns, in order.
 * - `nameFreeTolerance`: how many columns a NON-family relation may differ by,
 *   counting column TYPES only (a multiset, names ignored), and still be this
 *   table under another name (`payroll-fingerprint-match`). A rebuild that
 *   renames every column keeps every type. `null` means the shape is not
 *   distinctive enough to match without names: the transition log's nine
 *   generic columns sit within one column of ordinary status logs, so it is
 *   held by its foreign key to the ledger (`dependent-on-payroll`) and its
 *   trigger instead. A tolerance is only set where the migrated catalog keeps a
 *   margin of more than twice the tolerance to every other relation (asserted
 *   by `tests/integration/payroll-catalog-boundary.integration.test.ts`).
 *
 * Keyed by bare table name; the key set is {@link PAYROLL_REQUIRED_TABLES}.
 */
export type PayrollTableFingerprint = {
  columns: readonly string[];
  triggers: readonly { name: string; function: string; type: number }[];
  foreignKeys: readonly { to: string; columns: readonly string[] }[];
  nameFreeTolerance: number | null;
};

const TS = "timestamp with time zone";

export const PAYROLL_REQUIRED_TABLE_FINGERPRINTS: Readonly<
  Record<string, PayrollTableFingerprint>
> = {
  awcms_hr_commission_accruals: {
    columns: [
      "id:uuid",
      "tenant_id:uuid",
      "employment_id:uuid",
      "rule_id:uuid",
      "rule_key:text",
      "rule_version:integer",
      "source_type:text",
      "source_ref:text",
      "source_line:text",
      "operation:text",
      "calculation:text",
      "base_amount:numeric",
      "units:integer",
      "rate:numeric",
      "fixed_amount:numeric",
      "amount:numeric",
      "currency_code:character",
      `occurred_at:${TS}`,
      "occurred_on:date",
      "request_digest:text",
      "correlation_id:text",
      "status:text",
      `created_at:${TS}`,
      "created_by:uuid",
      `approved_at:${TS}`,
      "approved_by:uuid",
      `released_at:${TS}`,
      "released_by:uuid",
      `paid_at:${TS}`,
      "paid_by:uuid",
      "payment_reference:text",
      `voided_at:${TS}`,
      "voided_by:uuid",
      "void_reason_code:text",
      "beneficiary_tenant_user_id:uuid"
    ],
    triggers: [
      {
        name: "awcms_hr_commission_accruals_born_valid",
        function: "awcms_hr_commission_accruals_insert_guard",
        type: 7
      },
      {
        name: "awcms_hr_commission_accruals_immutable",
        function: "awcms_hr_commission_accruals_guard",
        type: 27
      },
      {
        name: "awcms_hr_commission_accruals_log_birth",
        function: "awcms_hr_commission_accruals_log",
        type: 5
      },
      {
        name: "awcms_hr_commission_accruals_log_change",
        function: "awcms_hr_commission_accruals_log",
        type: 17
      }
    ],
    foreignKeys: [
      { to: "awcms_tenants", columns: ["tenant_id"] },
      { to: "awcms_tenant_users", columns: ["tenant_id", "approved_by"] },
      {
        to: "awcms_tenant_users",
        columns: ["tenant_id", "beneficiary_tenant_user_id"]
      },
      { to: "awcms_tenant_users", columns: ["tenant_id", "created_by"] },
      { to: "awcms_tenant_users", columns: ["tenant_id", "paid_by"] },
      { to: "awcms_tenant_users", columns: ["tenant_id", "released_by"] },
      { to: "awcms_tenant_users", columns: ["tenant_id", "voided_by"] },
      { to: "awcms_hr_employments", columns: ["tenant_id", "employment_id"] },
      { to: "awcms_hr_commission_rules", columns: ["tenant_id", "rule_id"] }
    ],
    nameFreeTolerance: 3
  },
  awcms_hr_commission_transitions: {
    columns: [
      "id:uuid",
      "seq:bigint",
      "tenant_id:uuid",
      "accrual_id:uuid",
      "from_status:text",
      "to_status:text",
      "actor_tenant_user_id:uuid",
      "reason_code:text",
      `occurred_at:${TS}`
    ],
    triggers: [
      {
        name: "awcms_hr_commission_transitions_guard",
        function: "awcms_hr_commission_transitions_guard",
        type: 31
      }
    ],
    foreignKeys: [
      { to: "awcms_tenants", columns: ["tenant_id"] },
      {
        to: "awcms_tenant_users",
        columns: ["tenant_id", "actor_tenant_user_id"]
      },
      {
        to: "awcms_hr_commission_accruals",
        columns: ["tenant_id", "accrual_id"]
      }
    ],
    nameFreeTolerance: null
  }
};

/**
 * Foreign keys between required payroll tables that must exist (Issue #1077
 * audit, HIGH-1): when the real ledger is renamed away, the log that references
 * it follows the rename, so the edge to the family name disappears. Derived
 * from {@link PAYROLL_REQUIRED_TABLE_FINGERPRINTS} (the edges whose target is a
 * payroll table), so there is one list to change.
 */
export const PAYROLL_REQUIRED_FOREIGN_KEYS: readonly {
  from: string;
  to: string;
  columns: readonly string[];
}[] = Object.entries(PAYROLL_REQUIRED_TABLE_FINGERPRINTS).flatMap(
  ([from, fingerprint]) =>
    fingerprint.foreignKeys
      .filter((edge) =>
        Object.hasOwn(PAYROLL_REQUIRED_TABLE_FINGERPRINTS, edge.to)
      )
      .map((edge) => ({ from, to: edge.to, columns: edge.columns }))
);

/**
 * Non-family SECURITY DEFINER functions accepted although their owner can
 * reach a payroll relation (Issue #1436, ADR-0173). The allow-list replaces
 * "prove the body does not read payroll" with "every function that runs with
 * payroll-reaching rights is a reviewed entry".
 *
 * A function is IN REACH when its owner is, directly or through role
 * membership, a role that owns a payroll relation or family function, the
 * migration-ledger owner, an expected owner, a grantee on a payroll relation,
 * an EXECUTE grantee of a family SECURITY DEFINER function, a privileged
 * predefined role, a superuser or a BYPASSRLS role. Such a function that is not
 * listed here fails the catalog check (`security-definer-not-allow-listed`).
 * The repository's convention is the way out that needs no entry: own the
 * function with a dedicated `NOLOGIN` role that holds no payroll privilege
 * (every SECURITY DEFINER function in `sql/` does).
 *
 * Key: `schema.name(identity arguments)` exactly as
 * `pg_get_function_identity_arguments` prints them. Each entry pins the
 * reviewed object: `owner` and `bodySha256` (SHA-256 of the body the catalog
 * returns: `prosrc`, or the deparsed `BEGIN ATOMIC` body). A changed owner or
 * body is `security-definer-allowlist-drift`; an entry whose function is gone
 * is reported stale. `PAYROLL_CATALOG_EXEMPTIONS` does NOT cover these two
 * codes: this list is the only route.
 *
 * Who may add an entry is ADR-0173 (Q1). EMPTY today.
 */
export type PayrollSecurityDefinerAllowEntry = {
  /** Why this function needs payroll-reaching rights (at least 40 characters). */
  reason: string;
  /** The issue or ADR that reviewed it: `#NNN` or `ADR-NNNN`. */
  approvedIn: string;
  /** The owner role the review saw. */
  owner: string;
  /** Lower-case hex SHA-256 of the body the review saw. */
  bodySha256: string;
};

export const PAYROLL_SECURITY_DEFINER_ALLOWLIST: Readonly<
  Record<string, PayrollSecurityDefinerAllowEntry>
> = {};

/** Problems with an allow-list (empty means valid). */
export function validatePayrollSecurityDefinerAllowlist(
  allowlist: Readonly<Record<string, PayrollSecurityDefinerAllowEntry>>
): string[] {
  const problems: string[] = [];

  for (const [key, entry] of Object.entries(allowlist)) {
    if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\([^()]*\)$/.test(key)) {
      problems.push(
        `${key}: must be schema.name(identity arguments), lower case, unquoted`
      );
    }
    if (isPayrollTable(key.slice(key.indexOf(".") + 1, key.indexOf("(")))) {
      problems.push(
        `${key}: a payroll-family function needs no entry; remove it`
      );
    }
    if (typeof entry.reason !== "string" || entry.reason.trim().length < 40) {
      problems.push(`${key}: needs a reason (at least 40 characters)`);
    }
    if (!/^(?:#\d+|ADR-\d{4})$/.test(entry.approvedIn ?? "")) {
      problems.push(`${key}: approvedIn must be #NNN or ADR-NNNN`);
    }
    if (
      typeof entry.owner !== "string" ||
      entry.owner.length === 0 ||
      PAYROLL_FORBIDDEN_OWNERS.includes(entry.owner)
    ) {
      problems.push(
        `${key}: owner must be named and must not be a runtime role (${PAYROLL_FORBIDDEN_OWNERS.join(", ")})`
      );
    }
    if (!/^[0-9a-f]{64}$/.test(entry.bodySha256 ?? "")) {
      problems.push(`${key}: bodySha256 must be 64 lower-case hex characters`);
    }
  }

  return problems;
}

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
 * away has none of them. Keyed by bare table name. Derived from
 * {@link PAYROLL_REQUIRED_TABLE_FINGERPRINTS} (Issue #1436).
 */
export const PAYROLL_REQUIRED_TRIGGERS: Readonly<
  Record<string, readonly string[]>
> = Object.fromEntries(
  Object.entries(PAYROLL_REQUIRED_TABLE_FINGERPRINTS).map(
    ([table, fingerprint]) => [
      table,
      fingerprint.triggers.map((trigger) => trigger.name)
    ]
  )
);

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

/**
 * Tables whose NAME trips the pay-word patterns although they are NOT payroll
 * data, each with the reason (Issue #1276). The motivating case is a store
 * refund table such as `<module>_refund_compensations` (goods or credit given
 * instead of a cash refund), which `compensations?` classifies as employee pay.
 *
 * Keys are EXACT, lower-cased, schema-less table names. A CATALOG object of the
 * table (`<table>_pkey`, `<table>_<cols>_idx|key|fkey|check|seq|trg`) inherits
 * the exception, but only when it carries no other table's stem, so an
 * exception for `awcms_x_refund_compensations` can never launder
 * `awcms_x_refund_compensations_payroll_runs`, and an entry that is a prefix of
 * a known payroll table is refused at load. An exception is the maintainer
 * saying "this is not pay"; it is made in a PR that says why. FAIL-CLOSED: empty
 * today (the table that motivated it lives downstream, not here), and a name in
 * {@link PAYROLL_REQUIRED_TABLES} or one that is not a pattern hit is refused at
 * load.
 */
export const NON_PAYROLL_TABLE_NAME_EXCEPTIONS: Readonly<
  Record<string, string>
> = {};

/** The pattern layer alone: what `isPayrollTable` decides without exceptions. */
function matchesPayrollPattern(normalized: string): boolean {
  return FORBIDDEN_PAYROLL_TABLE_PATTERNS.some((pattern) =>
    pattern.test(normalized)
  );
}

/**
 * Table-family names that an exception entry may never equal or be a
 * `_`-bounded prefix of (Issue #1276 audit, M3): an entry `awcms_hr_payroll`
 * must not free `awcms_hr_payroll_runs`. The required tables plus the payroll
 * tables the phase plan names (ADR-0147 and the hr-payroll roadmap); extend it
 * when a payroll table is named.
 */
const KNOWN_PAYROLL_FAMILY_TABLES: readonly string[] = [
  ...PAYROLL_REQUIRED_TABLES,
  "awcms_hr_payroll_runs",
  "awcms_hr_payroll_run_lines",
  "awcms_hr_payroll_employee_items",
  "awcms_hr_compensation_employee_amounts"
];

/**
 * Words that mark the part after `<table>_` as another TABLE's object rather
 * than this table's own index/constraint (`awcms_x_payroll_runs_pkey` is the
 * primary key of `awcms_x_payroll_runs`, not of `awcms_x_payroll`). Their
 * presence refuses inheritance (fail-closed); such an object is excepted by its
 * own exact entry or not at all.
 */
const FOREIGN_OBJECT_STEMS: ReadonlySet<string> = new Set([
  "run",
  "runs",
  "line",
  "lines",
  "item",
  "items",
  "amount",
  "amounts",
  "employee",
  "employees",
  "history",
  "accrual",
  "accruals",
  "transition",
  "transitions",
  "slip",
  "slips",
  "period",
  "periods"
]);

/** Suffix of a catalog object PostgreSQL names `<table>_<columns>_<suffix>`. */
const CATALOG_SUFFIX =
  /^(?:pkey|(?:[a-z0-9]+_)*(?:key|idx|fkey|check|seq|trg))$/;

/**
 * Whether `normalized` is covered by an entry of `exceptions`: the exact name,
 * or a CATALOG object of it (`<entry>_pkey`, `<entry>_<cols>_idx|key|fkey|
 * check|seq|trg`) whose own name is not a payroll-pattern hit and does not
 * carry another table's stem (Issue #1276 audit, M3: a bare prefix used to free
 * the whole family).
 */
function isExceptedFromPayroll(
  normalized: string,
  exceptions: Readonly<Record<string, string>>
): boolean {
  for (const entry of Object.keys(exceptions)) {
    if (normalized === entry) return true;

    if (normalized.startsWith(`${entry}_`)) {
      const rest = normalized.slice(entry.length + 1);

      if (
        CATALOG_SUFFIX.test(rest) &&
        !rest.split("_").some((segment) => FOREIGN_OBJECT_STEMS.has(segment)) &&
        !matchesPayrollPattern(`awcms_${rest}`)
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Validates an exception registry (Issue #1276): exact lower-cased names, a
 * non-empty reason, not a required payroll table, and an actual pattern hit (an
 * exception for a name no pattern flags is dead weight and hides a rename).
 * Returns the problems; empty means valid.
 */
export function validateNonPayrollExceptions(
  exceptions: Readonly<Record<string, string>>
): string[] {
  const problems: string[] = [];

  for (const [name, reason] of Object.entries(exceptions)) {
    if (name !== normalizeTableNameForBoundary(name) || name.includes(".")) {
      problems.push(`${name}: must be an exact, lower-case, schema-less name`);
    }
    if (typeof reason !== "string" || reason.trim().length < 20) {
      problems.push(`${name}: needs a reason (at least 20 characters)`);
    }
    if (PAYROLL_REQUIRED_TABLES.includes(name)) {
      problems.push(`${name}: a required payroll table cannot be excepted`);
    }
    if (!matchesPayrollPattern(name)) {
      problems.push(`${name}: no payroll pattern matches it; remove the entry`);
    }
    if (
      KNOWN_PAYROLL_FAMILY_TABLES.some(
        (known) => known === name || known.startsWith(`${name}_`)
      )
    ) {
      problems.push(
        `${name}: is, or is a prefix of, a known payroll table; an exception would free the family`
      );
    }
  }

  return problems;
}

/** Throws when `exceptions` is invalid. Called at load on the registered list. */
export function assertNonPayrollExceptionsValid(
  exceptions: Readonly<Record<string, string>>
): void {
  const problems = validateNonPayrollExceptions(exceptions);

  if (problems.length > 0) {
    throw new Error(
      `NON_PAYROLL_TABLE_NAME_EXCEPTIONS is invalid: ${problems.join("; ")}`
    );
  }
}

assertNonPayrollExceptionsValid(NON_PAYROLL_TABLE_NAME_EXCEPTIONS);

/** Load-time consistency of the ADR-0173 registries (Issue #1436). */
function assertPayrollAllowListsValid(): void {
  const problems = validatePayrollSecurityDefinerAllowlist(
    PAYROLL_SECURITY_DEFINER_ALLOWLIST
  );
  const fingerprinted = Object.keys(PAYROLL_REQUIRED_TABLE_FINGERPRINTS);

  if (
    fingerprinted.length !== PAYROLL_REQUIRED_TABLES.length ||
    !PAYROLL_REQUIRED_TABLES.every((table) => fingerprinted.includes(table))
  ) {
    problems.push(
      "PAYROLL_REQUIRED_TABLE_FINGERPRINTS must have exactly one entry per PAYROLL_REQUIRED_TABLES table"
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `payroll allow-lists are invalid (ADR-0173): ${problems.join("; ")}`
    );
  }
}

assertPayrollAllowListsValid();

/**
 * True when `name` is a payroll table (or a member of the payroll family).
 * `exceptions` defaults to the registered {@link NON_PAYROLL_TABLE_NAME_EXCEPTIONS};
 * it is a parameter so a test can prove the mechanism without registering a name.
 */
export function isPayrollTable(
  name: string,
  exceptions: Readonly<
    Record<string, string>
  > = NON_PAYROLL_TABLE_NAME_EXCEPTIONS
): boolean {
  const normalized = normalizeTableNameForBoundary(name);

  if (isExceptedFromPayroll(normalized, exceptions)) return false;

  return matchesPayrollPattern(normalized);
}

/**
 * Relations the catalog layer's `payroll-lookalike` comparison skips, each with
 * the reason (Issue #1354). The comparison flags a non-family relation sharing
 * 70% or more of a payroll table's columns; an append-only history table of an
 * unrelated domain shares generic columns (actor, reason, from-state, to-state,
 * created-at, tenant, subject id) and trips it without holding anything about
 * pay. This registry is the sibling of {@link NON_PAYROLL_TABLE_NAME_EXCEPTIONS}
 * and deliberately separate: that one changes payroll-FAMILY membership, this one
 * only skips one comparison.
 *
 * Keys are EXACT, lower-cased, schema-qualified table names (`public.awcms_x`):
 * never a pattern, a prefix or a wildcard, so a copy of a payroll table under any
 * other name is still flagged. An excepted table stays subject to EVERY other
 * rule (grants, RLS, owner, named objects, functions, publications): the only
 * thing skipped is the column-overlap loop in
 * `scripts/lib/payroll-catalog-boundary.ts`. Every entry is a security decision
 * ("this table is not a copy of pay data") and needs security review in the PR
 * that adds it (`hr-payroll.md` section 13). FAIL-CLOSED: empty today.
 */
export const NON_PAYROLL_LOOKALIKE_EXCEPTIONS: Readonly<
  Record<string, string>
> = {};

const LOOKALIKE_EXCEPTION_NAME = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;

/**
 * Validates {@link NON_PAYROLL_LOOKALIKE_EXCEPTIONS}-shaped registries (Issue
 * #1354): exact lower-case `schema.table` names, no wildcard, a non-empty reason
 * of at least 20 characters, and not a payroll-family table (an exception for
 * one is meaningless and would hide a rename). Returns the problems; empty means
 * valid.
 */
export function validateNonPayrollLookalikeExceptions(
  exceptions: Readonly<Record<string, string>>
): string[] {
  const problems: string[] = [];

  for (const [name, reason] of Object.entries(exceptions)) {
    if (/[*%?\[\]\\]/.test(name)) {
      problems.push(`${name}: wildcards and patterns are not allowed`);
    } else if (!LOOKALIKE_EXCEPTION_NAME.test(name)) {
      problems.push(
        `${name}: must be an exact, lower-case, schema-qualified name (schema.table)`
      );
    }
    if (typeof reason !== "string" || reason.trim().length < 20) {
      problems.push(`${name}: needs a reason (at least 20 characters)`);
    }
    if (
      name.startsWith("public.") &&
      (PAYROLL_REQUIRED_TABLES.includes(name.slice("public.".length)) ||
        isPayrollTable(name.slice("public.".length)))
    ) {
      problems.push(
        `${name}: is a payroll-family table; a look-alike exception for it is meaningless`
      );
    }
  }

  return problems;
}

/** Throws when `exceptions` is invalid. Called at load on the registered list. */
export function assertNonPayrollLookalikeExceptionsValid(
  exceptions: Readonly<Record<string, string>>
): void {
  const problems = validateNonPayrollLookalikeExceptions(exceptions);

  if (problems.length > 0) {
    throw new Error(
      `NON_PAYROLL_LOOKALIKE_EXCEPTIONS is invalid: ${problems.join("; ")}`
    );
  }
}

assertNonPayrollLookalikeExceptionsValid(NON_PAYROLL_LOOKALIKE_EXCEPTIONS);

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
