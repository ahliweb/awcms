/**
 * Mission Control contextual actions — pure availability evaluation (Issue
 * ahliweb/omes#267, epic ahliweb/omes#263, ADR-0031).
 *
 * ## Same semantics as the canonical path; the existing endpoints are the authority
 *
 * Mission Control adds NO executor, scheduler, approval authority, operation
 * name, permission or migration. Every action here is a SHORTCUT to an
 * already-existing endpoint; this module answers "does the existing endpoint
 * enforce anything that makes this action unavailable right now?". It
 * invents no narrowing of its own: `available` is EXACTLY what the endpoints
 * enforce (plus the not-found, historical-mode and permission checks). Each
 * mutation endpoint still re-authorizes, rate-limits, applies the destructive
 * workflow gate, audits and enforces idempotency on its own.
 *
 * The set of actions per kind is read from the vendored, SHA-256-pinned
 * `mission-control-source-map.json` (`kinds[*].candidate_actions`, `actions`)
 * — never copied here — so an action outside the map can never be evaluated.
 *
 * ## Existing endpoint rules mirrored (file references are in the AWCMS tree)
 *
 *  - job.cancel: available only while the job is `queued`
 *    (`application/job-directory.ts` cancelQueuedJob, `state !== "queued"` ->
 *    409 JOB_NOT_CANCELLABLE; `pages/api/v1/omes/jobs/[id]/cancel.ts`).
 *  - job.requeue: available only while the job is `failed`
 *    (`application/job-directory.ts` retryFailedJob, `state !== "failed"` ->
 *    409 JOB_NOT_RETRYABLE; `pages/api/v1/omes/jobs/[id]/approve.ts`).
 *  - operation.*: `POST /api/v1/omes/operations`
 *    (`pages/api/v1/omes/operations/index.ts`); destructive subset is
 *    `domain/operations.ts` DESTRUCTIVE_OMES_OPERATIONS (stop, rollback),
 *    which `application/operation-submission.ts` routes through the
 *    OMES_DESTRUCTIVE_WORKFLOW_KEY workflow. That endpoint does NOT check
 *    that the target server exists, is not `decommissioned`, or is fresh, so
 *    neither does availability here.
 *  - backup.restore: `application/backup-restore.ts` submitBackupRestore only
 *    requires the backup to exist (404 otherwise) and the destructive
 *    workflow to be configured; it accepts any backup status.
 *  - requiresApproval: stop, rollback (DESTRUCTIVE_OMES_OPERATIONS) and
 *    backup.restore (always destructive, `application/backup-restore.ts`).
 *
 * ## Advisories (non-blocking, never change `available`)
 *
 * `advisories` carries warnings the preflight summary shows the operator:
 * `target_stale` (target freshness is not live, for the lifecycle operations
 * start/stop/restart/update/backup/rollback), `target_decommissioned`
 * (operation.* on a decommissioned server) and `backup_not_verified`
 * (backup.restore on a snapshot that is not `completed`/`verified`). They are
 * advisory ONLY because the endpoints above do not enforce them
 * (`pages/api/v1/omes/operations/index.ts`, `application/operation-submission.ts`,
 * `application/backup-restore.ts`); making any of them blocking would be a
 * separate change to those canonical endpoints, after which Mission Control
 * would follow automatically.
 *
 * No I/O: the caller (application layer) loads the ONE tenant-scoped target
 * record, evaluates `can()` per action permission and passes the results in.
 */
import { loadVendoredJsonFileSync } from "./contracts/loader";
import {
  isDestructiveOmesOperation,
  isSupportedOmesOperation,
  OMES_DESTRUCTIVE_WORKFLOW_KEY,
  OMES_OPERATION_GUARD
} from "./operations";
import { OMES_GUARDS } from "./permissions";
import { loadMissionControlSourceMap } from "./mission-control";
import {
  MISSION_CONTROL_KINDS,
  type MissionControlFreshness,
  type MissionControlKind
} from "./mission-control-types";
import type { AccessRequest } from "../../identity-access/domain/access-control";

export const MISSION_CONTROL_ACTION_REASONS = [
  "available",
  "permission_denied",
  "state_not_eligible",
  "not_found",
  "historical_mode"
] as const;
export type MissionControlActionReason =
  (typeof MISSION_CONTROL_ACTION_REASONS)[number];

