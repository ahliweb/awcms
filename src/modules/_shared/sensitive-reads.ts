/**
 * The sensitive-read policy registry (Issue #978, finding PS-18 (a);
 * `docs/awcms/hr-payroll.md` sections 11.3, 13.2 and 17).
 *
 * ## What it is
 *
 * A READ of data that is harmful in the wrong hands (a person's pay) is itself
 * an event somebody may later need to explain: "an insider browsing salaries is
 * undetectable" was the finding. This registry names, per permission, the audit
 * kind a read under that permission must leave behind, and how the log is kept
 * from flooding (`coalesceWindowSeconds`).
 *
 * `src/modules/logging/application/sensitive-read-audit.ts` is the one function
 * that writes the audit row (`recordSensitiveRead`), and it takes a PERMISSION
 * KEY, not a kind, severity or window: the policy is looked up here, so a route
 * cannot understate its own severity or turn coalescing on for an export.
 *
 * ## Why it is a central list and not a field on the module descriptor
 *
 * A module-contributed list would be opt-in: a module that forgot to declare
 * its sensitive reads would be checked against nothing, and "forgot" is the
 * failure this exists to stop. Three further reasons:
 *
 * - the policy has to exist BEFORE `hr_payroll` does (the module is blocked on
 *   a DPIA, #976) so that the first route cannot be written without it;
 * - it needs no `MODULE_CONTRACT_VERSION` bump or family-manifest change for a
 *   field every module would carry;
 * - one reviewable file answers "which reads are audited and how loudly".
 *
 * `scripts/sensitive-reads-check.ts` (`bun run sensitive-reads:check`) is the
 * gate. It fails when:
 *
 * 1. a route's source builds an `authorizeInTransaction` guard for a permission
 *    this registry covers and does not call `recordSensitiveRead` for it;
 * 2. a module in {@link SENSITIVE_READ_MODULE_KEYS} declares a `read`, `list`,
 *    `export` or `download` permission that has neither a policy here nor an
 *    entry in {@link NOT_SENSITIVE_READS} (default-deny: a NEW read permission
 *    on payroll is unclassified until someone decides);
 * 3. a policy or an exemption names a permission the module does not declare
 *    (a dead entry), once the module exists.
 *
 * It is syntactic and says so: it proves the call is in the same file as the
 * guard, not that it is on every code path of the handler. That is the class of
 * defect it is for (a route that never thought about it), and
 * `tests/sensitive-read-audit.integration.test.ts` proves the helper itself.
 *
 * Zero imports, like `module-contract.ts`.
 */

export type SensitiveReadSeverity = "info" | "warning";

export type SensitiveReadPolicy = {
  /** `module.activity.action` - the permission whose exercise is the read. */
  permission: string;
  /** The audit `action` written, `sensitive_read.<name>`. */
  kind: string;
  /** The audit `resource_type`. */
  resourceType: string;
  /**
   * Fixed-window length in seconds, or `0` for "every read is its own audit
   * row". Browsing a list is coalesced; an EXPORT is never (one file out is one
   * decision, and the count is the point).
   */
  coalesceWindowSeconds: number;
  /** Severity of the row that OPENS a window (or of every row, when `0`). */
  severity: SensitiveReadSeverity;
  rationale: string;
};

/** The longest window a policy may declare: a day. A longer one hides a day's browsing in one row. */
export const MAX_COALESCE_WINDOW_SECONDS = 86_400;

/**
 * Modules whose `read`/`list`/`export`/`download` permissions must ALL be
 * classified. Add a module here when its reads become sensitive.
 */
export const SENSITIVE_READ_MODULE_KEYS: readonly string[] = [
  "hr_payroll",
  "hr_commission",
  // Issue #1083 (M3 of the #953 review): HR reading every employee's time and
  // productivity facts is an event somebody may later need to explain.
  "hr_workforce"
];

