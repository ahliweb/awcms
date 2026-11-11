import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { rebuildProjection } from "../../../../../modules/omnichannel-inbox/application/conversation-projector";
import {
  auditInbox,
  disabledResponse,
  personOnlyRefusal,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../modules/omnichannel-inbox/application/route-support";
import { OMNICHANNEL_INBOX_GUARDS } from "../../../../../modules/omnichannel-inbox/domain/inbox-constants";
import { validateRebuildBody } from "../../../../../modules/omnichannel-inbox/domain/inbox-validation";

/**
 * `POST /api/v1/omnichannel-inbox/projection/rebuild` — replay the verified
 * inbound events of this tenant (inside `windowDays`, at most the default
 * retention) into the conversation projection, one bounded batch per call; call
 * again with `afterSequence: nextAfterSequence` until `complete`. Idempotent by
 * value: replaying an event already applied changes nothing, and staff work
 * state (status, assignee, tags, responses) is never reset. High-risk:
 * `Idempotency-Key`, audited at warning.
 */
export const POST = defineTenantRoute<{
  key: string;
  body: { afterSequence: string; windowDays: number };
}>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    const key = readIdempotencyKey(request);

    if (key instanceof Response) return key;

    const body = await readValidatedBody(request, validateRebuildBody);

    return body instanceof Response ? body : { key, body };
  },
  authorize: OMNICHANNEL_INBOX_GUARDS.configureProjection,
  handler: async (context) => {
    const refused = personOnlyRefusal(context.auth);

    if (refused) return refused;

    const actor = context.auth.context.tenantUserId;

    return runIdempotent(
      context.tx,
      context.tenantId,
      "omnichannel_inbox_projection_rebuild",
      context.prepared.key,
      actor,
      context.prepared.body,
      async () => {
        const result = await rebuildProjection(context.tx, context.tenantId, {
          afterSequence: context.prepared.body.afterSequence,
          windowDays: context.prepared.body.windowDays,
          now: context.now
        });

        await auditInbox(context, {
          action: "omnichannel_inbox.projection.rebuild",
          resourceType: "omnichannel_inbox_projection",
          resourceId: null,
          severity: "warning",
          message: "Inbox projection rebuild batch replayed.",
          attributes: {
            processed: result.processed,
            created: result.created,
            complete: result.complete
          }
        });

        return { status: 200, body: result };
      }
    );
  }
});
