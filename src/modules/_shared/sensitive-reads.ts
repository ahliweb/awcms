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
  "hr_commission"
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
      "the data-access layer of the ledger (writes and reads alike). Its read entry points, listAccruals and getAccrual, are called by the accruals GET routes AND by the POST accrue route (which returns the stored accrual on a replay); each of those call sites calls recordSensitiveRead for hr_commission.accruals.read: the GETs always, the POST on both its replayed branch and its Idempotency-Key replay (tests/hr-commission-read-audit.test.ts)"
  };

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
