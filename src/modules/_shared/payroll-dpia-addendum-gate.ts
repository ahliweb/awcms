/**
 * The payroll DPIA-addendum go-live gate (Issue #1449; DPIA residuals R-11 and
 * R-13 of `docs/awcms/dpia-hr-payroll-phase-3.md`).
 *
 * ## The problem
 *
 * The platform DPIA (document A, #976) covers the DESIGN of payroll. Each
 * deployment still has to answer what only it can: its purposes, headcount,
 * retention, processors, cross-border transfers, DPO position, employee notice
 * and, through owner decision O5, the legal role of the operator. That answer
 * is the per-deployment ADDENDUM (document B,
 * `docs/awcms/dpia-addendum-hr-payroll-template.md`). Without a control, a
 * deployment could switch payroll on the day the module ships and the addendum
 * would be a document nobody was made to write.
 *
 * ## The control
 *
 * `hr_payroll` cannot be ENABLED for a tenant, and its guarded endpoints refuse
 * every request, until the deployment names an APPROVED addendum:
 *
 * | Variable                          | Meaning                                                        |
 * | --------------------------------- | -------------------------------------------------------------- |
 * | `HR_PAYROLL_DPIA_ADDENDUM_REF`    | file stem of `docs/awcms/dpia-addenda/<ref>.md`                |
 * | `HR_PAYROLL_DPIA_ADDENDUM_APPROVED_ON` | the approval date (ISO `YYYY-MM-DD`), not in the future   |
 * | `HR_PAYROLL_DPIA_ADDENDUM_SHA256` | sha256 of that file's bytes, the version that was approved     |
 *
 * Two layers, because the process that serves requests has no `docs/`
 * directory (the production image carries `dist/` only):
 *
 * 1. **Runtime** (this file, called by `enableTenantModule` and by the
 *    `authorizeInTransaction` chokepoint): the three variables must be present
 *    and well formed. Anything else is a refusal. No variable set is the
 *    default, and the default is "payroll off": fail closed.
 * 2. **Deploy time** (`scripts/lib/payroll-addendum-artifact.ts`, run by
 *    `bun run config:validate` and `bun run security:readiness`): the artifact
 *    exists, its bytes hash to the recorded digest, and its gate record says
 *    `status: approved`, names a controller signatory, a counsel review date and
 *    the O5 outcome, with no unfilled `[[...]]` placeholder left. Editing the
 *    file after approval changes the digest, so the gate goes red until the
 *    controller re-approves and the digest is updated.
 *
 * What this does NOT prove: that the signatory is who the record says, or that
 * the content is legally adequate. It proves the deployment cannot go live
 * WITHOUT a completed, signed-off, unmodified document. Legal sufficiency stays
 * with the controller and counsel (decision K13).
 *
 * ## Why the chokepoint as well as the enable path
 *
 * `awcms_tenant_modules` treats "no row" as ENABLED (`sql/008`). For a module
 * that arrives enabled-by-default, a gate only on the enable endpoint would be
 * decorative: the tenant never enables anything. The chokepoint refusal does
 * not depend on any row.
 *
 * Zero imports: `access-guard`, `module-management`, and the two gate scripts
 * all import this without a cycle.
 */

/**
 * Module keys that require an approved addendum. A key list rather than the
 * `handlesPayrollData` flag on purpose: `hr_commission` carries that flag and is
 * live, and this gate is for the module that holds pay itself (phase 3).
 * `tests/payroll-dpia-addendum-gate.test.ts` fails when a registered module key
 * mentions payroll and is not listed, so a rename cannot escape.
 */
export const PAYROLL_ADDENDUM_GATED_MODULE_KEYS: readonly string[] = [
  "hr_payroll"
];

export const PAYROLL_ADDENDUM_ENV_REF = "HR_PAYROLL_DPIA_ADDENDUM_REF";
export const PAYROLL_ADDENDUM_ENV_APPROVED_ON =
  "HR_PAYROLL_DPIA_ADDENDUM_APPROVED_ON";
export const PAYROLL_ADDENDUM_ENV_SHA256 = "HR_PAYROLL_DPIA_ADDENDUM_SHA256";

/** Where approved addenda live, relative to the repository root. */
export const PAYROLL_ADDENDUM_DIRECTORY = "docs/awcms/dpia-addenda";

