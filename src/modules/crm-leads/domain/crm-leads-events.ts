/**
 * The outward seam of `crm_leads` (ADR-0153 section 6): the domain events a
 * downstream consumer (the `commerce` adapter, #1165 cadence, #1164 inbox)
 * subscribes to.
 *
 * Payloads carry OPAQUE IDS and attribution REFERENCES only (L6): never a name,
 * an email, a phone, a platform id, a reason or a note. Every payload carries
 * `privacyClass` and `contractVersion`.
 *
 * Pure module: no database, no I/O.
 */
import {
  CRM_LEADS_EVENT_PRIVACY_CLASS,
  type ContactPointKind,
  type ConversionMode,
  type SourceKind,
  type StageCategory,
  type TransitionKind
} from "./crm-leads-constants";

export const CRM_LEADS_EVENT_CONTRACT_VERSION = "1";

function envelope(body: Record<string, unknown>): Record<string, unknown> {
  return {
    contractVersion: CRM_LEADS_EVENT_CONTRACT_VERSION,
    ...body,
    privacyClass: CRM_LEADS_EVENT_PRIVACY_CLASS
  };
}

export function buildLeadCreatedPayload(facts: {
  leadId: string;
  pipelineId: string;
  revisionId: string;
  stageKey: string;
  stageCategory: StageCategory;
  touchId: string;
  sourceKind: SourceKind;
  channelAccountId: string | null;
  campaignRef: string | null;
  contactPointKinds: ContactPointKind[];
  occurredAt: Date;
  recordedAt: Date;
}): Record<string, unknown> {
  return envelope({
    leadId: facts.leadId,
    pipelineId: facts.pipelineId,
    revisionId: facts.revisionId,
    stageKey: facts.stageKey,
    stageCategory: facts.stageCategory,
    source: {
      touchId: facts.touchId,
      kind: facts.sourceKind,
      channelAccountId: facts.channelAccountId,
      campaignRef: facts.campaignRef
    },
    contactPointKinds: facts.contactPointKinds,
    occurredAt: facts.occurredAt.toISOString(),
    recordedAt: facts.recordedAt.toISOString()
  });
}

export type StageChangeFacts = {
  leadId: string;
  pipelineId: string;
  revisionId: string;
  transitionId: string;
  transitionKind: TransitionKind;
  fromStageKey: string | null;
  toStageKey: string;
  fromCategory: StageCategory | null;
  toCategory: StageCategory;
  occurredAt: Date;
  recordedAt: Date;
};

export function buildStageChangedPayload(
  facts: StageChangeFacts
): Record<string, unknown> {
  return envelope({
    leadId: facts.leadId,
    pipelineId: facts.pipelineId,
    revisionId: facts.revisionId,
    transitionId: facts.transitionId,
    transitionKind: facts.transitionKind,
    fromStageKey: facts.fromStageKey,
    toStageKey: facts.toStageKey,
    fromCategory: facts.fromCategory,
    toCategory: facts.toCategory,
    occurredAt: facts.occurredAt.toISOString(),
    recordedAt: facts.recordedAt.toISOString()
  });
}

export function buildLeadLostPayload(
  facts: StageChangeFacts
): Record<string, unknown> {
  return envelope({
    leadId: facts.leadId,
    pipelineId: facts.pipelineId,
    transitionId: facts.transitionId,
    toStageKey: facts.toStageKey,
    toCategory: facts.toCategory,
    occurredAt: facts.occurredAt.toISOString()
  });
}

export function buildLeadAssignedPayload(facts: {
  leadId: string;
  fromOwnerTenantUserId: string | null;
  toOwnerTenantUserId: string | null;
  assignedAt: Date;
}): Record<string, unknown> {
  return envelope({
    leadId: facts.leadId,
    fromOwnerTenantUserId: facts.fromOwnerTenantUserId,
    toOwnerTenantUserId: facts.toOwnerTenantUserId,
    assignedAt: facts.assignedAt.toISOString()
  });
}

export function buildLeadMergedPayload(facts: {
  mergeId: string;
  survivorLeadId: string;
  absorbedLeadId: string;
  mergedAt: Date;
  undoUntil: Date;
}): Record<string, unknown> {
  return envelope({
    mergeId: facts.mergeId,
    survivorLeadId: facts.survivorLeadId,
    absorbedLeadId: facts.absorbedLeadId,
    mergedAt: facts.mergedAt.toISOString(),
    undoUntil: facts.undoUntil.toISOString()
  });
}

export function buildLeadMergeRevertedPayload(facts: {
  mergeId: string;
  survivorLeadId: string;
  absorbedLeadId: string;
  revertedAt: Date;
}): Record<string, unknown> {
  return envelope({
    mergeId: facts.mergeId,
    survivorLeadId: facts.survivorLeadId,
    absorbedLeadId: facts.absorbedLeadId,
    revertedAt: facts.revertedAt.toISOString()
  });
}

export function buildLeadConvertedPayload(facts: {
  leadId: string;
  conversionId: string;
  mode: ConversionMode;
  externalCustomerRef: string | null;
  evidenceRef: string;
  toStageKey: string;
  occurredAt: Date;
  recordedAt: Date;
}): Record<string, unknown> {
  return envelope({
    leadId: facts.leadId,
    conversionId: facts.conversionId,
    mode: facts.mode,
    externalCustomerRef: facts.externalCustomerRef,
    evidenceRef: facts.evidenceRef,
    toStageKey: facts.toStageKey,
    occurredAt: facts.occurredAt.toISOString(),
    recordedAt: facts.recordedAt.toISOString()
  });
}

export function buildConversionReversedPayload(facts: {
  leadId: string;
  conversionId: string;
  reversalEvidenceRef: string;
  toStageKey: string;
  occurredAt: Date;
  recordedAt: Date;
}): Record<string, unknown> {
  return envelope({
    leadId: facts.leadId,
    conversionId: facts.conversionId,
    reversalEvidenceRef: facts.reversalEvidenceRef,
    toStageKey: facts.toStageKey,
    occurredAt: facts.occurredAt.toISOString(),
    recordedAt: facts.recordedAt.toISOString()
  });
}