/**
 * Actions that WRITE or transition state and never return a person's data as
 * their purpose. Every OTHER action of a sensitive module (`read`, `list`,
 * `view`, `print`, `export`, `download`, `reveal`, `show` ...) is read-shaped by
 * default and must be classified: default-deny over the action name, so a new
 * spelling of "look at it" cannot slip past a list of read verbs (audit M1).
 */
export const WRITE_SHAPED_ACTIONS: readonly string[] = [
  "create",
  "update",
  "delete",
  "restore",
  "purge",
  "approve",
  "reject",
  "propose",
  "accrue",
  "release",
  "pay",
  "reverse",
  "cancel",
  "lock",
  "calculate",
  "finalise",
  "finalize",
  "publish",
  "retire",
  "configure",
  "assign"
];

export const SENSITIVE_READ_POLICIES: readonly SensitiveReadPolicy[] = [
  {
    permission: "hr_payroll.compensation.read",
    kind: "sensitive_read.compensation",
    resourceType: "compensation",
    coalesceWindowSeconds: 300,
    severity: "info",
    rationale:
      "Salary and pay basis of employees. The reader sees amounts, so the audit row must say that a read happened and how much was read (a count), never what it contained."
  },
  {
    permission: "hr_payroll.runs.read",
    kind: "sensitive_read.run_lines",
    resourceType: "payroll_run_line",
    coalesceWindowSeconds: 300,
    severity: "info",
    rationale:
      "Per-employee earnings, deductions and withholding on run lines. A run header read (totals only) is part of the same permission and is audited too: the permission cannot tell the two apart, and over-recording a header is cheaper than missing a line."
  },
  {
    permission: "hr_payroll.payslips.read",
    kind: "sensitive_read.payslip",
    resourceType: "payslip",
    coalesceWindowSeconds: 300,
    severity: "info",
    rationale:
      "A payslip read through the permission, i.e. by someone OTHER than its owner. The owner reading their own released payslip arrives through an ownership grant and is not recorded (an employee looking at their own pay is not an event to explain); the handler decides that, the audit row is written for every other read."
  },
  {
    permission: "hr_commission.accruals.read",
    kind: "sensitive_read.commission_accrual",
    resourceType: "commission_accrual",
    coalesceWindowSeconds: 300,
    severity: "info",
    rationale:
      "Commission accruals are one employee's earnings: the same small-cohort risk as salary (owner decision on the #978 audit). Lists and single reads alike."
  },
  {
    permission: "hr_workforce.workforce_metrics.read",
    kind: "sensitive_read.workforce_metrics",
    resourceType: "workforce_metrics",
    coalesceWindowSeconds: 300,
    severity: "info",
    rationale:
      "Every employee's attendance, hours and worked-to-scheduled ratio. Recorded in the ALL-employee mode and in the manager-chain `reports` mode (attribute `mode`); only the employee's own read is not recorded (the manager chain can make a director with no HR permission a reader of everyone: Issue #1083 M-2). The row carries employment ids and a count, never a figure. The per-office aggregate route is audited under the same kind with its group count and no ids."
  },
  {
    permission: "hr_workforce.attendance.read",
    kind: "sensitive_read.attendance_events",
    // The recorded ids are EMPLOYMENT ids (Issue #1083 L-4).
    resourceType: "hr_employment",
    coalesceWindowSeconds: 300,
    severity: "info",
    rationale:
      "Every employee's clock-in and clock-out times. Recorded in the ALL-employee mode and in the manager-chain `reports` mode (up to ten levels, attribute `mode`); only the employee's own read is not. Employment ids and a count, never a time."
  },
  {
    permission: "hr_workforce.workforce_metrics.analyze",
    kind: "sensitive_read.workforce_metrics_aggregate",
    resourceType: "workforce_metrics",
    coalesceWindowSeconds: 300,
    severity: "info",
    rationale:
      "The per-office aggregate read by a caller who holds `.analyze` and not `.read`: its own kind (a kind names one policy), so the trail names the permission that actually granted (Issue #1083 L-1). Group count, no ids."
  },
  {
    permission: "hr_workforce.corrections.read",
    kind: "sensitive_read.attendance_corrections",
    resourceType: "hr_employment",
    coalesceWindowSeconds: 300,
    severity: "info",
    rationale:
      "Attendance corrections: the LIST carries every employee's proposed clock times, and the single-record route carries the free-text reason (health, family) to a holder of the permission. The list is recorded in the all and reports modes; the single record only when the reason came from the role grant (not for the requester or an approval assignee). Employment ids and a count, never a time or a reason (Issue #1083 M-1)."
  },
  {
    permission: "hr_commission.*.export",
    kind: "sensitive_read.commission_export",
    resourceType: "commission_export",
    coalesceWindowSeconds: 0,
    severity: "warning",
    rationale:
      "Any export of commission data; one file out is one decision, never coalesced."
  },
  {
    permission: "hr_commission.*.download",
    kind: "sensitive_read.commission_export_download",
    resourceType: "commission_export",
    coalesceWindowSeconds: 0,
    severity: "warning",
    rationale:
      "Fetching a previously generated commission export file; each fetch is its own row."
  },
  {
    permission: "hr_payroll.*.export",
    kind: "sensitive_read.export",
    resourceType: "payroll_export",
    coalesceWindowSeconds: 0,
    severity: "warning",
    rationale:
      "Any export that leaves the system, whatever its activity. One file out is one audit row at warning, never coalesced, carrying the row count and the ids of the records it covered (capped); the row names the exact permission."
  },
  {
    permission: "hr_payroll.*.download",
    kind: "sensitive_read.export_download",
    resourceType: "payroll_export",
    coalesceWindowSeconds: 0,
    severity: "warning",
    rationale:
      "Fetching a previously generated export file. The generation was audited, but a file can be fetched again, by someone else, until it expires; each fetch is its own row."
  }
];