/** The `matchedPolicy` written to the decision log when the chokepoint refuses. */
export const PAYROLL_ADDENDUM_REQUIRED_POLICY =
  "payroll_dpia_addendum_required" as const;

export const PAYROLL_ADDENDUM_DENIAL_REASON =
  "Payroll cannot be used until this deployment records an approved data-protection impact assessment addendum.";

/**
 * Section markers the addendum must keep (one `<!-- addendum-section: id -->`
 * line each). The template carries exactly this list, which
 * `tests/payroll-dpia-addendum-gate.test.ts` proves in both languages, so a
 * deployment that deletes a section loses the gate rather than the question.
 */
export const PAYROLL_ADDENDUM_REQUIRED_SECTIONS: readonly string[] = [
  "o5-outcome",
  "purposes-and-basis",
  "headcount-and-data",
  "retention",
  "processors-and-subprocessors",
  "cross-border-transfers",
  "operator-staff-access",
  "dpo-position",
  "employee-notice",
  "residual-risk-treatment",
  "controller-sign-off"
];

export type EnvBag = Record<string, string | undefined>;

export type PayrollAddendumRecord = {
  ref: string;
  approvedOn: string;
  sha256: string;
};

export type PayrollAddendumEnvResult =
  | { ok: true; record: PayrollAddendumRecord }
  | { ok: false; configured: boolean; problems: string[] };

const REF_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRealIsoDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function isPayrollAddendumGatedModule(moduleKey: string): boolean {
  return PAYROLL_ADDENDUM_GATED_MODULE_KEYS.includes(moduleKey);
}

/**
 * Read and validate the three variables. `configured` is `true` when ANY of them
 * is non-empty, so `config:validate` can tell "payroll deliberately off" (no
 * variable: fine) from "half set" (always an error).
 */
export function readPayrollAddendumFromEnv(
  env: EnvBag,
  now: Date = new Date()
): PayrollAddendumEnvResult {
  const ref = (env[PAYROLL_ADDENDUM_ENV_REF] ?? "").trim();
  const approvedOn = (env[PAYROLL_ADDENDUM_ENV_APPROVED_ON] ?? "").trim();
  const sha256 = (env[PAYROLL_ADDENDUM_ENV_SHA256] ?? "").trim();
  const configured = ref !== "" || approvedOn !== "" || sha256 !== "";
  const problems: string[] = [];

  if (!configured) {
    return {
      ok: false,
      configured,
      problems: [
        `${PAYROLL_ADDENDUM_ENV_REF}, ${PAYROLL_ADDENDUM_ENV_APPROVED_ON} and ${PAYROLL_ADDENDUM_ENV_SHA256} are not set.`
      ]
    };
  }

  if (!REF_PATTERN.test(ref)) {
    problems.push(
      `${PAYROLL_ADDENDUM_ENV_REF} must be the file stem of an addendum under ${PAYROLL_ADDENDUM_DIRECTORY}/ (lowercase letters, digits and hyphens, 3 to 64 characters).`
    );
  }

  if (!isRealIsoDate(approvedOn)) {
    problems.push(
      `${PAYROLL_ADDENDUM_ENV_APPROVED_ON} must be a real ISO date (YYYY-MM-DD).`
    );
  } else if (approvedOn > now.toISOString().slice(0, 10)) {
    problems.push(
      `${PAYROLL_ADDENDUM_ENV_APPROVED_ON} is in the future: an addendum cannot have been approved yet.`
    );
  }

  if (!SHA256_PATTERN.test(sha256)) {
    problems.push(
      `${PAYROLL_ADDENDUM_ENV_SHA256} must be the lowercase 64-character sha256 of the approved addendum file.`
    );
  }

  return problems.length > 0
    ? { ok: false, configured, problems }
    : { ok: true, record: { ref, approvedOn, sha256 } };
}

export type PayrollAddendumDenial = {
  reason: string;
  matchedPolicy: typeof PAYROLL_ADDENDUM_REQUIRED_POLICY;
};

/**
 * `null` when there is no objection; a denial when the module is gated and the
 * deployment has not recorded a well-formed addendum. Same shape as
 * `evaluateEntitlementRequirement`: there is no boolean, so no call site can
 * read "this layer had nothing to say" as "approved".
 */
