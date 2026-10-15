/**
 * Employments, their effective-dated terms and the tenant settings (Issue #945,
 * ADR-0132, `docs/awcms/hr-payroll.md` sections 3 and 4.1).
 *
 * ## Identity ownership
 *
 * An employment REFERENCES a `profile_identity` party (`profile_id`) and nothing
 * here copies its name, contact, birth date or national id. A read returns the
 * reference; a screen resolves the display through `profile_identity`.
 *
 * ## Transactions
 *
 * `tx` is the caller's tenant transaction. A failed statement aborts a Postgres
 * transaction, so the "already exists" case is handled with `ON CONFLICT ... DO
 * NOTHING RETURNING` and every refusal the schema's triggers can raise
 * (manager cycle/depth, overlap, terminated) is pre-checked here and mapped to
 * an outcome; the triggers are the backstop for a path that bypasses this file.
 *
 * Audit rows carry what happened and to which employment id, never a title, a
 * number or a name; the account link's row also carries the login's UUID.
 */
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  keysetCursorCreatedAtSql,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import { recordAuditEvent } from "../../logging/application/audit-log";
import { HR_WORKFORCE_MODULE_KEY } from "../domain/hr-workforce-permissions";
import {
  DEFAULT_CLOCK_SKEW_SECONDS,
  DEFAULT_CORRECTION_WORKFLOW_KEY,
  type EmploymentStatus,
  type EmploymentType
} from "../domain/hr-workforce-types";
import type {
  ChangeTermsInput,
  CreateEmploymentInput,
  SettingsInput,
  TermsInput
} from "../domain/hr-workforce-validation";

export const EMPLOYMENT_PAGE_SIZE = 100;
export const MANAGER_CHAIN_MAX_DEPTH = 10;

type Actor = {
  actorTenantUserId: string | null;
  correlationId: string | undefined;
};

export type EmploymentTerm = {
  id: string;
  officeId: string | null;
  managerEmploymentId: string | null;
  jobTitle: string | null;
  employmentType: EmploymentType;
  status: EmploymentStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
};

/**
 * The employment as the API shows it. `accountLinked` says whether a login is
 * attached; the login's id is deliberately NOT returned (it is the ownership
 * basis, not something a reader needs).
 */
export type Employment = {
  id: string;
  profileId: string;
  employeeNo: string;
  hiredOn: string;
  terminatedOn: string | null;
  accountLinked: boolean;
  createdAt: string;
  deletedAt: string | null;
  currentTerm: EmploymentTerm | null;
};

type EmploymentRow = {
  id: string;
  profile_id: string;
  employee_no: string;
  hired_on: string;
  terminated_on: string | null;
  account_linked: boolean;
  created_at: Date | string;
  deleted_at: Date | string | null;
  term_id: string | null;
  office_id: string | null;
  manager_employment_id: string | null;
  job_title: string | null;
  employment_type: EmploymentType | null;
  term_status: EmploymentStatus | null;
  effective_from: string | null;
  effective_to: string | null;
};

type TermRow = {
  id: string;
  office_id: string | null;
  manager_employment_id: string | null;
  job_title: string | null;
  employment_type: EmploymentType;
  status: EmploymentStatus;
  effective_from: string;
  effective_to: string | null;
};

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

function mapTerm(row: TermRow): EmploymentTerm {
  return {
    id: row.id,
    officeId: row.office_id,
    managerEmploymentId: row.manager_employment_id,
    jobTitle: row.job_title,
    employmentType: row.employment_type,
    status: row.status,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to
  };
}

function mapEmployment(row: EmploymentRow): Employment {
  return {
    id: row.id,
    profileId: row.profile_id,
    employeeNo: row.employee_no,
    hiredOn: row.hired_on,
    terminatedOn: row.terminated_on,
    accountLinked: row.account_linked,
    createdAt: iso(row.created_at),
    deletedAt: row.deleted_at ? iso(row.deleted_at) : null,
    currentTerm: row.term_id
      ? {
          id: row.term_id,
          officeId: row.office_id,
          managerEmploymentId: row.manager_employment_id,
          jobTitle: row.job_title,
          employmentType: row.employment_type!,
          status: row.term_status!,
          effectiveFrom: row.effective_from!,
          effectiveTo: row.effective_to
        }
      : null
  };
}