/**
 * Permissions of a sensitive module that are read-shaped and deliberately NOT
 * audited as sensitive reads, each with the reason. A decision, not a backlog:
 * the gate reports an entry whose permission is no longer declared as stale.
 */
export const NOT_SENSITIVE_READS: Readonly<Record<string, string>> = {
  "hr_workforce.employments.read":
    "the employment directory: who works where, under whom and since when, and the employment STATUS (active, suspended, on_leave), the terminated_on date and the terms history (office, manager, title, type). That is organisational fact an HR or scheduling role needs to do the job, not a time, attendance, productivity, location or pay figure; an employee reads their own through an ownership grant. Recorded as a decision for review, not as a claim that nothing sensitive is in it (Issue #1083 L-4).",
  "hr_workforce.shifts.read":
    "the published roster: a planned interval per employment, shared with the team by design. A plan is not an outcome; nothing about attendance. (Issue #1083)",
  "hr_workforce.templates.read":
    "shift patterns (start, duration, break); no person at all. (Issue #1083)",
  "hr_workforce.attendance_evidence.read":
    "location evidence has its own purpose-bound audit row written by auditEvidenceRead on every all-employee read (ADR-0138), and since Issue #1083 L-2 that row carries the employment ids the page covered, so a second generic row would duplicate it.",
  "hr_workforce.self_service.read":
    "a screen gate and the caller's own employment summary (GET /hr-workforce/me joins only the employments linked to the caller's login). The data the screens show is read through attendance.read, corrections.read, workforce_metrics.read and shifts.read, each of which is checked per panel and, outside the employee's own basis, audited per read (Issue #952)",
  "hr_workforce.settings.read":
    "tenant clock-skew and evidence settings; no person, no time. (Issue #1083)",
  "hr_commission.my_accruals.read":
    "an employee reading their OWN accruals (Issue #952): the query joins the live employment linked to the caller's login, so no other person's row can be asked for, the view omits the approver, payer and payment reference, and there is no export. The owner-reads-own precedent of payslips.read: an employee looking at their own earnings is not an event to explain; anyone else's accruals go through accruals.read, which is audited",
  "hr_commission.rules.read":
    "published commission rules (rates, tiers, windows); the same for every employee, no person and no amount earned",
  "hr_payroll.payout_accounts.reveal":
    "a clear disclosure that has its own warning audit row recording THAT it happened and by whom, never the value (hr-payroll.md section 11.3)",
  "hr_payroll.periods.read":
    "dates and lock state of a pay period; no person, no amount",
  "hr_payroll.rules.read":
    "published pay-rule versions (formulas, rates, citations); the same for every employee",
  "hr_payroll.sod_policy.read":
    "tenant segregation-of-duties configuration; no person, no amount",
  "hr_payroll.payout_accounts.read":
    "the MASKED account only (last digits); clear disclosure is `payout_accounts.reveal`, which has its own warning audit row (hr-payroll.md section 11.3)"
};

