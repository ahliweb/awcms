/**
 * Domain events the `tax` module publishes through the shared outbox (ADR-0127,
 * ADR-0006).
 *
 * Every function runs inside the CALLER's tenant transaction — the event row
 * commits with the state change it describes and rolls back with it, so there is
 * no event for a snapshot that was never written. Nothing here calls a provider
 * or the network.
 *
 * Payloads are identifiers, codes and decimal-string totals. No customer data
 * ever reaches this module (a document is an opaque reference), so there is
 * nothing to redact — and the payload validator refuses credential-shaped keys
 * and values regardless.
 */
import { appendDomainEvent } from "../../domain-event-runtime/application/append-domain-event";
import {
  TAX_EVENT_VERSION,
  TAX_RULE_VERSION_AGGREGATE_TYPE,
  TAX_RULE_VERSION_PUBLISHED_EVENT_TYPE,
  TAX_SNAPSHOT_AGGREGATE_TYPE,
  TAX_SNAPSHOT_FINALISED_EVENT_TYPE,
  TAX_SNAPSHOT_REVERSED_EVENT_TYPE
} from "../domain/tax-events";
import { TAX_MODULE_KEY } from "../domain/tax-permissions";
import type { RuleVersionView } from "./tax-rule-version-directory";
import type { SnapshotView } from "./tax-snapshot-directory";

type Context = {
  actorTenantUserId: string;
  correlationId: string | undefined;
};

export async function publishRuleVersionPublishedEvent(
  tx: Bun.SQL,
  tenantId: string,
  version: RuleVersionView,
  closedVersionId: string | null,
  context: Context
): Promise<void> {
  await appendDomainEvent(tx, tenantId, {
    eventType: TAX_RULE_VERSION_PUBLISHED_EVENT_TYPE,
    eventVersion: TAX_EVENT_VERSION,
    aggregateType: TAX_RULE_VERSION_AGGREGATE_TYPE,
    aggregateId: version.id,
    // Ordered per profile: a consumer applying "version N+1 published" must not
    // see it before "version N+1's predecessor was closed".
    orderKey: `tax.profile:${version.profileCode}`,
    producerModule: TAX_MODULE_KEY,
    correlationId: context.correlationId,
    actorTenantUserId: context.actorTenantUserId,
    payload: {
      ruleVersionId: version.id,
      profileCode: version.profileCode,
      versionNo: version.versionNo,
      jurisdictionCode: version.jurisdictionCode,
      effectiveFrom: version.effectiveFrom,
      closedVersionId
    }
  });
}

export async function publishSnapshotEvent(
  tx: Bun.SQL,
  tenantId: string,
  snapshot: SnapshotView,
  context: Context
): Promise<void> {
  await appendDomainEvent(tx, tenantId, {
    eventType:
      snapshot.kind === "sale"
        ? TAX_SNAPSHOT_FINALISED_EVENT_TYPE
        : TAX_SNAPSHOT_REVERSED_EVENT_TYPE,
    eventVersion: TAX_EVENT_VERSION,
    aggregateType: TAX_SNAPSHOT_AGGREGATE_TYPE,
    aggregateId: snapshot.id,
    producerModule: TAX_MODULE_KEY,
    correlationId: context.correlationId,
    actorTenantUserId: context.actorTenantUserId,
    payload: {
      snapshotId: snapshot.id,
      kind: snapshot.kind,
      documentType: snapshot.documentType,
      documentId: snapshot.documentId,
      originalSnapshotId: snapshot.originalSnapshotId,
      ruleVersionId: snapshot.ruleVersionId,
      profileCode: snapshot.profileCode,
      versionNo: snapshot.versionNo,
      taxDate: snapshot.taxDate,
      currencyCode: snapshot.currencyCode,
      netTotal: snapshot.netTotal,
      taxTotal: snapshot.taxTotal,
      grossTotal: snapshot.grossTotal
    }
  });
}
