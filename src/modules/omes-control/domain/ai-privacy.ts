/**
 * AI privacy posture / AI egress owner-approval domain logic (Issue
 * ahliweb/omes#232, OMES issue #217, ADR-0029).
 *
 * Mirrors OMES's `lib/omes/py/privacy/posture_projection.py` on the AWCMS
 * side: `classifyFreshness`/`projectPostureView` are AWCMS's own SECOND,
 * INDEPENDENT recomputation of freshness/status from the stored evidence
 * at read time — this module never simply trusts the `evidence_freshness`/
 * `status` fields a producer sent at ingest time, the same "recompute, do
 * not merely echo" discipline `classify_freshness`/`project_posture_view`
 * document on the OMES side. `authorizeAiEgressApproval` is AWCMS's own
 * mirror of `authorize_approval()` — a pure, unconditional gate that never
 * lets a RESTRICTED classification resolve to a cloud_sanitized
 * destination, run in the application layer BEFORE ever touching the
 * `workflow-approval` engine (the sole approval authority; see
 * `application/ai-egress-approval.ts`).
 *
 * Both are pure functions of their inputs — no I/O, no database access —
 * so they can be exercised directly by unit tests without a database.
 */

export const AI_PRIVACY_AUTHORITIES = ["hermes", "omes-host", "awcms"] as const;
export type AiPrivacyAuthority = (typeof AI_PRIVACY_AUTHORITIES)[number];

export const AI_PRIVACY_CLASSIFICATION_MODES = [
  "fail_closed_v1",
  "unknown"
] as const;
export type AiPrivacyClassificationMode =
  (typeof AI_PRIVACY_CLASSIFICATION_MODES)[number];

export const AI_PRIVACY_DESTINATION_CLASSES = [
  "local",
  "private",
  "cloud",
  "unknown"
] as const;
export type AiPrivacyDestinationClass =
  (typeof AI_PRIVACY_DESTINATION_CLASSES)[number];

export const AI_PRIVACY_STATUSES = ["PASS", "FAIL", "WARN", "BLOCKED"] as const;
export type AiPrivacyStatus = (typeof AI_PRIVACY_STATUSES)[number];

export const AI_PRIVACY_FRESHNESS = ["fresh", "stale", "unknown"] as const;
export type AiPrivacyFreshness = (typeof AI_PRIVACY_FRESHNESS)[number];

/**
 * Default freshness window, mirrored from OMES
 * `lib/omes/py/privacy/posture_evidence.py`'s
 * `DEFAULT_MAX_EVIDENCE_AGE_SECONDS` (24 hours). AWCMS recomputes freshness
 * against this window on every read rather than trusting a stored flag, so
 * evidence that goes stale between ingestion and display is still reported
 * correctly without requiring a background job to "flip" anything.
 */
export const DEFAULT_MAX_EVIDENCE_AGE_SECONDS = 24 * 60 * 60;

function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Bounded fresh/stale/unknown classification. A missing/unparsable
 * timestamp on either side, or a timestamp in the future (clock/producer
 * problem), is always `"unknown"` — NEVER `"fresh"`. Stale or unknown
 * evidence must never be treated as healthy by any caller of this
 * function.
 */
export function classifyFreshness(
  timestamp: string | null | undefined,
  now: Date,
  maxAgeSeconds: number = DEFAULT_MAX_EVIDENCE_AGE_SECONDS
): AiPrivacyFreshness {
  const ts = parseTimestamp(timestamp);
  if (!ts) {
    return "unknown";
  }
  const ageSeconds = (now.getTime() - ts.getTime()) / 1000;
  if (ageSeconds < 0) {
    return "unknown";
  }
  return ageSeconds > maxAgeSeconds ? "stale" : "fresh";
}

export type StoredAiPrivacyPosture = {
  authority: string;
  classificationMode: string;
  destinationClass: string;
  localEndpointClassification: string | null;
  status: string;
  reasonCodes: string[];
  lastVerifiedAt: string | null;
  projectedAt: string;
};

