/**
 * Enqueue: one publication and one job per eligible target account (Issue
 * #1145, ADR-0157 section 4).
 *
 * Runs entirely in the CALLER's transaction and makes plain DB writes only: no
 * provider call, no network, no secret read (ADR-0006). That is what makes the
 * article path safe inside `blog_content`'s publish transaction, and what makes
 * a rolled-back publish leave no job behind.
 *
 * ## What it refuses, and how
 *
 * Per account, in this order, each a RETURNED code and never a throw:
 *
 * 1. the account may not publish right now (`channel_accounts` port: revoked,
 *    disabled, degraded, disconnected, no granted `publish` capability with
 *    evidence, or not a publisher at all);
 * 2. the provider has no adapter (`PROVIDER_ADAPTER_UNAVAILABLE`);
 * 3. the provider's capability map cannot carry the content (no downgrade, no
 *    truncation, no other provider).
 *
 * Accounts are evaluated BEFORE anything is inserted, so a request in which
 * every account is refused leaves no publication behind (a manual request is
 * simply answered; an article event records nothing, so a later event for the
 * same article can still publish once an account is fixed).
 *
 * ## Idempotency
 *
 * One publication per (article, trigger) and one job per (publication, account),
 * both unique keys, plus the tenant-wide job idempotency key. A repeated call
 * creates nothing for an account that already has a job and adds a job only for
 * an account that has become eligible since.
 */
import type {
  ChannelPublisherPort,
  PublisherUnavailableReason
} from "../../_shared/ports/channel-account-port";
import {
  buildSocialPublishIdempotencyKey,
  checkAdapterSupport,
  type AdapterSupportCode,
  type ContentSnapshot
} from "../domain/social-publish-content";
import {
  DEFAULT_JOB_MAX_ATTEMPTS,
  type PublicationState,
  type PublicationSourceKind,
  type SocialPublishTrigger
} from "../domain/social-publishing-constants";
import type { SocialAdapterRegistry } from "../infrastructure/social-adapter-registry";
import { emitPublicationQueued } from "./social-publishing-event-emit";

export type AccountRefusalCode =
  | PublisherUnavailableReason
  | AdapterSupportCode
  | "PROVIDER_ADAPTER_UNAVAILABLE"
  | "PUBLISHERS_UNAVAILABLE"
  | "PUBLICATION_CLOSED";

export type EnqueueSource =
  | { kind: "article"; articleId: string; trigger: SocialPublishTrigger }
  | { kind: "manual" };

export type EnqueueInput = {
  source: EnqueueSource;
  snapshot: ContentSnapshot;
  mediaObjectId: string | null;
  accountIds: readonly string[];
  approvalRequired: boolean;
  notBefore: Date | null;
  actorTenantUserId: string | null;
  correlationId?: string | null;
};

export type EnqueueDeps = {
  /** `null` when the channel module cannot be loaded: every account is then refused (fail closed). */
  publishers: ChannelPublisherPort | null;
  registry: SocialAdapterRegistry;
};

export type AccountOutcome =
  | { accountId: string; outcome: "queued"; jobId: string }
  | { accountId: string; outcome: "existing"; jobId: string }
  | { accountId: string; outcome: "refused"; reason: AccountRefusalCode };

export type EnqueueResult = {
  /** `null` when nothing was eligible and nothing was recorded. */
  publicationId: string | null;
  state: PublicationState | null;
  createdPublication: boolean;
  jobsCreated: number;
  accounts: AccountOutcome[];
};

type PublicationRow = { id: string; state: PublicationState };

type Eligible = {
  accountId: string;
  provider: string;
  accountKind: string;
  variant: ContentSnapshot["variant"];
};

const MANUAL_TRIGGER: SocialPublishTrigger = "manual_editor_action";

async function findArticlePublication(
  tx: Bun.SQL,
  tenantId: string,
  articleId: string,
  trigger: SocialPublishTrigger
): Promise<PublicationRow | null> {
  const rows = (await tx`
    SELECT id, state FROM awcms_social_publications
    WHERE tenant_id = ${tenantId} AND source_kind = 'article'
      AND source_id = ${articleId} AND trigger_event = ${trigger}
  `) as PublicationRow[];

  return rows[0] ?? null;
}