export function evaluatePayrollAddendumRequirement(
  moduleKey: string,
  env: EnvBag,
  now: Date = new Date()
): PayrollAddendumDenial | null {
  if (!isPayrollAddendumGatedModule(moduleKey)) {
    return null;
  }

  return readPayrollAddendumFromEnv(env, now).ok
    ? null
    : {
        reason: PAYROLL_ADDENDUM_DENIAL_REASON,
        matchedPolicy: PAYROLL_ADDENDUM_REQUIRED_POLICY
      };
}

// ---------------------------------------------------------------------------
// The artifact (pure parsing; the file read and the hash live in the script)
// ---------------------------------------------------------------------------

export type PayrollAddendumGateRecord = Record<string, string>;

/**
 * The `## Gate record` section is a list of `- key: value` lines. Keys are
 * lowercased. Parsing stops at the next heading.
 */
export function parsePayrollAddendumGateRecord(
  markdown: string
): PayrollAddendumGateRecord {
  const record: PayrollAddendumGateRecord = {};
  let inside = false;

  for (const line of markdown.split("\n")) {
    if (
      /^##\s+gate record\b/i.test(line) ||
      /^##\s+catatan gerbang\b/i.test(line)
    ) {
      inside = true;
      continue;
    }

    if (inside && /^#{1,6}\s/.test(line)) {
      break;
    }

    const match = /^-\s+([a-z0-9-]+):\s*(.*?)\s*$/i.exec(line);

    if (inside && match) {
      record[match[1]!.toLowerCase()] = match[2]!;
    }
  }

  return record;
}

const PLACEHOLDER = /^(?:|tbd|todo|n\/a|-|<.*>|\[\[.*\]\])$/i;

function filled(value: string | undefined): value is string {
  return value !== undefined && !PLACEHOLDER.test(value.trim());
}

/**
 * Problems with the addendum file content, `[]` when it is acceptable. Pure: the
 * caller supplies the text and the digest it computed.
 */
export function payrollAddendumArtifactProblems(input: {
  markdown: string;
  actualSha256: string;
  expected: PayrollAddendumRecord;
}): string[] {
  const { markdown, actualSha256, expected } = input;
  const problems: string[] = [];

  if (actualSha256 !== expected.sha256) {
    problems.push(
      `${PAYROLL_ADDENDUM_DIRECTORY}/${expected.ref}.md hashes to ${actualSha256}, not the recorded ${PAYROLL_ADDENDUM_ENV_SHA256}. The file changed after approval: the controller must re-approve it and the digest must be updated.`
    );
  }

  const gate = parsePayrollAddendumGateRecord(markdown);

  if ((gate.status ?? "").toLowerCase() !== "approved") {
    problems.push(
      `Gate record 'status' is "${gate.status ?? "missing"}", not "approved".`
    );
  }

  if (!["A", "B"].includes((gate["o5-outcome"] ?? "").toUpperCase())) {
    problems.push(
      "Gate record 'o5-outcome' must be A (operator is processor) or B (joint controller or other, as the DPIA decides)."
    );
  }

  for (const key of [
    "controller-signed-by",
    "controller-signed-on",
    "counsel-reviewed-on"
  ]) {
    if (!filled(gate[key])) {
      problems.push(`Gate record '${key}' is missing or still a placeholder.`);
    }
  }

  for (const key of [
    "controller-signed-on",
    "counsel-reviewed-on",
    "approved-on"
  ]) {
    if (filled(gate[key]) && !isRealIsoDate(gate[key]!)) {
      problems.push(`Gate record '${key}' is not an ISO date (YYYY-MM-DD).`);
    }
  }

  if (gate["approved-on"] !== expected.approvedOn) {
    problems.push(
      `Gate record 'approved-on' (${gate["approved-on"] ?? "missing"}) does not match ${PAYROLL_ADDENDUM_ENV_APPROVED_ON} (${expected.approvedOn}).`
    );
  }

  for (const section of PAYROLL_ADDENDUM_REQUIRED_SECTIONS) {
    if (!markdown.includes(`<!-- addendum-section: ${section} -->`)) {
      problems.push(`Required section marker "${section}" is missing.`);
    }
  }

  const leftover = markdown.match(/\[\[[^\]]*\]\]/g);

  if (leftover) {
    problems.push(
      `${leftover.length} unfilled placeholder(s) remain (for example ${leftover[0]}).`
    );
  }

  return problems;
}