export type ProjectedAiPrivacyPosture = StoredAiPrivacyPosture & {
  /** Recomputed at READ time from lastVerifiedAt vs. `now` — never merely echoed from storage. */
  evidenceFreshness: AiPrivacyFreshness;
  /**
   * The EFFECTIVE, displayed status: the stored status, EXCEPT that stale
   * or unknown evidence is always downgraded to `"BLOCKED"` (never
   * rendered as `PASS`/healthy) and an unrecognized stored status/
   * destination/classification value is likewise treated as `"BLOCKED"`.
   * This is the field the health rollup and the admin screen must use —
   * never `status` alone, which reflects only what was true when the
   * evidence was produced.
   */
  effectiveStatus: AiPrivacyStatus;
  /** True when `effectiveStatus !== "PASS"` — convenience for rollups/tests. */
  isHealthy: boolean;
};

/**
 * Recomputes freshness/effective-status for one stored posture row against
 * `now`. This is the ONE place that decides whether a posture row renders
 * as healthy — never a page template reading the stored `status` column
 * directly.
 */
export function projectAiPrivacyPosture(
  stored: StoredAiPrivacyPosture,
  now: Date
): ProjectedAiPrivacyPosture {
  const evidenceFreshness = classifyFreshness(stored.lastVerifiedAt, now);

  const recognizedStatus = (AI_PRIVACY_STATUSES as readonly string[]).includes(
    stored.status
  )
    ? (stored.status as AiPrivacyStatus)
    : "BLOCKED";

  const recognizedDestination = (
    AI_PRIVACY_DESTINATION_CLASSES as readonly string[]
  ).includes(stored.destinationClass);
  const recognizedClassificationMode = (
    AI_PRIVACY_CLASSIFICATION_MODES as readonly string[]
  ).includes(stored.classificationMode);

  const effectiveStatus: AiPrivacyStatus =
    evidenceFreshness !== "fresh" ||
    !recognizedDestination ||
    !recognizedClassificationMode ||
    stored.reasonCodes.length === 0
      ? recognizedStatus === "PASS"
        ? "BLOCKED"
        : recognizedStatus
      : recognizedStatus;

  return {
    ...stored,
    evidenceFreshness,
    effectiveStatus,
    isHealthy: effectiveStatus === "PASS"
  };
}

// ---------------------------------------------------------------------------
// Owner-approval authorization (mirrors OMES posture_projection.py's
// authorize_approval()).
// ---------------------------------------------------------------------------

export const AI_EGRESS_APPROVABLE_CLASSIFICATIONS = [
  "CONFIDENTIAL",
  "RESTRICTED"
] as const;
export type AiEgressApprovableClassification =
  (typeof AI_EGRESS_APPROVABLE_CLASSIFICATIONS)[number];

export const AI_EGRESS_APPROVABLE_DESTINATIONS = [
  "private_endpoint",
  "cloud_sanitized"
] as const;
export type AiEgressApprovableDestination =
  (typeof AI_EGRESS_APPROVABLE_DESTINATIONS)[number];

/**
 * The only three egress_policy.py reason codes that ever mean
 * "approval_required" — byte-for-byte mirror of OMES
 * `posture_projection.py`'s `APPROVABLE_REASON_CODES` and
 * `ai-egress-approval.request.schema.json`'s `decision_ref.reason_code`
 * enum. Keep in lockstep with both.
 */
export const AI_EGRESS_APPROVABLE_REASON_CODES = [
  "AI_EGRESS_APPROVAL_REQUIRED_CONFIDENTIAL_PRIVATE_ENDPOINT",
  "AI_EGRESS_APPROVAL_REQUIRED_CONFIDENTIAL_CLOUD_SANITIZED",
  "AI_EGRESS_APPROVAL_REQUIRED_RESTRICTED_PRIVATE_ENDPOINT"
] as const;
export type AiEgressApprovableReasonCode =
  (typeof AI_EGRESS_APPROVABLE_REASON_CODES)[number];

const APPROVABLE_REASON_CODE_SET: ReadonlySet<string> = new Set(
  AI_EGRESS_APPROVABLE_REASON_CODES
);

export const AI_EGRESS_APPROVAL_DENIED_CROSS_TENANT =
  "AI_EGRESS_APPROVAL_DENIED_CROSS_TENANT";
export const AI_EGRESS_APPROVAL_DENIED_NOT_APPROVABLE =
  "AI_EGRESS_APPROVAL_DENIED_NOT_APPROVABLE";
export const AI_EGRESS_APPROVAL_DENIED_RESTRICTED_CLOUD_NEVER_APPROVABLE =
  "AI_EGRESS_APPROVAL_DENIED_RESTRICTED_CLOUD_NEVER_APPROVABLE";