export const MISSION_CONTROL_ACTION_ADVISORIES = [
  "target_stale",
  "target_decommissioned",
  "backup_not_verified"
] as const;
export type MissionControlActionAdvisory =
  (typeof MISSION_CONTROL_ACTION_ADVISORIES)[number];

export type MissionControlActionEvaluation = {
  action: string;
  available: boolean;
  reason: MissionControlActionReason;
  requiresApproval: boolean;
  method: "GET" | "POST";
  /** Concrete existing path (detail route, mutation endpoint or inbox link). */
  path: string;
  mutating: boolean;
  /** Non-blocking warnings for the preflight summary; never change `available`. */
  advisories: MissionControlActionAdvisory[];
};

export type MissionControlActionMode = "live" | "historical";

/** Minimal target facts; ids are the opaque source ids already in the scene. */
export type MissionControlActionRecord = {
  /** Source state (job `state`, backup `status`, server `status`, ...). */
  state: string | null;
  freshness: MissionControlFreshness;
  /** Status of the target server when known (deployments); server kind uses `state`. */
  serverStatus?: string | null;
  serverId?: string | null;
  deploymentId?: string | null;
  workflowInstanceId?: string | null;
  /**
   * The id the EXISTING endpoint takes in its path, when it differs from the
   * scene's `source_id`: `POST /jobs/{id}/cancel|approve` and
   * `POST /backups/{id}/restore` address the row's primary key (what the
   * canonical screens send as `job.id` / `backup.id`), while the scene's
   * `source_id` is the owning authority's business id (`job_id` /
   * `backup_id`). Absent = the path uses `sourceId`.
   */
  pathId?: string | null;
};

export type MissionControlActionsInput = {
  kind: MissionControlKind;
  /** The node's `source_id` (also the path id for job/backup/inbox actions). */
  sourceId: string;
  /** `null` = the record does not exist (or is another tenant's): all `not_found`. */
  record: MissionControlActionRecord | null;
  /** `can()` result per action name; a missing key is treated as denied. */
  permissions: Record<string, boolean>;
  mode: MissionControlActionMode;
};

// ---------------------------------------------------------------------------
// Query validation (GET .../actions?kind=&id=)
// ---------------------------------------------------------------------------

/** `^[A-Za-z0-9_.:-]{1,128}$` — the id shape every OMES endpoint accepts. */
export const MISSION_CONTROL_ACTION_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

export type MissionControlActionsQuery = {
  kind: MissionControlKind;
  sourceId: string;
};

/**
 * Strict query validation: exactly `kind` and `id`, each once. Anything else
 * (`command`, `shell`, `target`, `url`, ...) is rejected, never ignored — there
 * is no free-form field anywhere in this feature.
 */
export function parseActionsQuery(
  params: URLSearchParams
):
  | { ok: true; value: MissionControlActionsQuery }
  | { ok: false; message: string } {
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (key !== "kind" && key !== "id") {
      return { ok: false, message: `Unknown query parameter '${key}'.` };
    }
    if (seen.has(key)) {
      return {
        ok: false,
        message: `Query parameter '${key}' may appear only once.`
      };
    }
    seen.add(key);
  }
  const kind = params.get("kind");
  if (
    kind === null ||
    !(MISSION_CONTROL_KINDS as readonly string[]).includes(kind)
  ) {
    return { ok: false, message: "kind must be a known Mission Control kind." };
  }
  const id = params.get("id");
  if (id === null || !MISSION_CONTROL_ACTION_ID_PATTERN.test(id)) {
    return {
      ok: false,
      message: "id is required and must match ^[A-Za-z0-9_.:-]{1,128}$."
    };
  }
  return {
    ok: true,
    value: { kind: kind as MissionControlKind, sourceId: id }
  };
}

// ---------------------------------------------------------------------------
// Vendored source map (candidate actions + actions table)
// ---------------------------------------------------------------------------

type ActionTableEntry = { mutating: boolean };

type RawKind = {
  candidate_actions: string[];
  detail_route: string;
  source: string;
};

