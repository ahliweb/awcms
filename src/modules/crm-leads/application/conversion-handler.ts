/**
 * The shared body of the two conversion routes (Issue #1166, ADR-0153 section
 * 6). They differ only in WHO may call them and which `mode` they accept:
 *
 *   POST /leads/{id}/conversions         `conversions.approve`, mode
 *                                        `authority_confirmed` (the customer
 *                                        authority's adapter, with its opaque
 *                                        customer reference)
 *   POST /leads/{id}/manual-conversions  `manual_conversions.create`, mode
 *                                        `authority_unconfirmed` (staff, with a
 *                                        note and an evidence reference;
 *                                        reported separately, O13)
 */
import { fail } from "../../_shared/api-response";
import type { ConversionMode } from "../domain/crm-leads-constants";
import type { ConversionInput } from "../domain/crm-leads-validation";
import { recordConversion } from "./lead-lifecycle";
import {
  auditCrmLeads,
  emitContext,
  leadWriteRefusalResponse,
  runIdempotent
} from "./route-support";

type ConversionRouteContext = {
  tx: Bun.SQL;
  tenantId: string;
  auth: { context: { viaMachineCredential?: boolean; tenantUserId: string } };
  locals: { correlationId?: string };
  prepared: { idempotencyKey: string; input: ConversionInput };
};

export async function handleConversion(
  context: ConversionRouteContext,
  leadId: string,
  mode: ConversionMode
): Promise<Response> {
  const { tx, tenantId, auth, prepared } = context;
  const actor = auth.context.tenantUserId;

  if (prepared.input.mode !== mode) {
    return fail(
      422,
      "CONVERSION_MODE_MISMATCH",
      mode === "authority_confirmed"
        ? "This endpoint records authority-confirmed conversions only; a manual conversion uses /manual-conversions."
        : "This endpoint records manual (authority_unconfirmed) conversions only."
    );
  }

  return runIdempotent(
    tx,
    tenantId,
    `crm_leads_conversion_${mode}`,
    prepared.idempotencyKey,
    actor,
    { leadId, ...prepared.input },
    async () => {
      const result = await recordConversion(
        tx,
        tenantId,
        actor,
        leadId,
        prepared.input,
        emitContext(context, prepared.idempotencyKey)
      );

      switch (result.outcome) {
        case "replayed":
          return {
            status: 200,
            body: {
              ...result.lead,
              conversionId: result.conversionId,
              replayed: true
            }
          };
        case "evidence_reused":
          return fail(
            409,
            "EVIDENCE_REUSED",
            "This evidence reference already records a different conversion."
          );
        case "already_converted":
          return fail(
            409,
            "ALREADY_CONVERTED",
            "The lead is already converted."
          );
        case "no_converted_stage":
          return fail(
            409,
            "NO_CONVERTED_STAGE",
            "The pipeline's current revision has no converted stage."
          );
        case "stage_not_found":
          return fail(
            422,
            "STAGE_NOT_FOUND",
            "The target is not a converted stage of the current revision."
          );
        case "transition_not_allowed":
          return fail(
            409,
            "TRANSITION_NOT_ALLOWED",
            "The pipeline does not allow converting from the lead's stage."
          );
        case "guard_not_met":
          return fail(
            409,
            "GUARD_NOT_MET",
            "The conversion edge's guard is not satisfied.",
            {},
            { guards: result.guards }
          );
        case "converted":
          break;
        default:
          return leadWriteRefusalResponse(result)!;
      }

      await auditCrmLeads(context, {
        action:
          mode === "authority_confirmed"
            ? "crm_leads.lead.convert"
            : "crm_leads.lead.convert_manual",
        resourceType: "crm_leads_conversion",
        resourceId: result.conversionId,
        severity: "warning",
        message:
          mode === "authority_confirmed"
            ? "Lead conversion confirmed by the customer authority."
            : "Lead converted manually without a confirming authority.",
        attributes: {
          leadId,
          mode,
          evidenceRef: prepared.input.evidenceRef,
          toStageKey: result.lead.stageKey
        }
      });

      return {
        status: 201,
        body: {
          ...result.lead,
          conversionId: result.conversionId,
          replayed: false
        }
      };
    }
  );
}
