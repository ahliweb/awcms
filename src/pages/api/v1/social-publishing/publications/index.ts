import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { mediaLibraryPortAdapter } from "../../../../../modules/media-library/application/media-library-port-adapter";
import {
  enqueuePublication,
  type AccountOutcome
} from "../../../../../modules/social-publishing/application/publication-enqueue";
import {
  fetchPublication,
  listPublications
} from "../../../../../modules/social-publishing/application/publication-directory";
import {
  auditPublishing,
  canUseAllAccounts,
  disabledResponse,
  loadPublishersOrNull,
  mutationRefusal,
  readIdempotencyKey,
  readJson,
  runIdempotent,
  validationFailure
} from "../../../../../modules/social-publishing/application/route-support";
import { fetchSettings } from "../../../../../modules/social-publishing/application/settings-directory";
import { buildContentSnapshot } from "../../../../../modules/social-publishing/domain/social-publish-content";
import { SOCIAL_PUBLISHING_GUARDS } from "../../../../../modules/social-publishing/domain/social-publishing-constants";
import {
  validateCreatePublication,
  validateListPublicationsQuery,
  type CreatePublicationInput,
  type ListPublicationsParams
} from "../../../../../modules/social-publishing/domain/social-publishing-validation";
import { socialAdapterRegistry } from "../../../../../modules/social-publishing/infrastructure/social-adapter-registry";

/**
 * `GET /api/v1/social-publishing/publications` (Issue #1145) — the tenant's
 * publications, newest first, keyset-paginated, each with its DERIVED aggregate
 * status and per-status job counts. Never a credential, a token reference or an
 * account label.
 */
export const GET = defineTenantRoute<ListPublicationsParams>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const query = validateListPublicationsQuery(url.searchParams);

    return query.valid ? query.value : validationFailure(query.errors);
  },
  authorize: SOCIAL_PUBLISHING_GUARDS.publicationsRead,
  handler: async (context) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    const result = await listPublications(context.tx, context.tenantId, {
      limit: context.prepared.limit,
      cursor: context.prepared.cursor,
      state: context.prepared.state
    });

    if (!result.ok) {
      return fail(400, "VALIDATION_ERROR", "cursor is invalid.");
    }

    return ok({ items: result.items, nextCursor: result.nextCursor });
  }
});

type Prepared = { idempotencyKey: string; input: CreatePublicationInput };

function accountRefusalBody(accounts: AccountOutcome[]) {
  return accounts.map((account) =>
    account.outcome === "refused"
      ? {
          accountId: account.accountId,
          outcome: account.outcome,
          reason: account.reason
        }
      : {
          accountId: account.accountId,
          outcome: account.outcome,
          jobId: account.jobId
        }
  );
}

/**
 * `POST /api/v1/social-publishing/publications` (Issue #1145, ADR-0157) —
 * publish one piece of content to N chosen connected accounts, now or at
 * `notBefore`.
 *
 * The request names accounts BY ID and carries no provider, token, page id or
 * phone number: those are read from each account's record. The caller must be
 * able to use every named account (assignment rule and business scope, by the
 * rules of `channel_accounts`); any account they cannot use, another tenant's
 * and an unknown id are ONE answer, `422 ACCOUNT_NOT_USABLE`, for the whole
 * request, before anything is created.
 *
 * Content is snapshotted now (`media_library` verifies the image, its type, size
 * and rights status); it never changes afterwards. Per account the request is
 * accepted or REFUSED with a code (the account may not publish now, the provider
 * has no adapter, the provider cannot carry the content): nothing is downgraded
 * and nothing is sent to another account. If every account is refused the
 * answer is `422 NO_ELIGIBLE_ACCOUNT` with the per-account codes and nothing is
 * recorded. A publication starts `pending_approval` when the tenant requires
 * approval (the default), and the person who created it cannot approve it.
 * High-risk: `Idempotency-Key` required, audited at `warning`.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request, now }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    const body = await readJson(request);

    if (body instanceof Response) return body;

    const input = validateCreatePublication(body, now);

    return input.valid
      ? { idempotencyKey, input: input.value }
      : validationFailure(input.errors);
  },
  authorize: SOCIAL_PUBLISHING_GUARDS.publicationsPublish,
  handler: async (context) => {
    const refused = mutationRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;
    const input = prepared.input;

    // Before the idempotent section, so a refusal is never stored for replay and
    // a replay by a caller who has since lost access is refused.
    if (
      !(await canUseAllAccounts(
        context,
        SOCIAL_PUBLISHING_GUARDS.publicationsPublish,
        input.accountIds
      ))
    ) {
      return fail(
        422,
        "ACCOUNT_NOT_USABLE",
        "One or more of the named accounts cannot be used by you."
      );
    }

    let media = null;

    if (input.mediaObjectId) {
      const resolved = await mediaLibraryPortAdapter.resolveMediaReferences(
        tx,
        tenantId,
        [input.mediaObjectId]
      );
      const found = resolved.get(input.mediaObjectId);

      if (!found) {
        return fail(
          422,
          "MEDIA_NOT_ELIGIBLE",
          "The media is not a verified object of this tenant that can be published."
        );
      }

      media = {
        publicUrl: found.publicUrl,
        altText: found.altText,
        mimeType: found.mimeType,
        sizeBytes: found.sizeBytes,
        creditLine: found.creditLine,
        copyrightStatus: found.copyrightStatus
      };
    }

    const snapshot = buildContentSnapshot({
      title: input.title,
      caption: input.caption,
      linkUrl: input.linkUrl,
      media
    });

    if (!snapshot.ok) {
      return fail(
        422,
        snapshot.code,
        "The content cannot be published as given."
      );
    }

    const settings = await fetchSettings(tx, tenantId);
    const publishers = await loadPublishersOrNull();

    return runIdempotent(
      tx,
      tenantId,
      "social_publishing_publication_create",
      prepared.idempotencyKey,
      actor,
      input,
      async () => {
        const result = await enqueuePublication(
          tx,
          tenantId,
          {
            source: { kind: "manual" },
            snapshot: snapshot.snapshot,
            mediaObjectId: input.mediaObjectId,
            accountIds: input.accountIds,
            approvalRequired: settings.approvalRequired,
            notBefore: input.notBefore,
            actorTenantUserId: actor,
            correlationId: context.locals.correlationId ?? null
          },
          { publishers, registry: socialAdapterRegistry }
        );

        if (result.jobsCreated === 0 || !result.publicationId) {
          return fail(
            422,
            "NO_ELIGIBLE_ACCOUNT",
            "None of the named accounts can publish this content.",
            {},
            accountRefusalBody(result.accounts)
          );
        }

        await auditPublishing(context, {
          action: "social_publishing.publication.create",
          resourceType: "social_publication",
          resourceId: result.publicationId,
          severity: "warning",
          message: "Social publication created.",
          attributes: {
            state: result.state,
            jobsCreated: result.jobsCreated,
            accounts: accountRefusalBody(result.accounts),
            scheduled: input.notBefore !== null,
            hasMedia: media !== null,
            contentHash: snapshot.snapshot.contentHash
          }
        });

        const detail = await fetchPublication(
          tx,
          tenantId,
          result.publicationId
        );

        return {
          status: 201,
          body: {
            publication: detail?.publication ?? null,
            jobs: detail?.jobs ?? [],
            accounts: accountRefusalBody(result.accounts)
          }
        };
      }
    );
  }
});
