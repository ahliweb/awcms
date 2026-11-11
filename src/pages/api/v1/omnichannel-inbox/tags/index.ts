import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  createTag,
  listTags
} from "../../../../../modules/omnichannel-inbox/application/tag-directory";
import {
  auditInbox,
  disabledResponse,
  personOnlyRefusal,
  readIdempotencyKey,
  requireTenantWide,
  readValidatedBody,
  runIdempotent
} from "../../../../../modules/omnichannel-inbox/application/route-support";
import { OMNICHANNEL_INBOX_GUARDS } from "../../../../../modules/omnichannel-inbox/domain/inbox-constants";
import { validateTagCreateBody } from "../../../../../modules/omnichannel-inbox/domain/inbox-validation";

/**
 * `GET /api/v1/omnichannel-inbox/tags` — the tenant's live inbox tags. Anyone
 * who reads conversations may read the catalogue their tag ids point to.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  prepare: () => disabledResponse() ?? undefined,
  authorize: OMNICHANNEL_INBOX_GUARDS.readConversations,
  handler: async (context) =>
    ok({ items: await listTags(context.tx, context.tenantId) })
});

/**
 * `POST /api/v1/omnichannel-inbox/tags` — create a tag (`code`, `label`).
 * `Idempotency-Key`; a live duplicate code is `409 TAG_CODE_TAKEN`; audited.
 */
export const POST = defineTenantRoute<{
  key: string;
  body: { code: string; label: string };
}>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    const key = readIdempotencyKey(request);

    if (key instanceof Response) return key;

    const body = await readValidatedBody(request, validateTagCreateBody);

    return body instanceof Response ? body : { key, body };
  },
  authorize: OMNICHANNEL_INBOX_GUARDS.configureTags,
  handler: async (context) => {
    // The catalogue is tenant-wide: a scope-confined manager may not shape it
    // (#1275 audit, L-3).
    const refused =
      personOnlyRefusal(context.auth) ??
      (await requireTenantWide(
        context,
        OMNICHANNEL_INBOX_GUARDS.configureTags
      ));

    if (refused) return refused;

    const actor = context.auth.context.tenantUserId;

    return runIdempotent(
      context.tx,
      context.tenantId,
      "omnichannel_inbox_tag_create",
      context.prepared.key,
      actor,
      context.prepared.body,
      async () => {
        const result = await createTag(
          context.tx,
          context.tenantId,
          actor,
          context.prepared.body
        );

        if (result.outcome === "duplicate") {
          return fail(
            409,
            "TAG_CODE_TAKEN",
            "A live tag with this code already exists."
          );
        }

        await auditInbox(context, {
          action: "omnichannel_inbox.tag.create",
          resourceType: "omnichannel_inbox_tag",
          resourceId: result.tag.id,
          severity: "info",
          message: "Inbox tag created."
        });

        return { status: 201, body: { tag: result.tag } };
      }
    );
  }
});