export class MissionControlActionMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissionControlActionMapError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rawKind(kind: MissionControlKind): RawKind {
  // `loadMissionControlSourceMap` validates the version/shape and caches the
  // parsed vendored JSON; its typed view omits `candidate_actions`, which is
  // present on the same object, so it is re-read defensively here.
  const entry = (
    loadMissionControlSourceMap().kinds as unknown as Record<string, unknown>
  )[kind];
  if (
    !isRecord(entry) ||
    !Array.isArray(entry.candidate_actions) ||
    !entry.candidate_actions.every((a) => typeof a === "string") ||
    typeof entry.detail_route !== "string" ||
    typeof entry.source !== "string"
  ) {
    throw new MissionControlActionMapError(
      `kind '${kind}' has no candidate_actions`
    );
  }
  return entry as unknown as RawKind;
}

function actionsTable(): Record<string, ActionTableEntry> {
  const raw = loadVendoredJsonFileSync("mission-control-source-map.json");
  if (!isRecord(raw) || !isRecord(raw.actions)) {
    throw new MissionControlActionMapError("source map has no actions table");
  }
  return raw.actions as Record<string, ActionTableEntry>;
}

/** The kind's candidate action names, exactly as the vendored map lists them. */
export function candidateActionsForKind(kind: MissionControlKind): string[] {
  return [...rawKind(kind).candidate_actions];
}

/** Every action name in the vendored `actions` table. */
export function allMissionControlActionNames(): string[] {
  return Object.keys(actionsTable());
}

// ---------------------------------------------------------------------------
// Permission guard mapping
// ---------------------------------------------------------------------------

/**
 * The EXISTING guard for an action (never a new permission):
 * operation.<op> -> OMES_OPERATION_GUARD[op]; job.cancel / job.requeue ->
 * OMES_GUARDS.jobs.cancel / .approve (the cancel / approve routes'
 * `authorize`); backup.restore -> OMES_GUARDS.backups.restore;
 * approval.open_in_inbox -> `workflow.approval.read` (GET
 * /api/v1/workflows/tasks); open_details -> the kind's source `read_permission`
 * from the vendored map (requires `kind`). Unknown action -> throws.
 */