// The current term is the open one, or the one that closed last (a header
// always has at least one term, and a terminated employment's last term is the
// open `terminated` row).
const EMPLOYMENT_SELECT = `
  e.id, e.profile_id, e.employee_no,
  to_char(e.hired_on, 'YYYY-MM-DD') AS hired_on,
  to_char(e.terminated_on, 'YYYY-MM-DD') AS terminated_on,
  (e.tenant_user_id IS NOT NULL) AS account_linked,
  e.created_at, e.deleted_at,
  t.id AS term_id, t.office_id, t.manager_employment_id, t.job_title,
  t.employment_type, t.status AS term_status,
  to_char(t.effective_from, 'YYYY-MM-DD') AS effective_from,
  to_char(t.effective_to, 'YYYY-MM-DD') AS effective_to
`;

const CURRENT_TERM_JOIN = `
  LEFT JOIN LATERAL (
    SELECT * FROM awcms_hr_employment_terms ct
    WHERE ct.tenant_id = e.tenant_id AND ct.employment_id = e.id
    ORDER BY ct.effective_from DESC
    LIMIT 1
  ) t ON true
`;

export async function getEmployment(
  tx: Bun.SQL,
  tenantId: string,
  employmentId: string,
  options: { includeDeleted?: boolean } = {}
): Promise<Employment | null> {
  const includeDeleted = options.includeDeleted ?? false;
  const rows = (await tx`
    SELECT ${tx.unsafe(EMPLOYMENT_SELECT)}
    FROM awcms_hr_employments e
    ${tx.unsafe(CURRENT_TERM_JOIN)}
    WHERE e.tenant_id = ${tenantId} AND e.id = ${employmentId}
      AND (${includeDeleted} OR e.deleted_at IS NULL)
  `) as EmploymentRow[];

  return rows[0] ? mapEmployment(rows[0]) : null;
}

/**
 * Is this employment (live) linked to this login? The ownership basis for
 * "an employee sees their own" (ADR-0063 `ownershipGrant`). Answers `false`
 * identically for "no such row", "someone else's" and "deleted", so the caller
 * cannot use the 403 as an existence oracle.
 */
export async function employmentOwnedBy(
  tx: Bun.SQL,
  tenantId: string,
  employmentId: string,
  tenantUserId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT 1 AS owned FROM awcms_hr_employments
    WHERE tenant_id = ${tenantId} AND id = ${employmentId}
      AND tenant_user_id = ${tenantUserId} AND deleted_at IS NULL
  `) as { owned: number }[];

  return rows.length > 0;
}

export type EmploymentListFilters = {
  /** `active` = not terminated; `terminated` = ended. */
  state?: "active" | "terminated";
  officeId?: string;
  includeDeleted?: boolean;
  /** When set, ONLY this login's own employment is returned. */
  ownedByTenantUserId?: string;
};

export function parseEmploymentCursor(cursor: string): KeysetCursor | null {
  return decodeKeysetCursor(cursor);
}

export async function listEmployments(
  tx: Bun.SQL,
  tenantId: string,
  filters: EmploymentListFilters,
  cursor?: KeysetCursor
): Promise<{ employments: Employment[]; nextCursor: string | null }> {
  const state = filters.state ?? null;
  const officeId = filters.officeId ?? null;
  const includeDeleted = filters.includeDeleted ?? false;
  const owner = filters.ownedByTenantUserId ?? null;
  const cursorCreatedAt = cursor ? cursor.createdAt : null;
  const cursorId = cursor ? cursor.id : null;

  const rows = (await tx`
    SELECT ${tx.unsafe(EMPLOYMENT_SELECT)},
           ${tx.unsafe(keysetCursorCreatedAtSql("e"))} AS created_at_cursor
    FROM awcms_hr_employments e
    ${tx.unsafe(CURRENT_TERM_JOIN)}
    WHERE e.tenant_id = ${tenantId}
      AND (${includeDeleted} OR e.deleted_at IS NULL)
      AND (${owner}::uuid IS NULL OR e.tenant_user_id = ${owner}::uuid)
      AND (${state}::text IS NULL
           OR (${state}::text = 'active' AND e.terminated_on IS NULL)
           OR (${state}::text = 'terminated' AND e.terminated_on IS NOT NULL))
      AND (${officeId}::uuid IS NULL OR t.office_id = ${officeId}::uuid)
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (e.created_at, e.id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT ${EMPLOYMENT_PAGE_SIZE}
  `) as (EmploymentRow & { created_at_cursor: string })[];

  const last = rows[rows.length - 1];

  return {
    employments: rows.map(mapEmployment),
    nextCursor:
      rows.length === EMPLOYMENT_PAGE_SIZE && last
        ? encodeKeysetCursor(last.created_at_cursor, last.id)
        : null
  };
}

/** Every term of one employment, oldest first (bounded: one row per change). */
export async function listTerms(
  tx: Bun.SQL,
  tenantId: string,
  employmentId: string
): Promise<EmploymentTerm[]> {
  const rows = (await tx`
    SELECT id, office_id, manager_employment_id, job_title, employment_type,
           status,
           to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
           to_char(effective_to, 'YYYY-MM-DD') AS effective_to
    FROM awcms_hr_employment_terms
    WHERE tenant_id = ${tenantId} AND employment_id = ${employmentId}
    ORDER BY effective_from ASC
    LIMIT 500
  `) as TermRow[];

  return rows.map(mapTerm);
}

// --- Reference checks (all inside the tenant transaction) ----------------------

async function profileUsable(
  tx: Bun.SQL,
  tenantId: string,
  profileId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT 1 AS present FROM awcms_profiles
    WHERE tenant_id = ${tenantId} AND id = ${profileId}
      AND deleted_at IS NULL AND status = 'active'
  `) as { present: number }[];

  return rows.length > 0;
}