async function jobIdFor(
  tx: Bun.SQL,
  tenantId: string,
  publicationId: string,
  accountId: string
): Promise<string | null> {
  const rows = (await tx`
    SELECT id FROM awcms_social_publish_jobs
    WHERE tenant_id = ${tenantId} AND publication_id = ${publicationId}
      AND channel_account_id = ${accountId}
  `) as { id: string }[];

  return rows[0]?.id ?? null;
}

export async function enqueuePublication(
  tx: Bun.SQL,
  tenantId: string,
  input: EnqueueInput,
  deps: EnqueueDeps
): Promise<EnqueueResult> {
  const sourceKind: PublicationSourceKind = input.source.kind;
  const trigger =
    input.source.kind === "article" ? input.source.trigger : MANUAL_TRIGGER;
  const articleId =
    input.source.kind === "article" ? input.source.articleId : null;

  let publication: PublicationRow | null = articleId
    ? await findArticlePublication(tx, tenantId, articleId, trigger)
    : null;

  const accounts: AccountOutcome[] = [];
  const eligible: Eligible[] = [];

  for (const accountId of input.accountIds) {
    if (publication) {
      const existing = await jobIdFor(tx, tenantId, publication.id, accountId);

      if (existing) {
        accounts.push({ accountId, outcome: "existing", jobId: existing });
        continue;
      }

      if (
        publication.state === "cancelled" ||
        publication.state === "refused"
      ) {
        accounts.push({
          accountId,
          outcome: "refused",
          reason: "PUBLICATION_CLOSED"
        });
        continue;
      }
    }

    if (!deps.publishers) {
      accounts.push({
        accountId,
        outcome: "refused",
        reason: "PUBLISHERS_UNAVAILABLE"
      });
      continue;
    }

    const resolved = await deps.publishers.resolvePublisher(tx, {
      tenantId,
      accountId
    });

    if (!resolved.usable) {
      accounts.push({ accountId, outcome: "refused", reason: resolved.reason });
      continue;
    }

    const adapter = deps.registry.get(resolved.publisher.provider);

    if (!adapter) {
      accounts.push({
        accountId,
        outcome: "refused",
        reason: "PROVIDER_ADAPTER_UNAVAILABLE"
      });
      continue;
    }

    const support = checkAdapterSupport(adapter.capabilities, input.snapshot);

    if (!support.ok) {
      accounts.push({ accountId, outcome: "refused", reason: support.code });
      continue;
    }

    eligible.push({
      accountId,
      provider: resolved.publisher.provider,
      accountKind: resolved.publisher.accountKind,
      variant: input.snapshot.variant
    });
  }

  if (eligible.length === 0) {
    return {
      publicationId: publication?.id ?? null,
      state: publication?.state ?? null,
      createdPublication: false,
      jobsCreated: 0,
      accounts
    };
  }

  let createdPublication = false;

  if (!publication) {
    const state: PublicationState = input.approvalRequired
      ? "pending_approval"
      : "ready";
    const media = input.snapshot.media;
    const inserted = (await tx`
      INSERT INTO awcms_social_publications
        (tenant_id, source_kind, source_id, trigger_event, state, title,
         caption, link_url, media_object_id, media_snapshot, content_hash,
         not_before, approval_required, correlation_id, created_by)
      VALUES (${tenantId}, ${sourceKind}, ${articleId}, ${trigger}, ${state},
              ${input.snapshot.title}, ${input.snapshot.caption},
              ${input.snapshot.linkUrl}, ${input.mediaObjectId},
              ${media}::jsonb,
              ${input.snapshot.contentHash}, ${input.notBefore},
              ${input.approvalRequired}, ${input.correlationId ?? null},
              ${input.actorTenantUserId})
      ON CONFLICT (tenant_id, source_id, trigger_event)
        WHERE source_kind = 'article' DO NOTHING
      RETURNING id, state
    `) as PublicationRow[];

    if (inserted[0]) {
      publication = inserted[0];
      createdPublication = true;
    } else if (articleId) {
      // Lost a race with a concurrent identical event: use the winner's row.
      publication = await findArticlePublication(
        tx,
        tenantId,
        articleId,
        trigger
      );
    }

    if (!publication) {
      throw new Error("A social publication could not be created or found.");
    }
  }

  const sourceKey = articleId ?? publication.id;
  let jobsCreated = 0;
  const queuedAccountIds: string[] = [];

  for (const target of eligible) {
    const idempotencyKey = buildSocialPublishIdempotencyKey(
      tenantId,
      sourceKey,
      trigger,
      target.accountId
    );
    const rows = (await tx`
      INSERT INTO awcms_social_publish_jobs
        (tenant_id, publication_id, channel_account_id, provider, account_kind,
         variant, idempotency_key, max_attempts, created_by)
      VALUES (${tenantId}, ${publication.id}, ${target.accountId},
              ${target.provider}, ${target.accountKind}, ${target.variant},
              ${idempotencyKey}, ${DEFAULT_JOB_MAX_ATTEMPTS},
              ${input.actorTenantUserId})
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING id
    `) as { id: string }[];

    if (rows[0]) {
      jobsCreated += 1;
      queuedAccountIds.push(target.accountId);
      accounts.push({
        accountId: target.accountId,
        outcome: "queued",
        jobId: rows[0].id
      });
    } else {
      // Another identical request won between the existence read and the insert.
      const existing =
        (await jobIdFor(tx, tenantId, publication.id, target.accountId)) ?? "";

      accounts.push({
        accountId: target.accountId,
        outcome: "existing",
        jobId: existing
      });
    }
  }

  if (jobsCreated > 0) {
    await emitPublicationQueued(tx, tenantId, {
      publicationId: publication.id,
      sourceKind,
      sourceId: articleId,
      trigger,
      state: publication.state,
      jobCount: jobsCreated,
      accountIds: queuedAccountIds,
      correlationId: input.correlationId ?? null,
      actorTenantUserId: input.actorTenantUserId
    });
  }

  return {
    publicationId: publication.id,
    state: publication.state,
    createdPublication,
    jobsCreated,
    accounts
  };
}