export function actionPermissionGuard(
  action: string,
  kind?: MissionControlKind
): AccessRequest {
  if (action === "open_details") {
    if (!kind) {
      throw new MissionControlActionMapError(
        "open_details needs a kind to resolve its read guard"
      );
    }
    const map = loadMissionControlSourceMap();
    const source = (map.sources as unknown as Record<string, unknown>)[
      rawKind(kind).source
    ];
    const permission = isRecord(source) ? source.read_permission : undefined;
    const parts = typeof permission === "string" ? permission.split(".") : [];
    if (parts.length !== 3 || parts[2] !== "read") {
      throw new MissionControlActionMapError(
        `kind '${kind}' has no usable read_permission`
      );
    }
    return { moduleKey: parts[0]!, activityCode: parts[1]!, action: "read" };
  }
  if (action.startsWith("operation.")) {
    const operation = action.slice("operation.".length);
    if (isSupportedOmesOperation(operation)) {
      return { ...OMES_OPERATION_GUARD[operation] };
    }
  }
  switch (action) {
    case "job.cancel":
      return { ...OMES_GUARDS.jobs.cancel };
    case "job.requeue":
      return { ...OMES_GUARDS.jobs.approve };
    case "backup.restore":
      return { ...OMES_GUARDS.backups.restore };
    case "approval.open_in_inbox":
      return {
        moduleKey: "workflow",
        activityCode: "approval",
        action: "read"
      };
    default:
      throw new MissionControlActionMapError(`unknown action '${action}'`);
  }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const OPERATIONS_PATH = "/api/v1/omes/operations";
/** Lifecycle operations that warn on a non-live target (status/preflight never do). */
const LIVE_TARGET_OPERATIONS: ReadonlySet<string> = new Set([
  "start",
  "stop",
  "restart",
  "update",
  "backup",
  "rollback"
]);
const RESTORABLE_BACKUP_STATES: ReadonlySet<string> = new Set([
  "completed",
  "verified"
]);

function requiresApproval(action: string): boolean {
  if (action === "backup.restore") return true;
  if (action.startsWith("operation.")) {
    const operation = action.slice("operation.".length);
    return (
      isSupportedOmesOperation(operation) &&
      isDestructiveOmesOperation(operation)
    );
  }
  return false;
}

function concretePath(
  action: string,
  kind: MissionControlKind,
  sourceId: string,
  pathId?: string | null
): { method: "GET" | "POST"; path: string } {
  const id = encodeURIComponent(sourceId);
  const rowId = encodeURIComponent(pathId ?? sourceId);
  switch (action) {
    case "open_details":
      return { method: "GET", path: rawKind(kind).detail_route };
    case "job.cancel":
      return { method: "POST", path: `/api/v1/omes/jobs/${rowId}/cancel` };
    case "job.requeue":
      return { method: "POST", path: `/api/v1/omes/jobs/${rowId}/approve` };
    case "backup.restore":
      return { method: "POST", path: `/api/v1/omes/backups/${rowId}/restore` };
    case "approval.open_in_inbox":
      return {
        method: "GET",
        path: `/admin/approvals?workflowKey=${encodeURIComponent(
          OMES_DESTRUCTIVE_WORKFLOW_KEY
        )}&instance=${id}`
      };
    default:
      return { method: "POST", path: OPERATIONS_PATH };
  }
}

/** Endpoint-enforced state eligibility, or `available`. Only called for a present record and granted permission. */
function stateReason(
  action: string,
  record: MissionControlActionRecord
): MissionControlActionReason {
  if (action === "job.cancel") {
    return record.state === "queued" ? "available" : "state_not_eligible";
  }
  if (action === "job.requeue") {
    return record.state === "failed" ? "available" : "state_not_eligible";
  }
  return "available";
}

/** Non-blocking warnings from the same facts; the endpoints do not enforce these. */
function advisoriesFor(
  action: string,
  kind: MissionControlKind,
  record: MissionControlActionRecord
): MissionControlActionAdvisory[] {
  const advisories: MissionControlActionAdvisory[] = [];
  if (action === "backup.restore") {
    if (record.state === null || !RESTORABLE_BACKUP_STATES.has(record.state)) {
      advisories.push("backup_not_verified");
    }
    return advisories;
  }
  if (action.startsWith("operation.")) {
    const operation = action.slice("operation.".length);
    if (LIVE_TARGET_OPERATIONS.has(operation) && record.freshness !== "live") {
      advisories.push("target_stale");
    }
    const decommissioned =
      kind === "server"
        ? record.state === "decommissioned"
        : record.serverStatus === "decommissioned";
    if (decommissioned) advisories.push("target_decommissioned");
  }
  return advisories;
}

/**
 * Availability of EXACTLY the kind's candidate actions. Precedence:
 * `not_found` (record null, every action) > `historical_mode` (mutating
 * actions only) > `permission_denied` > endpoint state rules (job cancel /
 * requeue) > `available`. Advisories never affect the outcome.
 */
export function evaluateMissionControlActions(
  input: MissionControlActionsInput
): MissionControlActionEvaluation[] {
  if (!(MISSION_CONTROL_KINDS as readonly string[]).includes(input.kind)) {
    throw new MissionControlActionMapError(`unknown kind '${input.kind}'`);
  }
  const table = actionsTable();

  return candidateActionsForKind(input.kind).map((action) => {
    const entry = table[action];
    if (!entry) {
      throw new MissionControlActionMapError(
        `action '${action}' is not in the actions table`
      );
    }
    const mutating = entry.mutating === true;
    const { method, path } = concretePath(
      action,
      input.kind,
      input.sourceId,
      input.record?.pathId
    );

    let reason: MissionControlActionReason;
    if (input.record === null) {
      reason = "not_found";
    } else if (mutating && input.mode === "historical") {
      reason = "historical_mode";
    } else if (input.permissions[action] !== true) {
      reason = "permission_denied";
    } else {
      reason = stateReason(action, input.record);
    }

    return {
      action,
      available: reason === "available",
      reason,
      requiresApproval: requiresApproval(action),
      method,
      path,
      mutating,
      advisories: input.record
        ? advisoriesFor(action, input.kind, input.record)
        : []
    };
  });
}

// ---------------------------------------------------------------------------
// Mutation outcome mapping
// ---------------------------------------------------------------------------
// Lives in `mission-control-outcome.ts` (no imports) so the browser can use the
// SAME mapping without bundling this module's vendored-map and permission code.

export {
  mapMutationOutcome,
  workflowInstanceIdOf,
  type MissionControlMutationOutcome
} from "./mission-control-outcome";