async function officeExists(
  tx: Bun.SQL,
  tenantId: string,
  officeId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT 1 AS present FROM awcms_offices
    WHERE tenant_id = ${tenantId} AND id = ${officeId} AND deleted_at IS NULL
  `) as { present: number }[];

  return rows.length > 0;
}

async function liveEmploymentExists(
  tx: Bun.SQL,
  tenantId: string,
  employmentId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT 1 AS present FROM awcms_hr_employments
    WHERE tenant_id = ${tenantId} AND id = ${employmentId}
      AND deleted_at IS NULL
  `) as { present: number }[];

  return rows.length > 0;
}

/**
 * Would `managerId` as the manager of `employmentId` make the chain cyclic or
 * longer than {@link MANAGER_CHAIN_MAX_DEPTH} edges (counting the subtree BELOW
 * the employee, not only the chain above the manager)?
 *
 * The rule lives in ONE SQL function (`awcms_hr_manager_chain_problem`,
 * `sql/176`) shared with the BEFORE INSERT trigger, so the two cannot drift. It
 * also takes the per-tenant advisory lock that serialises manager-edge writes
 * until this transaction commits; calling it here, before any write, means the
 * pre-check and the trigger decide on the same committed state.
 */
async function managerChainProblem(
  tx: Bun.SQL,
  tenantId: string,
  employmentId: string | null,
  managerId: string
): Promise<"cycle" | "depth" | null> {
  const rows = (await tx`
    SELECT awcms_hr_manager_chain_problem(
      ${tenantId}::uuid, ${employmentId}::uuid, ${managerId}::uuid
    ) AS problem
  `) as { problem: "cycle" | "depth" | null }[];

  return rows[0]?.problem ?? null;
}

type TermsRefusal =
  | { outcome: "office_not_found" }
  | { outcome: "manager_not_found" }
  | { outcome: "manager_cycle" }
  | { outcome: "manager_depth" };

async function checkTermsReferences(
  tx: Bun.SQL,
  tenantId: string,
  employmentId: string | null,
  terms: TermsInput
): Promise<TermsRefusal | null> {
  if (terms.officeId && !(await officeExists(tx, tenantId, terms.officeId))) {
    return { outcome: "office_not_found" };
  }

  if (terms.managerEmploymentId) {
    if (
      !(await liveEmploymentExists(tx, tenantId, terms.managerEmploymentId))
    ) {
      return { outcome: "manager_not_found" };
    }

    const problem = await managerChainProblem(
      tx,
      tenantId,
      employmentId,
      terms.managerEmploymentId
    );

    if (problem === "cycle") {
      return { outcome: "manager_cycle" };
    }

    if (problem === "depth") {
      return { outcome: "manager_depth" };
    }
  }

  return null;
}

// --- Writes --------------------------------------------------------------------

export type CreateEmploymentOutcome =
  | { outcome: "ok"; employment: Employment }
  | { outcome: "profile_not_found" }
  | { outcome: "already_employed" }
  | { outcome: "duplicate_employee_no" }
  | TermsRefusal;

