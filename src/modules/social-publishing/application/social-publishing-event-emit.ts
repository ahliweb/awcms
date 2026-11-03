/**
 * Domain-event emission for `social_publishing` (Issue #1145, ADR-0157). Every
 * call is a plain DB write in the caller's OWN transaction (`appendDomainEvent`
 * makes no network call), so a rolled-back enqueue emits no `queued` event by
 * construction.
 *
 * Payloads carry ids, enums, counts and codes. Never a caption, a URL, a title
 * or a credential: a consumer reads details through the module's API with its
 * own permission.
 */
import { appendDomainEvent } from "../../domain-event-runtime/application/append-domain-event";
import {
  SOCIAL_JOB_AGGREGATE_TYPE,
  SOCIAL_JOB_FAILED_EVENT_TYPE,
  SOCIAL_JOB_PUBLISHED_EVENT_TYPE,
  SOCIAL_PUBLICATION_AGGREGATE_TYPE,
  SOCIAL_PUBLICATION_CANCELLED_EVENT_TYPE,
  SOCIAL_PUBLICATION_QUEUED_EVENT_TYPE,
  SOCIAL_PUBLISHING_EVENT_VERSION,
  SOCIAL_PUBLISHING_MODULE_KEY
} from "../domain/social-publishing-constants";

export async function emitPublicationQueued(
  tx: Bun.SQL,
  tenantId: string,
  input: {
    publicationId: string;
    sourceKind: string;
    sourceId: string | null;
    trigger: string;
    state: string;
    jobCount: number;
    accountIds: readonly string[];
    correlationId?: string | null;
    actorTenantUserId?: string | null;
  }
): Promise<void> {
  await appendDomainEvent(tx, tenantId, {
    eventType: SOCIAL_PUBLICATION_QUEUED_EVENT_TYPE,
    eventVersion: SOCIAL_PUBLISHING_EVENT_VERSION,
    aggregateType: SOCIAL_PUBLICATION_AGGREGATE_TYPE,
    aggregateId: input.publicationId,
    correlationId: input.correlationId ?? null,
    producerModule: SOCIAL_PUBLISHING_MODULE_KEY,
    actorTenantUserId: input.actorTenantUserId ?? null,
    payload: {
      publicationId: input.publicationId,
      sourceKind: input.sourceKind,
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
      trigger: input.trigger,
      state: input.state,
      jobCount: input.jobCount,
      accountIds: [...input.accountIds]
    }
  });
}

export async function emitPublicationCancelled(
  tx: Bun.SQL,
  tenantId: string,
  input: {
    publicationId: string;
    jobsCancelled: number;
    jobsAlreadyPublished: number;
    correlationId?: string | null;
    actorTenantUserId?: string | null;
  }
): Promise<void> {
  await appendDomainEvent(tx, tenantId, {
    eventType: SOCIAL_PUBLICATION_CANCELLED_EVENT_TYPE,
    eventVersion: SOCIAL_PUBLISHING_EVENT_VERSION,
    aggregateType: SOCIAL_PUBLICATION_AGGREGATE_TYPE,
    aggregateId: input.publicationId,
    correlationId: input.correlationId ?? null,
    producerModule: SOCIAL_PUBLISHING_MODULE_KEY,
    actorTenantUserId: input.actorTenantUserId ?? null,
    payload: {
      publicationId: input.publicationId,
      jobsCancelled: input.jobsCancelled,
      jobsAlreadyPublished: input.jobsAlreadyPublished
    }
  });
}

export async function emitJobPublished(
  tx: Bun.SQL,
  tenantId: string,
  input: {
    jobId: string;
    publicationId: string;
    accountId: string;
    provider: string;
    attemptNo: number;
    correlationId?: string | null;
  }
): Promise<void> {
  await appendDomainEvent(tx, tenantId, {
    eventType: SOCIAL_JOB_PUBLISHED_EVENT_TYPE,
    eventVersion: SOCIAL_PUBLISHING_EVENT_VERSION,
    aggregateType: SOCIAL_JOB_AGGREGATE_TYPE,
    aggregateId: input.jobId,
    correlationId: input.correlationId ?? null,
    producerModule: SOCIAL_PUBLISHING_MODULE_KEY,
    payload: {
      jobId: input.jobId,
      publicationId: input.publicationId,
      accountId: input.accountId,
      provider: input.provider,
      attemptNo: input.attemptNo
    }
  });
}

export async function emitJobFailed(
  tx: Bun.SQL,
  tenantId: string,
  input: {
    jobId: string;
    publicationId: string;
    accountId: string;
    provider: string;
    failureCode: string;
    attemptNo: number;
    correlationId?: string | null;
  }
): Promise<void> {
  await appendDomainEvent(tx, tenantId, {
    eventType: SOCIAL_JOB_FAILED_EVENT_TYPE,
    eventVersion: SOCIAL_PUBLISHING_EVENT_VERSION,
    aggregateType: SOCIAL_JOB_AGGREGATE_TYPE,
    aggregateId: input.jobId,
    correlationId: input.correlationId ?? null,
    producerModule: SOCIAL_PUBLISHING_MODULE_KEY,
    payload: {
      jobId: input.jobId,
      publicationId: input.publicationId,
      accountId: input.accountId,
      provider: input.provider,
      failureCode: input.failureCode,
      attemptNo: input.attemptNo
    }
  });
}
