/**
 * Reply-notification subscriptions + domain events (ADR-0041, ported from
 * awcms-micro Issue #271).
 *
 * Two responsibilities, both privacy-first:
 *
 * 1. `createReplySubscription` — record an opt-in reply-notify subscription with
 *    a MINIMIZED recipient: a sha256 lookup hash, an AES-GCM-encrypted address
 *    (or the unresolvable sentinel when no key is configured), and an unsubscribe
 *    token hash. The plaintext address is never returned, logged, or eventified.
 *
 * 2. `appendCommentEvent` — publish a domain event through the transactional
 *    outbox (`appendDomainEvent`, same-commit, ADR-0006: no provider call here).
 *    The event payload carries only opaque references (comment id, thread id,
 *    resource type/url, subscriber-notify hint counts) — NEVER a recipient
 *    address. The email dispatcher (a documented follow-up consumer) resolves the
 *    address from the encrypted column at send time, OUTSIDE any DB transaction.
 */
import { createHash, randomBytes } from "node:crypto";

import { appendDomainEvent } from "../../domain-event-runtime/application/append-domain-event";
import {
  COMMENTS_AGGREGATE_TYPE,
  COMMENTS_EVENT_VERSION
} from "../domain/comment-events";
import {
  encryptSubscriberEmail,
  resolveSubscriberEncryptionKey,
  UNRESOLVABLE_SUBSCRIBER_REF
} from "../domain/subscriber-crypto";

const COMMENTS_PRODUCER_MODULE = "comments";

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export type CreateReplySubscriptionInput = {
  threadId: string;
  /** The comment being subscribed to (null = whole thread). */
  commentId: string | null;
  /** Normalized (lowercased/trimmed) subscriber email — never stored raw. */
  normalizedEmail: string;
};

export type ReplySubscriptionResult = {
  subscriptionId: string;
  /** The raw unsubscribe token (returned ONCE to embed in a confirm/unsubscribe link); only its hash is stored. */
  unsubscribeToken: string;
  resolvable: boolean;
};

/**
 * Upsert an opt-in reply subscription. Returns the raw unsubscribe token exactly
 * once (for the double-opt-in confirmation link); the DB stores only its hash.
 */
export async function createReplySubscription(
  tx: Bun.SQL,
  tenantId: string,
  input: CreateReplySubscriptionInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<ReplySubscriptionResult> {
  const emailHash = sha256(input.normalizedEmail);
  const key = resolveSubscriberEncryptionKey(env);
  const encrypted =
    encryptSubscriberEmail(input.normalizedEmail, key) ??
    UNRESOLVABLE_SUBSCRIBER_REF;
  const unsubscribeToken = randomBytes(32).toString("base64url");
  const unsubscribeTokenHash = sha256(unsubscribeToken);

  const rows = (await tx`
    INSERT INTO awcms_comments_reply_subscriptions
      (tenant_id, thread_id, comment_id, subscriber_email_hash,
       subscriber_email_encrypted, unsubscribe_token_hash)
    VALUES (
      ${tenantId}, ${input.threadId}, ${input.commentId}, ${emailHash},
      ${encrypted}, ${unsubscribeTokenHash}
    )
    ON CONFLICT (tenant_id, thread_id, coalesce(comment_id, '00000000-0000-0000-0000-000000000000'::uuid), subscriber_email_hash)
    DO UPDATE SET subscriber_email_encrypted = EXCLUDED.subscriber_email_encrypted
    RETURNING id
  `) as { id: string }[];

  return {
    subscriptionId: rows[0]!.id,
    unsubscribeToken,
    resolvable: encrypted !== UNRESOLVABLE_SUBSCRIBER_REF
  };
}

export type CommentEventInput = {
  eventType: string;
  commentId: string;
  threadId: string;
  parentCommentId: string | null;
  resourceType: string;
  resourceUrl: string;
  status: string;
  correlationId?: string | null;
  actorTenantUserId?: string | null;
};

/**
 * Publish a comment domain event through the transactional outbox. The payload is
 * deliberately minimal + address-free.
 */
export async function appendCommentEvent(
  tx: Bun.SQL,
  tenantId: string,
  input: CommentEventInput
): Promise<void> {
  await appendDomainEvent(tx, tenantId, {
    eventType: input.eventType,
    eventVersion: COMMENTS_EVENT_VERSION,
    aggregateType: COMMENTS_AGGREGATE_TYPE,
    aggregateId: input.commentId,
    producerModule: COMMENTS_PRODUCER_MODULE,
    correlationId: input.correlationId ?? null,
    actorTenantUserId: input.actorTenantUserId ?? null,
    payload: {
      commentId: input.commentId,
      threadId: input.threadId,
      parentCommentId: input.parentCommentId,
      resourceType: input.resourceType,
      resourceUrl: input.resourceUrl,
      status: input.status
    }
  });
}