export async function createEmployment(
  tx: Bun.SQL,
  tenantId: string,
  actor: Actor,
  input: CreateEmploymentInput
): Promise<CreateEmploymentOutcome> {
  if (!(await profileUsable(tx, tenantId, input.profileId))) {
    return { outcome: "profile_not_found" };
  }

  const refusal = await checkTermsReferences(tx, tenantId, null, input.terms);

  if (refusal) {
    return refusal;
  }

  const inserted = (await tx`
    INSERT INTO awcms_hr_employments
      (tenant_id, profile_id, employee_no, hired_on, created_by, updated_by)
    VALUES (${tenantId}, ${input.profileId}, ${input.employeeNo},
            ${input.hiredOn}::date, ${actor.actorTenantUserId},
            ${actor.actorTenantUserId})
    ON CONFLICT DO NOTHING
    RETURNING id
  `) as { id: string }[];

  const id = inserted[0]?.id;

  if (!id) {
    // One of the two partial unique indexes refused it. Say which.
    const numberTaken = (await tx`
      SELECT 1 AS taken FROM awcms_hr_employments
      WHERE tenant_id = ${tenantId} AND lower(employee_no) = lower(${input.employeeNo})
        AND deleted_at IS NULL
    `) as { taken: number }[];

    return numberTaken.length > 0
      ? { outcome: "duplicate_employee_no" }
      : { outcome: "already_employed" };
  }

  await insertTerm(tx, tenantId, id, input.hiredOn, input.terms, actor);

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_WORKFORCE_MODULE_KEY,
    action: "hr_workforce.employment.created",
    resourceType: "hr_employment",
    resourceId: id,
    severity: "info",
    message: "Employment created.",
    attributes: {
      employmentType: input.terms.employmentType,
      status: input.terms.status
    },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    employment: (await getEmployment(tx, tenantId, id))!
  };
}

async function insertTerm(
  tx: Bun.SQL,
  tenantId: string,
  employmentId: string,
  effectiveFrom: string,
  terms: TermsInput,
  actor: Actor
): Promise<void> {
  await tx`
    INSERT INTO awcms_hr_employment_terms
      (tenant_id, employment_id, office_id, manager_employment_id, job_title,
       employment_type, status, effective_from, created_by)
    VALUES (${tenantId}, ${employmentId}, ${terms.officeId},
            ${terms.managerEmploymentId}, ${terms.jobTitle},
            ${terms.employmentType}, ${terms.status},
            ${effectiveFrom}::date, ${actor.actorTenantUserId})
  `;
}

type HeaderLock = {
  id: string;
  hired_on: string;
  terminated_on: string | null;
  deleted_at: Date | null;
};

async function lockHeader(
  tx: Bun.SQL,
  tenantId: string,
  employmentId: string
): Promise<HeaderLock | null> {
  const rows = (await tx`
    SELECT id, to_char(hired_on, 'YYYY-MM-DD') AS hired_on,
           to_char(terminated_on, 'YYYY-MM-DD') AS terminated_on, deleted_at
    FROM awcms_hr_employments
    WHERE tenant_id = ${tenantId} AND id = ${employmentId}
    FOR UPDATE
  `) as HeaderLock[];

  return rows[0] ?? null;
}

export type ChangeTermsOutcome =
  | { outcome: "ok"; replayed: boolean; employment: Employment }
  | { outcome: "not_found" }
  | { outcome: "deleted" }
  | { outcome: "terminated" }
  | { outcome: "before_hire" }
  | { outcome: "out_of_order" }
  | TermsRefusal;

function sameTerms(current: EmploymentTerm, input: ChangeTermsInput): boolean {
  return (
    current.effectiveFrom === input.effectiveFrom &&
    current.officeId === input.terms.officeId &&
    current.managerEmploymentId === input.terms.managerEmploymentId &&
    current.jobTitle === input.terms.jobTitle &&
    current.employmentType === input.terms.employmentType &&
    current.status === input.terms.status
  );
}

/**
 * Append the next terms. Closes the open row at the new `effectiveFrom` and
 * inserts the new one; history is never edited. Re-sending the identical terms
 * is a no-op that answers `replayed: true`.
 */