/**
 * The policy for a permission: an exact entry first, then a module-wide
 * `module.*.action` entry (used for exports, whose activity is not known until
 * the module exists). Returns the first match in declaration order.
 */
/**
 * Source files that name a payroll-boundary table and do NOT call
 * `recordSensitiveRead` themselves, each with the reason it is acceptable
 * (any `module.ts` is exempt as a descriptor-only file). A decision, not a
 * backlog: an entry for a file that no longer needs it is reported as stale.
 */
export const PAYROLL_TABLE_SOURCE_EXEMPTIONS: Readonly<Record<string, string>> =
  {
    "src/modules/hr-commission/application/hr-commission-accrual-ledger.ts":
      "the data-access layer of the ledger (writes and reads alike). Its read entry points, listAccruals and getAccrual, are called by the accruals GET routes AND by the POST accrue route (which returns the stored accrual on a replay); each of those call sites calls recordSensitiveRead for hr_commission.accruals.read (and no other file may import those functions: PAYROLL_READ_FUNCTION_IMPORTS, Issue #1015): the GETs always, the POST on both its replayed branch and its Idempotency-Key replay (tests/hr-commission-read-audit.test.ts)",
    "src/modules/_shared/payroll-data-boundary.ts":
      "the boundary's own definition: it names the payroll tables in comments and in PAYROLL_REQUIRED_TABLES so the catalog layer can assert they exist (Issue #1077, M1). It has no imports and runs no query, so it reads no row",
    "scripts/security-readiness.ts":
      "the operator readiness report. It names the ledger in a grants table and in reportSelfSettledCommissionAccruals, which selects ONLY accrual ids (no amount, no beneficiary, no status) per active tenant under RLS to flag settlement by the beneficiary themselves (Issue #1019); the output is a count and a capped id list for the operator, not a read of earnings (Issue #1077, M7: scripts are now scanned)",
    "scripts/data-lifecycle-table-coverage-check.ts":
      "a static registry of table NAMES with their retention rationale; it runs no query and reads no row (Issue #1077, M7: scripts are now scanned)",
    "src/modules/hr-workforce/application/hr-workforce-directory.ts":
      "assignAccount runs a single EXISTS over the commission accrual ledger (status not paid or voided) to decide whether re-linking an employment's login needs the ADR-0141 step-up (Issue #1019). It returns one boolean, never a row, an amount, a rule or a status, so no accrual data reaches a caller or a response; the mutation itself is audited at critical with the before/after login ids"
  };