export const AI_EGRESS_APPROVAL_DENIED_BY_ACTOR =
  "AI_EGRESS_APPROVAL_DENIED_BY_ACTOR";

export type AiEgressDecisionRef = {
  classification: string;
  destination: string;
  reasonCode: string;
};

export type AiEgressApprovalAuthorization =
  | { allow: true; reason: string; reasonCode: AiEgressApprovableReasonCode }
  | { allow: false; reason: string; reasonCode: string };

/**
 * Pure allow/deny gate for an owner-approval decision. This is a SECOND,
 * independent backstop behind AWCMS's own RBAC/ABAC authorization (the
 * `omes_control.ai_privacy.approve` permission check that must already
 * have passed before this is ever called) — it never grants an approval
 * path OMES's `egress_policy.py` did not already mark `approval_required`,
 * and it UNCONDITIONALLY refuses to let a RESTRICTED classification ever
 * resolve to a cloud_sanitized destination, regardless of what a caller
 * submits or what `decisionRef.reasonCode` claims.
 *
 * Checked BY VALUE (classification === "RESTRICTED" && destination ===
 * "cloud_sanitized"), independent of the reason_code check below it — so
 * this stays fail-closed even against a payload that is internally
 * inconsistent in a way schema validation alone would not catch.
 */
export function authorizeAiEgressApproval(params: {
  requesterTenantId: string | null;
  tenantId: string;
  decisionRef: AiEgressDecisionRef;
  approve: boolean;
}): AiEgressApprovalAuthorization {
  const { requesterTenantId, tenantId, decisionRef, approve } = params;

  if (requesterTenantId !== null && requesterTenantId !== tenantId) {
    return {
      allow: false,
      reason:
        "cross_tenant_denied: requester tenant does not match decision tenant",
      reasonCode: AI_EGRESS_APPROVAL_DENIED_CROSS_TENANT
    };
  }

  if (
    decisionRef.classification === "RESTRICTED" &&
    decisionRef.destination === "cloud_sanitized"
  ) {
    return {
      allow: false,
      reason:
        "restricted_cloud_denied: RESTRICTED classification may never egress to cloud_sanitized; no approval path exists",
      reasonCode: AI_EGRESS_APPROVAL_DENIED_RESTRICTED_CLOUD_NEVER_APPROVABLE
    };
  }

  if (!APPROVABLE_REASON_CODE_SET.has(decisionRef.reasonCode)) {
    return {
      allow: false,
      reason: `not_approvable: reason_code "${decisionRef.reasonCode}" is not one of the approval_required decisions`,
      reasonCode: AI_EGRESS_APPROVAL_DENIED_NOT_APPROVABLE
    };
  }

  if (!approve) {
    return {
      allow: false,
      reason: "denied_by_actor: the approving actor declined this request",
      reasonCode: AI_EGRESS_APPROVAL_DENIED_BY_ACTOR
    };
  }

  return {
    allow: true,
    reason: `approved: reason_code=${decisionRef.reasonCode}`,
    reasonCode: decisionRef.reasonCode as AiEgressApprovableReasonCode
  };
}

/**
 * Field names shaped like raw prompt/transcript/credential content — the
 * runtime complement to the vendored schema's structural
 * `additionalProperties: false` (belt-and-suspenders: a payload that
 * somehow reaches ingestion with one of these keys, e.g. via a future
 * schema relaxation, is still refused here). Mirrors OMES's own
 * `test_posture_projection.py::TestSchemasHaveNoPromptTranscriptCredentialFields`
 * denylist.
 */
const DISALLOWED_EVIDENCE_KEY_SUBSTRINGS = [
  "prompt",
  "transcript",
  "response_text",
  "chain_of_thought",
  "raw_provider_response",
  "credential",
  "secret",
  "password",
  "token"
];

function collectKeysDeep(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeysDeep(item, keys);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>
    )) {
      keys.add(key.toLowerCase());
      collectKeysDeep(nested, keys);
    }
  }
}

/** Every disallowed-shaped key name found anywhere in `payload` (empty = clean). */
export function findDisallowedEvidenceKeys(payload: unknown): string[] {
  const keys = new Set<string>();
  collectKeysDeep(payload, keys);
  return [...keys].filter((key) =>
    DISALLOWED_EVIDENCE_KEY_SUBSTRINGS.some((needle) => key.includes(needle))
  );
}
