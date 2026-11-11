import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { publishRevision } from "../../../../../../modules/crm-leads/application/pipeline-directory";
import {
  asUuid,
  auditCrmLeads,
  badId,
  emitContext,
  mutationRefusal,
  notFound,
  prepareMutation,
  runIdempotent,
  versionConflict
} from "../../../../../../modules/crm-leads/application/route-support";
import { CRM_LEADS_GUARDS } from "../../../../../../modules/crm-leads/domain/crm-leads-constants";
import {
  validatePublishRevision,
  type PublishRevisionInput
} from "../../../../../../modules/crm-leads/domain/crm-leads-validation";

/**
 * `POST /api/v1/crm-leads/pipelines/{id}/revisions` (Issue #1166, ADR-0153
 * section 3) — publish a NEW immutable revision of the stage catalog. Needs the
 * pipeline's `expectedVersion` (`409 VERSION_CONFLICT`). A revision that would
 * remove a stage some lead is in is refused (`409 STAGES_IN_USE`, naming the
 * stage keys, never a lead) unless `stageMigrations` maps every such stage to a
 * stage of the new revision; those leads then move with a `stage_migrated`
 * transition row each. An identical definition is `409 REVISION_UNCHANGED`.
 * High-risk (`configure`): `Idempotency-Key`, audited at `warning`.
 */
export const POST = defineTenantRoute<{
  idempotencyKey: string;
  input: PublishRevisionInput;
}>({
  workClass: "interactive",
  prepare: ({ request }) => prepareMutation(request, validatePublishRevision),
  authorize: CRM_LEADS_GUARDS.configurePipelines,
  handler: async (context) => {
    const refused = mutationRefusal(context.auth);

    if (refused) return refused;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      "crm_leads_pipeline_publish_revision",
      prepared.idempotencyKey,
      actor,
      { id, ...prepared.input },
      async () => {
        const result = await publishRevision(
          tx,
          tenantId,
          actor,
          id,
          prepared.input,
          emitContext(context, prepared.idempotencyKey)
        );

        switch (result.outcome) {
          case "not_found":
            return notFound("Pipeline");
          case "version_conflict":
            return versionConflict(result.currentVersion);
          case "unchanged":
            return fail(
              409,
              "REVISION_UNCHANGED",
              "The definition is identical to the current revision."
            );
          case "stages_in_use":
            return fail(
              409,
              "STAGES_IN_USE",
              "Leads are in stages this revision removes; map each to a stage of the new revision in stageMigrations.",
              {},
              { stageKeys: result.stageKeys }
            );
          case "unknown_migration_source":
            return fail(
              422,
              "UNKNOWN_MIGRATION_SOURCE",
              "A stageMigrations key is not a stage of the current revision.",
              {},
              { stageKeys: result.stageKeys }
            );
          case "converted_boundary":
            return fail(
              409,
              "CONVERTED_STAGE_MIGRATION_REFUSED",
              "A stage migration cannot move a converted lead out of a converted stage, or a lead that is not converted into one; record a conversion or its reversal instead.",
              {},
              { stageKeys: result.stageKeys }
            );
          case "published":
            break;
        }

        await auditCrmLeads(context, {
          action: "crm_leads.pipeline.publish_revision",
          resourceType: "crm_leads_pipeline",
          resourceId: id,
          severity: "warning",
          message: "Lead pipeline revision published.",
          attributes: {
            revisionNumber: result.pipeline.currentRevisionNumber,
            definitionHash: result.pipeline.currentRevision.definitionHash,
            removedStageKeys: result.removedStageKeys,
            migratedLeadCount: result.migratedLeadCount
          }
        });

        return {
          status: 201,
          body: {
            ...result.pipeline,
            migratedLeadCount: result.migratedLeadCount
          }
        };
      }
    );
  }
});
