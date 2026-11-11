/**
 * The `CrmLeadPort` adapter (Issue #1166, ADR-0153 section 6). A thin seam over
 * the same functions the HTTP routes call, so a conversion confirmed through
 * the port and one confirmed over HTTP are the same write. See the port file
 * for the authorization contract (the composition root authorizes and audits).
 */
import type {
  CrmLeadConversionOutcome,
  CrmLeadPort,
  CrmLeadReversalOutcome,
  CrmLeadState
} from "../../_shared/ports/crm-lead-port";
import {
  validateConversion,
  validateReverseConversion,
  isUuid
} from "../domain/crm-leads-validation";
import { readLead } from "./lead-directory";
import { recordConversion, reverseConversion } from "./lead-lifecycle";

export function createCrmLeadPortAdapter(): CrmLeadPort {
  return {
    async readLeadState(tx, tenantId, leadId): Promise<CrmLeadState | null> {
      if (!isUuid(leadId)) return null;

      const lead = await readLead(tx, tenantId, leadId.toLowerCase());

      if (!lead || lead.deletedAt) return null;

      const first = (await tx`
        SELECT id, source_kind FROM awcms_crm_lead_source_touches
        WHERE tenant_id = ${tenantId} AND lead_id = ${lead.id}
          AND touch_number = 1
      `) as { id: string; source_kind: string }[];

      return {
        leadId: lead.id,
        pipelineId: lead.pipelineId,
        stageKey: lead.stageKey,
        stageCategory: lead.stageCategory,
        status: lead.status,
        mergedIntoLeadId: lead.mergedIntoLeadId,
        ownerTenantUserId: lead.ownerTenantUserId,
        firstSourceKind: first[0]?.source_kind ?? null,
        firstTouchId: first[0]?.id ?? null,
        externalCustomerRef: lead.externalCustomerRef,
        version: lead.version
      };
    },

    async confirmConversion(
      tx,
      tenantId,
      actor,
      request,
      correlationId = null
    ): Promise<CrmLeadConversionOutcome> {
      const validated = validateConversion({
        mode: "authority_confirmed",
        expectedVersion: request.expectedVersion,
        externalCustomerRef: request.externalCustomerRef,
        evidenceRef: request.evidenceRef,
        ...(request.toStageKey ? { toStageKey: request.toStageKey } : {}),
        occurredAt: request.occurredAt.toISOString()
      });

      if (!validated.valid || !isUuid(request.leadId)) {
        return { outcome: "input_invalid" };
      }

      const result = await recordConversion(
        tx,
        tenantId,
        actor,
        request.leadId.toLowerCase(),
        validated.value,
        { correlationId, actorTenantUserId: actor, idempotencyKey: null }
      );

      return result.outcome === "converted" || result.outcome === "replayed"
        ? { outcome: result.outcome, conversionId: result.conversionId }
        : { outcome: result.outcome };
    },

    async reverseConversion(
      tx,
      tenantId,
      actor,
      request,
      correlationId = null
    ): Promise<CrmLeadReversalOutcome> {
      const validated = validateReverseConversion({
        evidenceRef: request.evidenceRef,
        occurredAt: request.occurredAt.toISOString()
      });

      if (!validated.valid || !isUuid(request.conversionId)) {
        return { outcome: "input_invalid" };
      }

      const result = await reverseConversion(
        tx,
        tenantId,
        actor,
        request.conversionId.toLowerCase(),
        validated.value,
        { correlationId, actorTenantUserId: actor, idempotencyKey: null }
      );

      return result.outcome === "reversed" || result.outcome === "replayed"
        ? { outcome: result.outcome, conversionId: result.conversionId }
        : { outcome: result.outcome };
    }
  };
}