export async function changeTerms(
  tx: Bun.SQL,
  tenantId: string,
  employmentId: string,
  actor: Actor,
  input: ChangeTermsInput
): Promise<ChangeTermsOutcome> {
  const header = await lockHeader(tx, tenantId, employmentId);

  if (!header) {
    return { outcome: "not_found" };
  }

  if (header.deleted_at) {
    return { outcome: "deleted" };
  }

  const current = (await listTerms(tx, tenantId, employmentId)).at(-1) ?? null;

  if (current && sameTerms(current, input)) {
    return {
      outcome: "ok",
      replayed: true,
      employment: (await getEmployment(tx, tenantId, employmentId))!
    };
  }

  if (header.terminated_on) {
    return { outcome: "terminated" };
  }

  if (input.effectiveFrom < header.hired_on) {
    return { outcome: "before_hire" };
  }

  if (current && input.effectiveFrom <= current.effectiveFrom) {
    return { outcome: "out_of_order" };
  }

  const refusal = await checkTermsReferences(
    tx,
    tenantId,
    employmentId,
    input.terms
  );

  if (refusal) {
    return refusal;
  }

  if (current) {
    await tx`
      UPDATE awcms_hr_employment_terms
      SET effective_to = ${input.effectiveFrom}::date
      WHERE tenant_id = ${tenantId} AND id = ${current.id}
        AND effective_to IS NULL
    `;
  }

  await insertTerm(
    tx,
    tenantId,
    employmentId,
    input.effectiveFrom,
    input.terms,
    actor
  );

  await tx`
    UPDATE awcms_hr_employments
    SET updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${employmentId}
  `;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_WORKFORCE_MODULE_KEY,
    action: "hr_workforce.employment.terms_changed",
    resourceType: "hr_employment",
    resourceId: employmentId,
    severity: input.terms.status === "terminated" ? "warning" : "info",
    message: "Employment terms changed.",
    attributes: {
      status: input.terms.status,
      employmentType: input.terms.employmentType
    },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    replayed: false,
    employment: (await getEmployment(tx, tenantId, employmentId))!
  };
}

export type AssignAccountOutcome =
  | { outcome: "ok"; replayed: boolean; employment: Employment }
  | { outcome: "not_found" }
  | { outcome: "deleted" }
  | { outcome: "terminated" }
  | { outcome: "user_not_found" }
  | { outcome: "self_link_forbidden" }
  | { outcome: "profile_mismatch" }
  | { outcome: "account_in_use" }
  | { outcome: "step_up_required" };

/**
 * The result of the caller-supplied conditional step-up check (ADR-0141 §4):
 * `satisfied` (enrolled, fresh), `not_enrolled` (no second factor exists, so
 * none is demanded — recorded in the audit row), or `required` (enrolled but
 * stale: refuse).
 */
export type StepUpState = "satisfied" | "not_enrolled" | "required";

export type AssignAccountContext = {
  /**
   * Evaluates the CONDITIONAL step-up for the calling session. Injected so the
   * application layer holds no session or Response knowledge, and called only
   * when the change is a re-link of an employment that has history.
   */
  checkStepUp: () => Promise<StepUpState>;
};

type LinkTargetVerdict =
  "user_not_found" | "self_link_forbidden" | "profile_mismatch" | null;

/**
 * The rules a login must satisfy to be (or stay) the employee's: an ACTIVE login
 * (tenant user and identity both) that belongs to the employment's person. Run
 * on the no-op path too, so a link made before PS-14 was fixed is re-checked
 * instead of being echoed back as `200`.
 */
async function checkLinkTarget(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string,
  employmentProfileId: string | undefined,
  actorTenantUserId: string | null
): Promise<LinkTargetVerdict> {
  const user = (await tx`
    SELECT i.profile_id FROM awcms_tenant_users tu
    JOIN awcms_identities i
      ON i.tenant_id = tu.tenant_id AND i.id = tu.identity_id
    WHERE tu.tenant_id = ${tenantId} AND tu.id = ${tenantUserId}
      AND tu.status = 'active' AND tu.principal_kind = 'user'
      AND i.status = 'active'
  `) as { profile_id: string | null }[];

  if (user.length === 0) {
    return "user_not_found";
  }

  if (user[0]!.profile_id === employmentProfileId) {
    return null;
  }

  // Checked before the generic profile rule so the caller learns the specific
  // reason. A self-link to the caller's OWN employment (same profile) passes.
  return tenantUserId === actorTenantUserId
    ? "self_link_forbidden"
    : "profile_mismatch";
}

/**
 * A refused link leaves a trace (PS-14, audit M3): UUIDs and a reason code only.
 * The caller returns the refusal as a normal `Response`, not a throw, so the
 * transaction COMMITS and this row survives — the same property that lets the
 * ABAC decision log keep a deny.
 */
async function recordLinkRefusal(
  tx: Bun.SQL,
  tenantId: string,
  employmentId: string,
  actor: Actor,
  reason: "self_link_forbidden" | "profile_mismatch" | "step_up_required",
  requestedTenantUserId: string | null,
  previousTenantUserId: string | null
): Promise<void> {
  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_WORKFORCE_MODULE_KEY,
    action: "hr_workforce.employment.account_link_refused",
    resourceType: "hr_employment",
    resourceId: employmentId,
    severity: "warning",
    message: "Employment account link refused.",
    attributes: { reason, requestedTenantUserId, previousTenantUserId },
    correlationId: actor.correlationId
  });
}