/**
 * Which permission's audit covers a read of which payroll-boundary table
 * (Issue #1015, M-A remainder). The first gate asked only "does this file call
 * `recordSensitiveRead` at all", so a file that audited `compensation.read`
 * was exempt for EVERY payroll table it read, `payslips` included. The gate now
 * attributes per table: each payroll table a source names needs an audit call
 * whose permission is in the list below (an `export` or `download` audit of the
 * same module also counts: one file out is the loudest record there is).
 *
 * First match wins. An EMPTY `permissions` list means no `recordSensitiveRead`
 * can stand for the table (a payout account's clear disclosure has its own
 * warning audit row, `payout_accounts.reveal`), so a file naming it must be in
 * {@link PAYROLL_TABLE_SOURCE_EXEMPTIONS} with the reason. A payroll-boundary
 * table that matches no entry is the same: default-deny, the mapping is the
 * decision.
 */
export type PayrollTableReadMapping = {
  table: RegExp;
  module: string;
  permissions: readonly string[];
};

export const PAYROLL_TABLE_READ_PERMISSIONS: readonly PayrollTableReadMapping[] =
  [
    {
      table: /^awcms_hr_commission_(?:accruals?|transitions)$/,
      module: "hr_commission",
      permissions: ["hr_commission.accruals.read"]
    },
    {
      table: /payslips?/,
      module: "hr_payroll",
      permissions: ["hr_payroll.payslips.read"]
    },
    {
      table: /payouts?/,
      module: "hr_payroll",
      permissions: []
    },
    {
      table: /compensations?|salary|salaries|wages?/,
      module: "hr_payroll",
      permissions: ["hr_payroll.compensation.read"]
    },
    {
      table: /payrolls?/,
      module: "hr_payroll",
      permissions: ["hr_payroll.runs.read"]
    }
  ];

