/**
 * `POST /api/v1/omes/worker/ai-privacy-posture` ingestion (Issue
 * ahliweb/omes#232, OMES issue #217, ADR-0029).
 *
 * Worker-identity-authenticated (same envelope-guard shape as
 * `worker-heartbeat-ingestion.ts`/`worker-result-ingestion.ts`) delivery of
 * an OMES-produced `ai-privacy-posture-view` projection. The route handler
 * (`src/pages/api/v1/omes/worker/ai-privacy-posture.ts`) validates the raw
 * request body against the vendored `ai-privacy-posture-view` JSON Schema
 * BEFORE this function is ever called — `additionalProperties: false`
 * throughout that schema makes a prompt/transcript/credential-shaped field
 * structurally impossible to pass validation. `findDisallowedEvidenceKeys`
 * is a second, independent runtime check on top of that (defense in depth,
 * matching `domain/ai-privacy.ts`'s header), so THIS function also refuses
 * fail-closed if such a field is present, regardless of schema state.
 *
 * Upserts one row per (tenant, server, deployment) — a new projection for
 * the same target REPLACES the prior one, matching the wire contract's own
 * framing as a current-state read projection, not an append-only history.
 * `latest_decision` (when present) is stored as bounded JSON, itself
 * schema-validated the same way.
 */
import { findDisallowedEvidenceKeys } from "../domain/ai-privacy";

export type AiPrivacyPostureIngestInput = {
  tenantId: string;
  correlationId: string;
  serverId: string;
  deploymentId?: string;
  authority: string;
  evidenceFreshness: string;
  classificationMode: string;
  destinationClass: string;
  localEndpointClassification?: string;
  status: string;
  reasonCodes: string[];
  lastVerifiedAt: string | null;
  projectedAt: string;
  latestDecision: Record<string, unknown> | null;
};

export type IngestAiPrivacyPostureOutcome =
  | { outcome: "ingested"; id: string }
  | { outcome: "rejected_disallowed_field"; fields: string[] };

export async function ingestAiPrivacyPosture(
  tx: Bun.SQL,
  input: AiPrivacyPostureIngestInput
): Promise<IngestAiPrivacyPostureOutcome> {
  const disallowed = findDisallowedEvidenceKeys(input.latestDecision ?? {});

  if (disallowed.length > 0) {
    return { outcome: "rejected_disallowed_field", fields: disallowed };
  }

  const rows = (await tx`
    INSERT INTO awcms_omes_ai_privacy_posture (
      tenant_id, server_id, deployment_id, authority, classification_mode,
      destination_class, local_endpoint_classification, status,
      reason_codes, last_verified_at, projected_at, latest_decision,
      correlation_id, received_at
    ) VALUES (
      ${input.tenantId}, ${input.serverId}, ${input.deploymentId ?? null},
      ${input.authority}, ${input.classificationMode},
      ${input.destinationClass}, ${input.localEndpointClassification ?? null},
      ${input.status}, ${input.reasonCodes}::jsonb, ${input.lastVerifiedAt},
      ${input.projectedAt}, ${input.latestDecision}::jsonb,
      ${input.correlationId}, now()
    )
    ON CONFLICT (tenant_id, server_id, COALESCE(deployment_id, ''))
    DO UPDATE SET
      authority = EXCLUDED.authority,
      classification_mode = EXCLUDED.classification_mode,
      destination_class = EXCLUDED.destination_class,
      local_endpoint_classification = EXCLUDED.local_endpoint_classification,
      status = EXCLUDED.status,
      reason_codes = EXCLUDED.reason_codes,
      last_verified_at = EXCLUDED.last_verified_at,
      projected_at = EXCLUDED.projected_at,
      latest_decision = EXCLUDED.latest_decision,
      correlation_id = EXCLUDED.correlation_id,
      received_at = now(),
      updated_at = now()
    RETURNING id
  `) as { id: string }[];

  return { outcome: "ingested", id: rows[0]!.id };
}