/**
 * Link (or unlink with `null`) the login that IS this employee. This is the
 * basis of self-service ownership (and, in phase 3, of payslip ownership), so
 * it is a high-risk `assign` — finding PS-14 of the phase-3 security review
 * (`docs/awcms/hr-payroll.md` §17, Issue #979):
 *
 * 1. **No self-link to another person's employment.** Whoever holds `assign`
 *    could otherwise link their OWN login to a colleague's employment and read
 *    that person's own-scoped data. Refused as `self_link_forbidden`.
 * 2. **The login must belong to the employment's person.** The linked tenant
 *    user's identity must carry the employment's `profile_id` (exact match;
 *    fail-closed, so a profile merged away from either side must be re-pointed
 *    before linking). Refused as `profile_mismatch`.
 * 3. **A re-link is not a first link.** Changing or removing an existing link
 *    is audited at `critical` with the before/after login UUIDs (no free
 *    text), and, when the employment already has attendance history (later also
 *    released payslips), requires the CONDITIONAL step-up: a holder with no
 *    second factor is not locked out (ADR-0141 §4), and the audit row records
 *    which case applied. A first link stays `warning`; an employment that has
 *    EVER been linked (`last_tenant_user_id`) counts as re-linked, so
 *    unlink-then-link keeps the critical level.
 * 4. **Refusals and stale links leave a trace / are re-checked.** The three
 *    PS-14 refusals write an `account_link_refused` audit row (reason code and
 *    UUIDs only); a no-op "link the same login" re-validates the login instead
 *    of echoing a pre-fix link back as `200`; and `awcms_hr_employments_link_guard`
 *    (`sql/228`) refuses a mismatched login in the database as well.
 */
export async function assignAccount(
  tx: Bun.SQL,
  tenantId: string,
  employmentId: string,
  actor: Actor,
  tenantUserId: string | null,
  context: AssignAccountContext
): Promise<AssignAccountOutcome> {
  const header = await lockHeader(tx, tenantId, employmentId);

  if (!header) {
    return { outcome: "not_found" };
  }

  if (header.deleted_at) {
    return { outcome: "deleted" };
  }

  const existing = (await tx`
    SELECT tenant_user_id, last_tenant_user_id, profile_id
    FROM awcms_hr_employments
    WHERE tenant_id = ${tenantId} AND id = ${employmentId}
  `) as {
    tenant_user_id: string | null;
    last_tenant_user_id: string | null;
    profile_id: string;
  }[];
  const employmentProfileId = existing[0]?.profile_id;
  const currentTenantUserId = existing[0]?.tenant_user_id ?? null;
  const lastTenantUserId = existing[0]?.last_tenant_user_id ?? null;

  if (currentTenantUserId === tenantUserId) {
    if (tenantUserId !== null) {
      // A link that predates PS-14 may be wrong: re-validate rather than echo it.
      const stale = await checkLinkTarget(
        tx,
        tenantId,
        tenantUserId,
        employmentProfileId,
        actor.actorTenantUserId
      );

      if (stale !== null) {
        if (stale !== "user_not_found") {
          await recordLinkRefusal(
            tx,
            tenantId,
            employmentId,
            actor,
            stale,
            tenantUserId,
            currentTenantUserId
          );
        }

        return { outcome: stale };
      }
    }

    return {
      outcome: "ok",
      replayed: true,
      employment: (await getEmployment(tx, tenantId, employmentId))!
    };
  }

  if (header.terminated_on && tenantUserId !== null) {
    return { outcome: "terminated" };
  }

  if (tenantUserId !== null) {
    const verdict = await checkLinkTarget(
      tx,
      tenantId,
      tenantUserId,
      employmentProfileId,
      actor.actorTenantUserId
    );

    if (verdict !== null) {
      if (verdict !== "user_not_found") {
        await recordLinkRefusal(
          tx,
          tenantId,
          employmentId,
          actor,
          verdict,
          tenantUserId,
          currentTenantUserId ?? lastTenantUserId
        );
      }

      return { outcome: verdict };
    }

    const inUse = (await tx`
      SELECT 1 AS taken FROM awcms_hr_employments
      WHERE tenant_id = ${tenantId} AND tenant_user_id = ${tenantUserId}
        AND id <> ${employmentId}
        AND deleted_at IS NULL AND terminated_on IS NULL
    `) as { taken: number }[];

    if (inUse.length > 0) {
      return { outcome: "account_in_use" };
    }
  }

  // "Ever linked" (audit L4): an unlink-then-link is still a RE-link, so the
  // last login is kept in `last_tenant_user_id` and recorded as the "before".
  const previousTenantUserId = currentTenantUserId ?? lastTenantUserId;
  const relink = previousTenantUserId !== null;
  let hasHistory = false;
  let stepUp: StepUpState | "not_applicable" = "not_applicable";

  if (relink) {
    // Phase 3 (#961) adds "released payslips" to this test. An UNSETTLED
    // commission accrual (anything not paid or voided) is history too (Issue
    // #1019): re-pointing the login of an employment that is still owed money
    // deserves a re-verification of the person doing it. That step-up is
    // friction and an audit signal, NOT the control: segregation of duties on
    // commission is enforced by the sql/237 trigger (snapshot + current link,
    // fail closed), which holds whatever this path does. Existence only; no
    // amount is read.
    const history = (await tx`
      SELECT 1 AS present
      WHERE EXISTS (
        SELECT 1 FROM awcms_hr_attendance_events
        WHERE tenant_id = ${tenantId} AND employment_id = ${employmentId}
      ) OR EXISTS (
        SELECT 1 FROM awcms_hr_commission_accruals
        WHERE tenant_id = ${tenantId} AND employment_id = ${employmentId}
          AND status NOT IN ('paid', 'voided')
      )
    `) as { present: number }[];

    hasHistory = history.length > 0;

    if (hasHistory) {
      stepUp = await context.checkStepUp();

      if (stepUp === "required") {
        await recordLinkRefusal(
          tx,
          tenantId,
          employmentId,
          actor,
          "step_up_required",
          tenantUserId,
          previousTenantUserId
        );

        return { outcome: "step_up_required" };
      }
    }
  }

  await tx`
    UPDATE awcms_hr_employments
    SET tenant_user_id = ${tenantUserId},
        last_tenant_user_id = ${currentTenantUserId ?? lastTenantUserId},
        updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${employmentId}
  `;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_WORKFORCE_MODULE_KEY,
    action: "hr_workforce.employment.account_assigned",
    resourceType: "hr_employment",
    resourceId: employmentId,
    severity: relink ? "critical" : "warning",
    message: relink
      ? tenantUserId === null
        ? "Employment account link removed."
        : "Employment account re-linked."
      : "Employment account link set.",
    // The logins that received (or lost) ownership are UUIDs, not personal
    // data, and are exactly what an auditor needs: WHICH login can now read
    // this employment through the ownership grant. Never free text.
    attributes: {
      linked: tenantUserId !== null,
      relink,
      linkedTenantUserId: tenantUserId,
      previousTenantUserId,
      hadHistory: hasHistory,
      stepUp
    },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    replayed: false,
    employment: (await getEmployment(tx, tenantId, employmentId))!
  };
}