/**
 * An article event whose CONTENT cannot be published (an unsafe link, media that
 * is not eligible) is recorded as a `refused` publication with a coded reason,
 * so it is visible to an operator and a repeated event does not retry a decision
 * that will come out the same. Zero jobs, nothing sent.
 */
export async function recordRefusedArticlePublication(
  tx: Bun.SQL,
  tenantId: string,
  input: {
    articleId: string;
    trigger: SocialPublishTrigger;
    title: string;
    caption: string;
    refusalCode: string;
    approvalRequired: boolean;
    correlationId?: string | null;
  }
): Promise<{ publicationId: string; created: boolean }> {
  const hash = "0".repeat(64);
  const title = input.title.trim().slice(0, 300) || "(untitled)";
  const caption = input.caption.trim().slice(0, 2000) || title;
  const rows = (await tx`
    INSERT INTO awcms_social_publications
      (tenant_id, source_kind, source_id, trigger_event, state, refusal_code,
       title, caption, content_hash, approval_required, correlation_id)
    VALUES (${tenantId}, 'article', ${input.articleId}, ${input.trigger},
            'refused', ${input.refusalCode}, ${title}, ${caption}, ${hash},
            ${input.approvalRequired}, ${input.correlationId ?? null})
    ON CONFLICT (tenant_id, source_id, trigger_event)
      WHERE source_kind = 'article' DO NOTHING
    RETURNING id
  `) as { id: string }[];

  if (rows[0]) return { publicationId: rows[0].id, created: true };

  const existing = await findArticlePublication(
    tx,
    tenantId,
    input.articleId,
    input.trigger
  );

  return { publicationId: existing?.id ?? "", created: false };
}
