import { ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  readApprovalThreshold,
  writeApprovalThreshold
} from "../../../../modules/procurement/application/procurement-document-directory";
import {
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../modules/procurement/application/procurement-route-support";
import { PROCUREMENT_GUARDS } from "../../../../modules/procurement/domain/procurement-permissions";
import {
  validatePolicyInput,
  type PolicyInput
} from "../../../../modules/procurement/domain/procurement-validation";
import { APPROVAL_WORKFLOW_KEY } from "../../../../modules/procurement/domain/procurement-types";

const IDEMPOTENCY_SCOPE = "procurement_policy_set";

/**
 * `GET /api/v1/procurement/policy` — the approval threshold. `null` means
 * approval is off. The workflow a submitted document needing approval starts is
 * always `procurement.document_approval`.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: PROCUREMENT_GUARDS.policy.read,
  handler: async ({ tx, tenantId }) =>
    ok({
      approvalThreshold: await readApprovalThreshold(tx, tenantId),
      approvalWorkflowKey: APPROVAL_WORKFLOW_KEY
    })
});

type Prepared = { idempotencyKey: string; input: PolicyInput };

/**
 * `PUT /api/v1/procurement/policy` — set (or clear with `null`) the approval
 * threshold. Changing it decides which documents need a second pair of eyes
 * before they move stock, so it has its own permission, needs an
 * `Idempotency-Key` and is audited. It only affects documents submitted AFTER the
 * change — an approval decision is recorded on the document at submit.
 */
export const PUT = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validatePolicyInput);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: PROCUREMENT_GUARDS.policy.configure,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      prepared.input,
      async () => ({
        status: 200,
        body: {
          approvalThreshold: await writeApprovalThreshold(
            tx,
            tenantId,
            {
              actorTenantUserId: auth.context.tenantUserId,
              correlationId: locals.correlationId
            },
            prepared.input.approvalThreshold
          ),
          approvalWorkflowKey: APPROVAL_WORKFLOW_KEY
        }
      })
    )
});