export type DeleteOutcome =
  | { outcome: "ok"; employment: Employment }
  | { outcome: "not_found" }
  | { outcome: "already_deleted" };

export async function softDeleteEmployment(
  tx: Bun.SQL,
  tenantId: string,
  employmentId: string,
  actor: Actor,
  reason: string | null
): Promise<DeleteOutcome> {
  const header = await lockHeader(tx, tenantId, employmentId);

  if (!header) {
    return { outcome: "not_found" };
  }

  if (header.deleted_at) {
    return { outcome: "already_deleted" };
  }

  await tx`
    UPDATE awcms_hr_employments
    SET deleted_at = now(), deleted_by = ${actor.actorTenantUserId},
        delete_reason = ${reason}, restored_at = NULL, restored_by = NULL,
        updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${employmentId}
  `;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_WORKFORCE_MODULE_KEY,
    action: "hr_workforce.employment.deleted",
    resourceType: "hr_employment",
    resourceId: employmentId,
    severity: "warning",
    message: "Employment soft-deleted.",
    attributes: { reasonGiven: reason !== null },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    employment: (await getEmployment(tx, tenantId, employmentId, {
      includeDeleted: true
    }))!
  };
}

export type RestoreOutcome =
  | { outcome: "ok"; employment: Employment }
  | { outcome: "not_found" }
  | { outcome: "not_deleted" }
  | { outcome: "duplicate_employee_no" }
  | { outcome: "already_employed" }
  | { outcome: "account_in_use" };