/** The mapping that governs `table` (lower-cased, schema-stripped), or undefined. */
export function findPayrollTableReadMapping(
  table: string
): PayrollTableReadMapping | undefined {
  const name = table.replace(/"/g, "").toLowerCase().split(".").pop()!;

  return PAYROLL_TABLE_READ_PERMISSIONS.find((entry) => entry.table.test(name));
}

/** True when a `recordSensitiveRead` for any of `audited` stands for a read of `table`. */
export function auditCoversPayrollTable(
  table: string,
  audited: ReadonlySet<string>
): boolean {
  const mapping = findPayrollTableReadMapping(table);

  if (!mapping) return false;

  for (const permission of audited) {
    if (mapping.permissions.includes(permission)) return true;

    const [moduleKey, , action] = permission.split(".");

    if (
      moduleKey === mapping.module &&
      mapping.permissions.length > 0 &&
      (action === "export" || action === "download")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Read functions of a payroll data-access file that may be imported only by the
 * files named here (Issue #1015, M-A remainder). The exempt ledger file is
 * trusted because "its callers audit"; that was a written reason, and nothing
 * made it true of a NEW caller. Now it is checked: a source that imports one of
 * `functions` from `source` (named, namespace, default, re-exported, dynamic)
 * must be in `allowedImporters` AND call `recordSensitiveRead` for
 * `permission` itself. Tests are not scanned (the gate reads `src/`).
 */
export type PayrollReadFunctionImport = {
  /** Repo path of the data-access file. */
  source: string;
  functions: readonly string[];
  permission: string;
  allowedImporters: readonly string[];
  /**
   * Allow-listed importers that need NOT audit `permission` themselves, each
   * with the reason (Issue #1077, M7). For the write-path functions
   * (`accrueCommission`, `transitionAccrual`): their callers are mutations
   * audited by their own events, and a NEW caller is still refused because it
   * is not in `allowedImporters`.
   */
  auditExemptImporters?: Readonly<Record<string, string>>;
  /**
   * The functions of `functions` that an audit-exempt importer may import (and
   * only these: one import of anything else puts the audit back). For the
   * ledger's entry they are the mutations' functions; for the own-only entry
   * (Issue #952) they are the own-only readers, whose query is bound to the
   * caller's login and can return no other person's row.
   */
  writePathFunctions?: readonly string[];
};

export const PAYROLL_READ_FUNCTION_IMPORTS: readonly PayrollReadFunctionImport[] =
  [
    {
      source:
        "src/modules/hr-commission/application/hr-commission-accrual-ledger.ts",
      // The write path RETURNS the accrual too (Issue #1077, M7):
      // `accrueCommission` gives back the stored row, `transitionAccrual` the row
      // after the edge. They were outside this list, so a new route could return
      // an accrual to a caller that no read audit ever saw. Now a new caller of
      // ANY of the five must be named below.
      functions: [
        "listAccruals",
        "getAccrual",
        "reconcileAccruals",
        "accrueCommission",
        "transitionAccrual"
      ],
      permission: "hr_commission.accruals.read",
      allowedImporters: [
        "src/pages/api/v1/hr-commission/accruals/index.ts",
        "src/pages/api/v1/hr-commission/accruals/[id].ts",
        "src/pages/api/v1/hr-commission/accruals/[id]/approve.ts",
        "src/pages/api/v1/hr-commission/accruals/[id]/release.ts",
        "src/pages/api/v1/hr-commission/accruals/[id]/pay.ts",
        "src/pages/api/v1/hr-commission/accruals/[id]/void.ts",
        "src/modules/hr-commission/application/hr-commission-accrual-port-adapter.ts"
      ],
      // The existing mutation callers are audited as mutations by their own
      // high-risk events. Whether they should ALSO record a read, or return a
      // masked shape to a caller who holds only the transition power, is a
      // product decision recorded as a remaining limit in hr-payroll.md section
      // 13.3. The exemption covers an importer only while it imports nothing but
      // these functions.
      writePathFunctions: ["accrueCommission", "transitionAccrual"],
      auditExemptImporters: {
        "src/pages/api/v1/hr-commission/accruals/[id]/approve.ts":
          "a mutation audited at warning severity by its own event (never with an amount); returns the transitioned accrual to the actor who holds the approve power",
        "src/pages/api/v1/hr-commission/accruals/[id]/release.ts":
          "a mutation audited by its own event; returns the transitioned accrual to the actor who holds the release power",
        "src/pages/api/v1/hr-commission/accruals/[id]/pay.ts":
          "a mutation audited by its own event; returns the transitioned accrual to the actor who holds the pay power",
        "src/pages/api/v1/hr-commission/accruals/[id]/void.ts":
          "a mutation audited by its own event; returns the transitioned accrual to the actor who holds the void power",
        "src/modules/hr-commission/application/hr-commission-accrual-port-adapter.ts":
          "the in-process CommissionAccrualPort for other modules; it maps the ledger result to the port shape and exposes no HTTP surface"
      }
    },
    {
      // The in-process port wraps `accrueCommission`, so whoever calls it
      // accrues commission and gets the stored accrual back (Issue #1077 audit,
      // M6). Nothing imports it today; the first importer must be named here.
      source:
        "src/modules/hr-commission/application/hr-commission-accrual-port-adapter.ts",
      functions: ["createCommissionAccrualPort"],
      permission: "hr_commission.accruals.read",
      allowedImporters: []
    },
    {
      // Issue #952: the OWN-ONLY readers behind /my-accruals and the employee's
      // own-commission screen. The query joins the live employment linked to the
      // caller's login, so there is no way to ask for another person's row.
      source:
        "src/modules/hr-commission/application/hr-commission-accrual-ledger.ts",
      functions: ["listOwnAccruals", "getOwnAccrual"],
      permission: "hr_commission.my_accruals.read",
      allowedImporters: [
        "src/pages/api/v1/hr-commission/my-accruals/index.ts",
        "src/pages/api/v1/hr-commission/my-accruals/[id].ts",
        "src/pages/admin/hr/my-commission.astro"
      ],
      writePathFunctions: ["listOwnAccruals", "getOwnAccrual"],
      auditExemptImporters: {
        "src/pages/api/v1/hr-commission/my-accruals/index.ts":
          "own-only: an employee reading their own earnings (owner-reads-own, as payslips.read); the query is bound to the caller's login",
        "src/pages/api/v1/hr-commission/my-accruals/[id].ts":
          "own-only: an employee reading their own earnings (owner-reads-own, as payslips.read); the query is bound to the caller's login",
        "src/pages/admin/hr/my-commission.astro":
          "own-only: the employee's own-commission screen; the query is bound to the caller's login"
      }
    }
  ];

export function findSensitiveReadPolicy(
  permission: string,
  policies: readonly SensitiveReadPolicy[] = SENSITIVE_READ_POLICIES
): SensitiveReadPolicy | undefined {
  const exact = policies.find((policy) => policy.permission === permission);

  if (exact) return exact;

  const [moduleKey, , action] = permission.split(".");

  return policies.find(
    (policy) => policy.permission === `${moduleKey}.*.${action}`
  );
}

/** The module key a permission key belongs to (`hr_payroll.runs.read` -> `hr_payroll`). */
export function moduleKeyOfPermission(permission: string): string {
  return permission.split(".")[0] ?? "";
}

/** An exact key, or `module.*.action` for every activity of a module. */
const PERMISSION_KEY_PATTERN =
  /^[a-z][a-z0-9_]*\.(?:[a-z][a-z0-9_]*|\*)\.[a-z][a-z0-9_]*$/;
const KIND_PATTERN = /^sensitive_read\.[a-z][a-z0-9_]{0,40}$/;
const RESOURCE_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/** Structural problems with a policy list. Pure; the gate and a test both call it. */
export function validateSensitiveReadPolicies(
  policies: readonly SensitiveReadPolicy[] = SENSITIVE_READ_POLICIES
): string[] {
  const problems: string[] = [];
  const permissions = new Set<string>();
  const kinds = new Set<string>();

  for (const policy of policies) {
    const label = policy.permission || "(missing permission)";

    if (!PERMISSION_KEY_PATTERN.test(policy.permission)) {
      problems.push(
        `${label}: permission must be a "module.activity.action" key.`
      );
    }

    if (permissions.has(policy.permission)) {
      problems.push(`${label}: declared more than once.`);
    }
    permissions.add(policy.permission);

    if (!KIND_PATTERN.test(policy.kind)) {
      problems.push(
        `${label}: kind ${JSON.stringify(policy.kind)} must look like "sensitive_read.<name>".`
      );
    }

    // Two permissions sharing a kind would share one window, and a heavy reader
    // of one would hide inside the other's count.
    if (kinds.has(policy.kind)) {
      problems.push(
        `${label}: kind ${JSON.stringify(policy.kind)} is used by another policy.`
      );
    }
    kinds.add(policy.kind);

    if (!RESOURCE_TYPE_PATTERN.test(policy.resourceType)) {
      problems.push(`${label}: resourceType must be snake_case.`);
    }

    if (
      !Number.isInteger(policy.coalesceWindowSeconds) ||
      policy.coalesceWindowSeconds < 0 ||
      policy.coalesceWindowSeconds > MAX_COALESCE_WINDOW_SECONDS
    ) {
      problems.push(
        `${label}: coalesceWindowSeconds must be an integer in 0..${MAX_COALESCE_WINDOW_SECONDS}.`
      );
    }

    if (policy.severity !== "info" && policy.severity !== "warning") {
      problems.push(`${label}: severity must be "info" or "warning".`);
    }

    if (
      (policy.permission.endsWith(".export") ||
        policy.permission.endsWith(".download")) &&
      policy.coalesceWindowSeconds !== 0
    ) {
      problems.push(
        `${label}: an export must not be coalesced (coalesceWindowSeconds must be 0).`
      );
    }

    if (!policy.rationale || policy.rationale.trim().length < 20) {
      problems.push(`${label}: rationale is required.`);
    }
  }

  return problems;
}