export async function restoreEmployment(
  tx: Bun.SQL,
  tenantId: string,
  employmentId: string,
  actor: Actor
): Promise<RestoreOutcome> {
  const header = await lockHeader(tx, tenantId, employmentId);

  if (!header) {
    return { outcome: "not_found" };
  }

  if (!header.deleted_at) {
    return { outcome: "not_deleted" };
  }

  // The partial unique indexes ignore deleted rows, so another employment may
  // have taken the number, the profile or the login meanwhile. Say which.
  const clash = (await tx`
    SELECT
      EXISTS (SELECT 1 FROM awcms_hr_employments o
              WHERE o.tenant_id = e.tenant_id AND o.id <> e.id
                AND o.deleted_at IS NULL
                AND lower(o.employee_no) = lower(e.employee_no)) AS number_taken,
      (e.terminated_on IS NULL AND EXISTS (
         SELECT 1 FROM awcms_hr_employments o
         WHERE o.tenant_id = e.tenant_id AND o.id <> e.id
           AND o.deleted_at IS NULL AND o.terminated_on IS NULL
           AND o.profile_id = e.profile_id)) AS profile_taken,
      (e.terminated_on IS NULL AND e.tenant_user_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM awcms_hr_employments o
         WHERE o.tenant_id = e.tenant_id AND o.id <> e.id
           AND o.deleted_at IS NULL AND o.terminated_on IS NULL
           AND o.tenant_user_id = e.tenant_user_id)) AS user_taken
    FROM awcms_hr_employments e
    WHERE e.tenant_id = ${tenantId} AND e.id = ${employmentId}
  `) as {
    number_taken: boolean;
    profile_taken: boolean;
    user_taken: boolean;
  }[];

  if (clash[0]?.number_taken) {
    return { outcome: "duplicate_employee_no" };
  }

  if (clash[0]?.profile_taken) {
    return { outcome: "already_employed" };
  }

  if (clash[0]?.user_taken) {
    return { outcome: "account_in_use" };
  }

  await tx`
    UPDATE awcms_hr_employments
    SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL,
        restored_at = now(), restored_by = ${actor.actorTenantUserId},
        updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${employmentId}
  `;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_WORKFORCE_MODULE_KEY,
    action: "hr_workforce.employment.restored",
    resourceType: "hr_employment",
    resourceId: employmentId,
    severity: "warning",
    message: "Employment restored.",
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    employment: (await getEmployment(tx, tenantId, employmentId))!
  };
}

// --- Settings ------------------------------------------------------------------

export type WorkforceSettings = {
  clockSkewSeconds: number;
  correctionWorkflowKey: string;
};

export async function readSettings(
  tx: Bun.SQL,
  tenantId: string
): Promise<WorkforceSettings> {
  const rows = (await tx`
    SELECT clock_skew_seconds, correction_workflow_key
    FROM awcms_hr_workforce_settings WHERE tenant_id = ${tenantId}
  `) as { clock_skew_seconds: number; correction_workflow_key: string }[];

  return {
    clockSkewSeconds: rows[0]?.clock_skew_seconds ?? DEFAULT_CLOCK_SKEW_SECONDS,
    correctionWorkflowKey:
      rows[0]?.correction_workflow_key ?? DEFAULT_CORRECTION_WORKFLOW_KEY
  };
}

/** Upsert the tenant's settings; an omitted field keeps its current value. */
export async function writeSettings(
  tx: Bun.SQL,
  tenantId: string,
  actor: Actor,
  input: SettingsInput
): Promise<WorkforceSettings> {
  const before = await readSettings(tx, tenantId);
  const next: WorkforceSettings = {
    clockSkewSeconds: input.clockSkewSeconds ?? before.clockSkewSeconds,
    correctionWorkflowKey:
      input.correctionWorkflowKey ?? before.correctionWorkflowKey
  };

  await tx`
    INSERT INTO awcms_hr_workforce_settings
      (tenant_id, clock_skew_seconds, correction_workflow_key, updated_by)
    VALUES (${tenantId}, ${next.clockSkewSeconds},
            ${next.correctionWorkflowKey}, ${actor.actorTenantUserId})
    ON CONFLICT (tenant_id) DO UPDATE
    SET clock_skew_seconds = EXCLUDED.clock_skew_seconds,
        correction_workflow_key = EXCLUDED.correction_workflow_key,
        updated_at = now(), updated_by = EXCLUDED.updated_by
  `;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_WORKFORCE_MODULE_KEY,
    action: "hr_workforce.settings.configured",
    resourceType: "hr_workforce_settings",
    resourceId: tenantId,
    severity: "warning",
    message: "Workforce settings changed.",
    attributes: {
      clockSkewChanged: next.clockSkewSeconds !== before.clockSkewSeconds,
      workflowKeyChanged:
        next.correctionWorkflowKey !== before.correctionWorkflowKey
    },
    correlationId: actor.correlationId
  });

  return next;
}
