/**
 * Leads: intake, reads, edits, assignment, candidates, soft delete and
 * anonymising erasure (Issue #1166, ADR-0153 sections 4, 5 and 7).
 *
 * ## Intake is idempotent on its source key (L4)
 *
 * `(tenant, source kind, channel account, external event id)` is UNIQUE in the
 * database. A transaction-scoped advisory lock on that key serialises two
 * concurrent deliveries of the same event, so the second one finds the first
 * one's lead instead of tripping the unique index after it already wrote a
 * lead row. A replay answers the SAME lead and writes nothing.
 *
 * ## Contact points
 *
 * Ciphertext + per-tenant, per-kind keyed hash + masked form. No read path in
 * this module decrypts: every response carries the masked form only, and a
 * lookup by contact value is an EXACT keyed-hash match inside the tenant.
 *
 * ## No profile, no consent, no customer
 *
 * Intake creates no `profile_identity` row (N2), records the controller's
 * stated legal basis without granting anything (N3), and never writes
 * `external_customer_ref` (N1: only a conversion does).
 */
import { randomUUID } from "node:crypto";

import {
  encryptField,
  keyedHashCandidates,
  keyedHashPrimary
} from "../../../lib/security/field-encryption";
import type { CrmLeadsRings } from "../domain/crm-leads-config";
import { maskIdentifierValue } from "../../profile-identity/domain/identifier";
import {
  CONTACT_POINT_AAD_PURPOSE,
  CRM_LEAD_ASSIGNED_EVENT_TYPE,
  CRM_LEAD_CREATED_EVENT_TYPE,
  MAX_CANDIDATES,
  contactPointHashPurpose,
  type ContactPointKind,
  type LeadStatus,
  type SourceKind,
  type StageCategory
} from "../domain/crm-leads-constants";
import {
  buildLeadAssignedPayload,
  buildLeadCreatedPayload
} from "../domain/crm-leads-events";
import type {
  AssignLeadInput,
  ContactPointInput,
  CreateLeadInput,
  LookupInput,
  SourceInput,
  UpdateLeadInput
} from "../domain/crm-leads-validation";
import {
  appendLeadTransition,
  emitLeadEvent,
  type EmitContext
} from "./lead-events";
import { fetchPipeline } from "./pipeline-directory";

type Sql = Bun.SQL;

export type ContactPointView = {
  id: string;
  kind: ContactPointKind;
  platform: string | null;
  masked: string | null;
  createdAt: string;
  revokedAt: string | null;
  erased: boolean;
};

export type LeadView = {
  id: string;
  pipelineId: string;
  revisionId: string;
  stageKey: string;
  stageCategory: StageCategory;
  stageEnteredAt: string;
  displayName: string | null;
  ownerTenantUserId: string | null;
  status: LeadStatus;
  mergedIntoLeadId: string | null;
  externalCustomerRef: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  anonymizedAt: string | null;
  contactPoints: ContactPointView[];
};

type LeadRow = {
  id: string;
  pipeline_id: string;
  revision_id: string;
  stage_key: string;
  stage_category: StageCategory;
  stage_entered_at: Date;
  display_name: string | null;
  owner_tenant_user_id: string | null;
  status: LeadStatus;
  merged_into_lead_id: string | null;
  external_customer_ref: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  anonymized_at: Date | null;
};

export type LeadRecord = Omit<LeadView, "contactPoints">;

function toLead(row: LeadRow): LeadRecord {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    revisionId: row.revision_id,
    stageKey: row.stage_key,
    stageCategory: row.stage_category,
    stageEnteredAt: row.stage_entered_at.toISOString(),
    displayName: row.display_name,
    ownerTenantUserId: row.owner_tenant_user_id,
    status: row.status,
    mergedIntoLeadId: row.merged_into_lead_id,
    externalCustomerRef: row.external_customer_ref,
    version: Number(row.version),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null,
    anonymizedAt: row.anonymized_at?.toISOString() ?? null
  };
}

/** Reads one lead. `update` locks it; the caller must already hold the pipeline row (lock order). */
export async function readLead(
  tx: Sql,
  tenantId: string,
  leadId: string,
  lock: "none" | "update" = "none"
): Promise<LeadRecord | null> {
  const rows = (
    lock === "update"
      ? await tx`
          SELECT id, pipeline_id, revision_id, stage_key, stage_category,
                 stage_entered_at, display_name, owner_tenant_user_id, status,
                 merged_into_lead_id, external_customer_ref, version, created_at,
                 updated_at, deleted_at, anonymized_at
          FROM awcms_crm_leads
          WHERE tenant_id = ${tenantId} AND id = ${leadId}
          FOR UPDATE`
      : await tx`
          SELECT id, pipeline_id, revision_id, stage_key, stage_category,
                 stage_entered_at, display_name, owner_tenant_user_id, status,
                 merged_into_lead_id, external_customer_ref, version, created_at,
                 updated_at, deleted_at, anonymized_at
          FROM awcms_crm_leads
          WHERE tenant_id = ${tenantId} AND id = ${leadId}`
  ) as LeadRow[];

  return rows[0] ? toLead(rows[0]) : null;
}

/**
 * Locks a lead in the module's lock order: its PIPELINE row (shared) first,
 * then the lead (update). The pipeline id is immutable (sql/344), so the
 * unlocked first read cannot be stale about it.
 */
export async function lockLead(
  tx: Sql,
  tenantId: string,
  leadId: string
): Promise<LeadRecord | null> {
  const probe = (await tx`
    SELECT pipeline_id FROM awcms_crm_leads
    WHERE tenant_id = ${tenantId} AND id = ${leadId}
  `) as { pipeline_id: string }[];

  if (!probe[0]) return null;

  await tx`
    SELECT 1 FROM awcms_crm_pipelines
    WHERE tenant_id = ${tenantId} AND id = ${probe[0].pipeline_id}
    FOR SHARE
  `;

  return readLead(tx, tenantId, leadId, "update");
}

async function contactPointsFor(
  tx: Sql,
  tenantId: string,
  leadIds: string[]
): Promise<Map<string, ContactPointView[]>> {
  const out = new Map<string, ContactPointView[]>();

  if (leadIds.length === 0) return out;

  const rows = (await tx`
    SELECT id, lead_id, kind, platform, value_masked, created_at, revoked_at,
           erased_at
    FROM awcms_crm_lead_contact_points
    WHERE tenant_id = ${tenantId}
      AND lead_id = ANY(${tx.array(leadIds, "uuid")})
    ORDER BY created_at, id
  `) as {
    id: string;
    lead_id: string;
    kind: ContactPointKind;
    platform: string | null;
    value_masked: string | null;
    created_at: Date;
    revoked_at: Date | null;
    erased_at: Date | null;
  }[];

  for (const row of rows) {
    const list = out.get(row.lead_id) ?? [];
    list.push({
      id: row.id,
      kind: row.kind,
      platform: row.platform,
      masked: row.value_masked,
      createdAt: row.created_at.toISOString(),
      revokedAt: row.revoked_at?.toISOString() ?? null,
      erased: row.erased_at !== null
    });
    out.set(row.lead_id, list);
  }

  return out;
}

function hashDomain(
  tenantId: string,
  kind: ContactPointKind,
  platform: string | null
) {
  return { purpose: contactPointHashPurpose(kind, platform), tenantId };
}

/** Masked display form. An email keeps its domain; everything else keeps a short tail. */
function maskContact(point: ContactPointInput): string {
  return point.kind === "email"
    ? maskIdentifierValue(point.normalized, "email")
    : maskIdentifierValue(point.normalized, "other");
}

async function insertContactPoints(
  tx: Sql,
  tenantId: string,
  leadId: string,
  actor: string,
  points: ContactPointInput[],
  rings: CrmLeadsRings
): Promise<number> {
  let inserted = 0;

  for (const point of points) {
    const id = randomUUID();
    // Two rings (ADR-0137 section 3): the HMAC key never protects a ciphertext.
    const valueHash = keyedHashPrimary(
      point.normalized,
      hashDomain(tenantId, point.kind, point.platform),
      rings.hash
    );
    const ciphertext = encryptField(
      point.normalized,
      { purpose: CONTACT_POINT_AAD_PURPOSE, tenantId, rowId: id },
      rings.encryption
    );
    const rows = (await tx`
      INSERT INTO awcms_crm_lead_contact_points
        (id, tenant_id, lead_id, kind, platform, value_encrypted, value_hash,
         value_masked, created_by)
      VALUES (${id}, ${tenantId}, ${leadId}, ${point.kind}, ${point.platform},
              ${ciphertext}, ${valueHash}, ${maskContact(point)}, ${actor})
      ON CONFLICT (tenant_id, lead_id, value_hash)
        WHERE value_hash IS NOT NULL AND revoked_at IS NULL
        DO NOTHING
      RETURNING id
    `) as { id: string }[];

    inserted += rows.length;
  }

  return inserted;
}

/** True when the tenant user exists, belongs to this tenant and is active. */
export async function isAssignableUser(
  tx: Sql,
  tenantId: string,
  tenantUserId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT 1 AS present
    FROM awcms_tenant_users
    WHERE tenant_id = ${tenantId} AND id = ${tenantUserId}
      AND status = 'active'
  `) as { present: number }[];

  return rows.length > 0;
}

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/** Serialises concurrent deliveries of one intake key for the rest of the transaction. */
async function lockIntakeKey(
  tx: Sql,
  tenantId: string,
  source: SourceInput
): Promise<void> {
  await tx`
    SELECT pg_advisory_xact_lock(hashtextextended(${`crm_leads:intake:${tenantId}:${source.kind}:${source.channelAccountId ?? NIL_UUID}:${source.externalEventId}`}, 0))
  `;
}

async function findTouchByIntakeKey(
  tx: Sql,
  tenantId: string,
  source: SourceInput
): Promise<{ leadId: string; touchId: string } | null> {
  const rows = (await tx`
    SELECT lead_id, id
    FROM awcms_crm_lead_source_touches
    WHERE tenant_id = ${tenantId}
      AND source_kind = ${source.kind}
      AND COALESCE(channel_account_id, ${NIL_UUID}::uuid)
          = COALESCE(${source.channelAccountId}::uuid, ${NIL_UUID}::uuid)
      AND external_event_id = ${source.externalEventId}
  `) as { lead_id: string; id: string }[];

  return rows[0] ? { leadId: rows[0].lead_id, touchId: rows[0].id } : null;
}

async function insertTouch(
  tx: Sql,
  tenantId: string,
  leadId: string,
  actor: string,
  source: SourceInput
): Promise<{ id: string; touchNumber: number }> {
  const rows = (await tx`
    INSERT INTO awcms_crm_lead_source_touches
      (tenant_id, lead_id, touch_number, source_kind, channel_account_id,
       external_event_id, campaign_ref, utm_source, utm_medium, utm_campaign,
       landing_path, referrer_host, legal_basis, occurred_at, recorded_by)
    SELECT ${tenantId}, ${leadId}, COALESCE(MAX(touch_number), 0) + 1,
           ${source.kind}, ${source.channelAccountId}, ${source.externalEventId},
           ${source.campaignRef}, ${source.utmSource}, ${source.utmMedium},
           ${source.utmCampaign}, ${source.landingPath}, ${source.referrerHost},
           ${source.legalBasis}, ${source.occurredAt}, ${actor}
    FROM awcms_crm_lead_source_touches
    WHERE tenant_id = ${tenantId} AND lead_id = ${leadId}
    RETURNING id, touch_number
  `) as { id: string; touch_number: number }[];

  return { id: rows[0]!.id, touchNumber: Number(rows[0]!.touch_number) };
}

export type CreateLeadResult =
  | { outcome: "created"; lead: LeadView }
  | { outcome: "duplicate"; leadId: string }
  | { outcome: "pipeline_not_found" }
  | { outcome: "pipeline_archived" }
  | { outcome: "owner_not_found" };

export async function createLead(
  tx: Sql,
  tenantId: string,
  actor: string,
  input: CreateLeadInput,
  rings: CrmLeadsRings,
  emit: EmitContext
): Promise<CreateLeadResult> {
  if (input.source.externalEventId) {
    await lockIntakeKey(tx, tenantId, input.source);
    const existing = await findTouchByIntakeKey(tx, tenantId, input.source);

    // A replay answers the lead's ID only: the caller holds `leads.create`,
    // which is not a right to read whatever lead the source key resolves to.
    if (existing) return { outcome: "duplicate", leadId: existing.leadId };
  }

  const pipeline = await fetchPipeline(tx, tenantId, input.pipelineId, "share");

  if (!pipeline) return { outcome: "pipeline_not_found" };
  if (pipeline.status !== "active") return { outcome: "pipeline_archived" };

  if (
    input.ownerTenantUserId &&
    !(await isAssignableUser(tx, tenantId, input.ownerTenantUserId))
  ) {
    return { outcome: "owner_not_found" };
  }

  const revision = pipeline.currentRevision;
  const initial = revision.stages.find(
    (stage) => stage.key === revision.initialStageKey
  )!;
  const leadId = randomUUID();
  const now = new Date();

  await tx`
    INSERT INTO awcms_crm_leads
      (id, tenant_id, pipeline_id, revision_id, stage_key, stage_category,
       display_name, owner_tenant_user_id, created_by, updated_by)
    VALUES (${leadId}, ${tenantId}, ${pipeline.id}, ${revision.id},
            ${initial.key}, ${initial.category}, ${input.displayName},
            ${input.ownerTenantUserId}, ${actor}, ${actor})
  `;

  await insertContactPoints(
    tx,
    tenantId,
    leadId,
    actor,
    input.contactPoints,
    rings
  );

  const touch = await insertTouch(tx, tenantId, leadId, actor, input.source);

  await appendLeadTransition(tx, tenantId, emit, {
    leadId,
    kind: "created",
    pipelineId: pipeline.id,
    revisionId: revision.id,
    fromStageKey: null,
    fromCategory: null,
    toStageKey: initial.key,
    toCategory: initial.category,
    reason: null,
    actor,
    occurredAt: input.source.occurredAt,
    idempotencyKey: emit.idempotencyKey ?? null
  });

  if (input.ownerTenantUserId) {
    await tx`
      INSERT INTO awcms_crm_lead_assignments
        (tenant_id, lead_id, from_owner_tenant_user_id, to_owner_tenant_user_id,
         assigned_by)
      VALUES (${tenantId}, ${leadId}, NULL, ${input.ownerTenantUserId}, ${actor})
    `;
  }

  const kinds = [
    ...new Set(input.contactPoints.map((point) => point.kind))
  ].sort() as ContactPointKind[];

  await emitLeadEvent(tx, tenantId, emit, {
    eventType: CRM_LEAD_CREATED_EVENT_TYPE,
    aggregateId: leadId,
    payload: buildLeadCreatedPayload({
      leadId,
      pipelineId: pipeline.id,
      revisionId: revision.id,
      stageKey: initial.key,
      stageCategory: initial.category,
      touchId: touch.id,
      sourceKind: input.source.kind as SourceKind,
      channelAccountId: input.source.channelAccountId,
      campaignRef: input.source.campaignRef,
      contactPointKinds: kinds,
      ownerTenantUserId: input.ownerTenantUserId ?? null,
      occurredAt: input.source.occurredAt,
      recordedAt: now
    })
  });

  const lead = await fetchLeadView(tx, tenantId, leadId);

  return { outcome: "created", lead: lead! };
}

export async function fetchLeadView(
  tx: Sql,
  tenantId: string,
  leadId: string
): Promise<LeadView | null> {
  const lead = await readLead(tx, tenantId, leadId);

  if (!lead) return null;

  const points = await contactPointsFor(tx, tenantId, [leadId]);

  return { ...lead, contactPoints: points.get(leadId) ?? [] };
}

export type LeadListFilter = {
  pipelineId: string | null;
  stageCategory: StageCategory | null;
  ownerTenantUserId: string | null;
  includeDeleted: boolean;
  cursor: { createdAt: string; id: string } | null;
  limit: number;
};

/** Keyset page, newest first, live rows unless asked. Masked contact points only. */
export async function listLeads(
  tx: Sql,
  tenantId: string,
  filter: LeadListFilter
): Promise<{
  items: LeadView[];
  nextCursor: { createdAt: string; id: string } | null;
}> {
  const rows = (await tx`
    SELECT id, pipeline_id, revision_id, stage_key, stage_category,
           stage_entered_at, display_name, owner_tenant_user_id, status,
           merged_into_lead_id, external_customer_ref, version, created_at,
           updated_at, deleted_at, anonymized_at
    FROM awcms_crm_leads
    WHERE tenant_id = ${tenantId}
      AND (${filter.includeDeleted}::boolean OR deleted_at IS NULL)
      AND (${filter.pipelineId}::uuid IS NULL OR pipeline_id = ${filter.pipelineId}::uuid)
      AND (${filter.stageCategory}::text IS NULL OR stage_category = ${filter.stageCategory}::text)
      AND (${filter.ownerTenantUserId}::uuid IS NULL
           OR owner_tenant_user_id = ${filter.ownerTenantUserId}::uuid)
      AND (${filter.cursor?.createdAt ?? null}::timestamptz IS NULL
           OR (created_at, id) < (${filter.cursor?.createdAt ?? null}::timestamptz,
                                  ${filter.cursor?.id ?? null}::uuid))
    ORDER BY created_at DESC, id DESC
    LIMIT ${filter.limit + 1}
  `) as LeadRow[];
  const page = rows.slice(0, filter.limit);
  const points = await contactPointsFor(
    tx,
    tenantId,
    page.map((row) => row.id)
  );
  const last = page[page.length - 1];

  return {
    items: page.map((row) => ({
      ...toLead(row),
      contactPoints: points.get(row.id) ?? []
    })),
    nextCursor:
      rows.length > filter.limit && last
        ? { createdAt: last.created_at.toISOString(), id: last.id }
        : null
  };
}

export type LeadHistory = {
  touches: Record<string, unknown>[];
  transitions: Record<string, unknown>[];
  assignments: Record<string, unknown>[];
  conversions: Record<string, unknown>[];
  merges: Record<string, unknown>[];
};

/**
 * The lead's history. Free-text reasons and notes are returned to an
 * authorised reader (they are the tenant's own working notes); they never
 * appear in an event or an audit row.
 */
export async function fetchLeadHistory(
  tx: Sql,
  tenantId: string,
  leadId: string
): Promise<LeadHistory> {
  const touches = (await tx`
    SELECT id, touch_number, source_kind, channel_account_id, external_event_id,
           campaign_ref, utm_source, utm_medium, utm_campaign, landing_path,
           referrer_host, legal_basis, occurred_at, recorded_at
    FROM awcms_crm_lead_source_touches
    WHERE tenant_id = ${tenantId} AND lead_id = ${leadId}
    ORDER BY touch_number
  `) as Record<string, unknown>[];
  const transitions = (await tx`
    SELECT id, sequence, kind, revision_id, from_stage_key, to_stage_key,
           from_category, to_category, reason, actor_tenant_user_id,
           occurred_at, recorded_at, corrects_transition_id
    FROM awcms_crm_lead_transitions
    WHERE tenant_id = ${tenantId} AND lead_id = ${leadId}
    ORDER BY sequence
  `) as Record<string, unknown>[];
  const assignments = (await tx`
    SELECT id, from_owner_tenant_user_id, to_owner_tenant_user_id, assigned_by,
           assigned_at
    FROM awcms_crm_lead_assignments
    WHERE tenant_id = ${tenantId} AND lead_id = ${leadId}
    ORDER BY assigned_at, id
  `) as Record<string, unknown>[];
  const conversions = (await tx`
    SELECT id, mode, external_customer_ref, evidence_ref, note, occurred_at,
           recorded_at, recorded_by, reversed_at, reversal_evidence_ref,
           reversal_occurred_at, reversed_by
    FROM awcms_crm_lead_conversions
    WHERE tenant_id = ${tenantId} AND lead_id = ${leadId}
    ORDER BY recorded_at, id
  `) as Record<string, unknown>[];
  const merges = (await tx`
    SELECT id, survivor_lead_id, absorbed_lead_id, merged_by, merged_at,
           undo_until, reverted_at, reverted_by
    FROM awcms_crm_lead_merges
    WHERE tenant_id = ${tenantId}
      AND (survivor_lead_id = ${leadId} OR absorbed_lead_id = ${leadId})
    ORDER BY merged_at, id
  `) as Record<string, unknown>[];

  return {
    touches: touches.map(camelize),
    transitions: transitions.map(camelize),
    assignments: assignments.map(camelize),
    conversions: conversions.map(camelize),
    merges: merges.map(camelize)
  };
}

function camelize(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    out[camel] =
      value instanceof Date
        ? value.toISOString()
        : typeof value === "bigint"
          ? Number(value)
          : value;
  }

  return out;
}

export type LeadWriteRefusal =
  | { outcome: "not_found" }
  | { outcome: "version_conflict"; currentVersion: number }
  | { outcome: "not_open"; status: LeadStatus | "deleted" };

/** The shared preconditions of a write to a lead the caller has locked. */
export function writeRefusal(
  lead: LeadRecord | null,
  expectedVersion: number | null
): LeadWriteRefusal | null {
  if (!lead) return { outcome: "not_found" };
  if (lead.deletedAt) return { outcome: "not_open", status: "deleted" };
  if (lead.status !== "open")
    return { outcome: "not_open", status: lead.status };

  if (expectedVersion !== null && lead.version !== expectedVersion) {
    return { outcome: "version_conflict", currentVersion: lead.version };
  }

  return null;
}

export type UpdateLeadResult =
  | { outcome: "updated"; lead: LeadView; changed: string[] }
  | LeadWriteRefusal
  | { outcome: "contact_point_not_found" };

export async function updateLead(
  tx: Sql,
  tenantId: string,
  actor: string,
  leadId: string,
  input: UpdateLeadInput,
  rings: CrmLeadsRings
): Promise<UpdateLeadResult> {
  const lead = await lockLead(tx, tenantId, leadId);
  const refused = writeRefusal(lead, input.expectedVersion);

  if (refused) return refused;

  if (input.revokeContactPointIds.length > 0) {
    const live = (await tx`
      SELECT id FROM awcms_crm_lead_contact_points
      WHERE tenant_id = ${tenantId} AND lead_id = ${leadId}
        AND id = ANY(${tx.array(input.revokeContactPointIds, "uuid")})
        AND revoked_at IS NULL AND erased_at IS NULL
    `) as { id: string }[];

    if (live.length !== input.revokeContactPointIds.length) {
      return { outcome: "contact_point_not_found" };
    }
  }

  const changed: string[] = [];

  if (input.displayName !== undefined) {
    await tx`
      UPDATE awcms_crm_leads SET display_name = ${input.displayName}
      WHERE tenant_id = ${tenantId} AND id = ${leadId}
    `;
    changed.push("displayName");
  }

  if (input.revokeContactPointIds.length > 0) {
    await tx`
      UPDATE awcms_crm_lead_contact_points SET revoked_at = now()
      WHERE tenant_id = ${tenantId} AND lead_id = ${leadId}
        AND id = ANY(${tx.array(input.revokeContactPointIds, "uuid")})
    `;
    changed.push("revokeContactPointIds");
  }

  if (input.addContactPoints.length > 0) {
    await insertContactPoints(
      tx,
      tenantId,
      leadId,
      actor,
      input.addContactPoints,
      rings
    );
    changed.push("addContactPoints");
  }

  await tx`
    UPDATE awcms_crm_leads
    SET version = version + 1, updated_at = now(), updated_by = ${actor}
    WHERE tenant_id = ${tenantId} AND id = ${leadId}
  `;

  return {
    outcome: "updated",
    lead: (await fetchLeadView(tx, tenantId, leadId))!,
    changed
  };
}

export type AddTouchResult =
  | { outcome: "added"; touchId: string; touchNumber: number }
  | { outcome: "duplicate"; touchId: string }
  | { outcome: "key_used_by_other_lead" }
  | LeadWriteRefusal;

/**
 * A later touch (ADR-0153 section 4): appended, never replacing the first. A
 * replay of the same source key on the same lead answers the existing touch; the
 * same key already attributed to ANOTHER lead is a conflict (deciding that two
 * leads are one person is a merge, never a side effect of a touch).
 */
export async function addTouch(
  tx: Sql,
  tenantId: string,
  actor: string,
  leadId: string,
  source: SourceInput
): Promise<AddTouchResult> {
  const lead = await lockLead(tx, tenantId, leadId);
  const refused = writeRefusal(lead, null);

  if (refused) return refused;

  if (source.externalEventId) {
    await lockIntakeKey(tx, tenantId, source);
    const existing = await findTouchByIntakeKey(tx, tenantId, source);

    if (existing) {
      return existing.leadId === leadId
        ? { outcome: "duplicate", touchId: existing.touchId }
        : { outcome: "key_used_by_other_lead" };
    }
  }

  const touch = await insertTouch(tx, tenantId, leadId, actor, source);

  await tx`
    UPDATE awcms_crm_leads
    SET version = version + 1, updated_at = now(), updated_by = ${actor}
    WHERE tenant_id = ${tenantId} AND id = ${leadId}
  `;

  return {
    outcome: "added",
    touchId: touch.id,
    touchNumber: touch.touchNumber
  };
}

export type AssignLeadResult =
  | {
      outcome: "assigned";
      lead: LeadView;
      from: string | null;
      to: string | null;
    }
  | { outcome: "unchanged"; lead: LeadView }
  | { outcome: "owner_not_found" }
  | LeadWriteRefusal;

export async function assignLead(
  tx: Sql,
  tenantId: string,
  actor: string,
  leadId: string,
  input: AssignLeadInput,
  emit: EmitContext
): Promise<AssignLeadResult> {
  const lead = await lockLead(tx, tenantId, leadId);
  const refused = writeRefusal(lead, input.expectedVersion);

  if (refused) return refused;

  if (lead!.ownerTenantUserId === input.ownerTenantUserId) {
    return {
      outcome: "unchanged",
      lead: (await fetchLeadView(tx, tenantId, leadId))!
    };
  }

  if (
    input.ownerTenantUserId &&
    !(await isAssignableUser(tx, tenantId, input.ownerTenantUserId))
  ) {
    return { outcome: "owner_not_found" };
  }

  const now = new Date();

  await tx`
    UPDATE awcms_crm_leads
    SET owner_tenant_user_id = ${input.ownerTenantUserId},
        version = version + 1, updated_at = now(), updated_by = ${actor}
    WHERE tenant_id = ${tenantId} AND id = ${leadId}
  `;
  await tx`
    INSERT INTO awcms_crm_lead_assignments
      (tenant_id, lead_id, from_owner_tenant_user_id, to_owner_tenant_user_id,
       assigned_by)
    VALUES (${tenantId}, ${leadId}, ${lead!.ownerTenantUserId},
            ${input.ownerTenantUserId}, ${actor})
  `;
  await emitLeadEvent(tx, tenantId, emit, {
    eventType: CRM_LEAD_ASSIGNED_EVENT_TYPE,
    aggregateId: leadId,
    payload: buildLeadAssignedPayload({
      leadId,
      fromOwnerTenantUserId: lead!.ownerTenantUserId,
      toOwnerTenantUserId: input.ownerTenantUserId,
      assignedAt: now
    })
  });

  return {
    outcome: "assigned",
    lead: (await fetchLeadView(tx, tenantId, leadId))!,
    from: lead!.ownerTenantUserId,
    to: input.ownerTenantUserId
  };
}

export type CandidateView = {
  leadId: string;
  status: LeadStatus;
  stageCategory: StageCategory;
  matchedKinds: ContactPointKind[];
};

/**
 * Identity CANDIDATES for a lead (ADR-0153 section 5): other live leads of THIS
 * tenant sharing an exact keyed hash with one of its live contact points. The
 * hash domain is per tenant and per kind, so another tenant's lead with the
 * same address has a different hash and is never found (T-I1), and an email is
 * never matched to a phone or a platform id. A candidate is never a merge.
 */
export async function findCandidates(
  tx: Sql,
  tenantId: string,
  leadId: string
): Promise<CandidateView[]> {
  const rows = (await tx`
    SELECT other.lead_id, l.status, l.stage_category,
           array_agg(DISTINCT other.kind ORDER BY other.kind) AS kinds
    FROM awcms_crm_lead_contact_points mine
    JOIN awcms_crm_lead_contact_points other
      ON other.tenant_id = mine.tenant_id
     AND other.value_hash = mine.value_hash
     AND other.lead_id <> mine.lead_id
     AND other.revoked_at IS NULL
    JOIN awcms_crm_leads l
      ON l.tenant_id = other.tenant_id AND l.id = other.lead_id
    WHERE mine.tenant_id = ${tenantId}
      AND mine.lead_id = ${leadId}
      AND mine.value_hash IS NOT NULL
      AND mine.revoked_at IS NULL
      AND l.deleted_at IS NULL
      AND l.status = 'open'
    GROUP BY other.lead_id, l.status, l.stage_category
    ORDER BY other.lead_id
    LIMIT ${MAX_CANDIDATES}
  `) as {
    lead_id: string;
    status: LeadStatus;
    stage_category: StageCategory;
    kinds: ContactPointKind[];
  }[];

  return rows.map((row) => ({
    leadId: row.lead_id,
    status: row.status,
    stageCategory: row.stage_category,
    matchedKinds: [...row.kinds]
  }));
}

/** Exact keyed-hash lookup by a contact value, inside this tenant, against every ring key. */
export async function lookupByContact(
  tx: Sql,
  tenantId: string,
  input: LookupInput,
  rings: CrmLeadsRings
): Promise<{ leadId: string; contactPointId: string }[]> {
  const candidates = keyedHashCandidates(
    input.normalized,
    hashDomain(tenantId, input.kind, input.platform),
    rings.hash
  );
  const rows = (await tx`
    SELECT cp.lead_id, cp.id
    FROM awcms_crm_lead_contact_points cp
    JOIN awcms_crm_leads l ON l.tenant_id = cp.tenant_id AND l.id = cp.lead_id
    WHERE cp.tenant_id = ${tenantId}
      AND cp.value_hash = ANY(${tx.array(candidates, "text")})
      AND cp.revoked_at IS NULL
      AND l.deleted_at IS NULL
    ORDER BY cp.lead_id
    LIMIT ${MAX_CANDIDATES}
  `) as { lead_id: string; id: string }[];

  return rows.map((row) => ({ leadId: row.lead_id, contactPointId: row.id }));
}

export type SoftDeleteResult =
  | { outcome: "deleted" }
  | { outcome: "restored" }
  | { outcome: "not_found" }
  | { outcome: "version_conflict"; currentVersion: number }
  | { outcome: "already_deleted" }
  | { outcome: "not_deleted" };

export async function softDeleteLead(
  tx: Sql,
  tenantId: string,
  actor: string,
  leadId: string,
  expectedVersion: number
): Promise<SoftDeleteResult> {
  const lead = await lockLead(tx, tenantId, leadId);

  if (!lead) return { outcome: "not_found" };
  if (lead.deletedAt) return { outcome: "already_deleted" };
  if (lead.version !== expectedVersion) {
    return { outcome: "version_conflict", currentVersion: lead.version };
  }

  await tx`
    UPDATE awcms_crm_leads
    SET deleted_at = now(), deleted_by = ${actor},
        version = version + 1, updated_at = now(), updated_by = ${actor}
    WHERE tenant_id = ${tenantId} AND id = ${leadId}
  `;

  return { outcome: "deleted" };
}

export async function restoreLead(
  tx: Sql,
  tenantId: string,
  actor: string,
  leadId: string,
  expectedVersion: number
): Promise<SoftDeleteResult> {
  const lead = await lockLead(tx, tenantId, leadId);

  if (!lead) return { outcome: "not_found" };
  if (!lead.deletedAt) return { outcome: "not_deleted" };
  if (lead.version !== expectedVersion) {
    return { outcome: "version_conflict", currentVersion: lead.version };
  }

  await tx`
    UPDATE awcms_crm_leads
    SET deleted_at = NULL, deleted_by = NULL,
        version = version + 1, updated_at = now(), updated_by = ${actor}
    WHERE tenant_id = ${tenantId} AND id = ${leadId}
  `;

  return { outcome: "restored" };
}

export type AnonymizeResult =
  | {
      outcome: "anonymized";
      erasedContactPoints: number;
      survivorOfLeadIds: string[];
    }
  | { outcome: "already_anonymized" }
  | { outcome: "not_found" };

/**
 * Anonymising erasure (ADR-0153 section 7, ADR-0094): the display name, every
 * contact point (ciphertext, hash, masked form) and every free-text reason and
 * note are erased; the lead row, its stage, its source touches, its transition
 * facts and its conversion facts are KEPT, so a reported funnel does not change.
 * A lead this one absorbed by merge keeps its own data and is named in the
 * result, so the controller can erase it too when it is the same person.
 */
export async function anonymizeLead(
  tx: Sql,
  tenantId: string,
  actor: string,
  leadId: string
): Promise<AnonymizeResult> {
  const lead = await lockLead(tx, tenantId, leadId);

  if (!lead) return { outcome: "not_found" };
  if (lead.status === "anonymized") return { outcome: "already_anonymized" };

  const erased = (await tx`
    UPDATE awcms_crm_lead_contact_points
    SET value_encrypted = NULL, value_hash = NULL, value_masked = NULL,
        erased_at = now()
    WHERE tenant_id = ${tenantId} AND lead_id = ${leadId} AND erased_at IS NULL
    RETURNING id
  `) as { id: string }[];

  await tx`
    UPDATE awcms_crm_lead_transitions SET reason = NULL
    WHERE tenant_id = ${tenantId} AND lead_id = ${leadId} AND reason IS NOT NULL
  `;
  await tx`
    UPDATE awcms_crm_lead_conversions SET note = NULL
    WHERE tenant_id = ${tenantId} AND lead_id = ${leadId} AND note IS NOT NULL
  `;
  await tx`
    UPDATE awcms_crm_lead_merges SET note = NULL
    WHERE tenant_id = ${tenantId}
      AND (survivor_lead_id = ${leadId} OR absorbed_lead_id = ${leadId})
      AND note IS NOT NULL
  `;

  // A merged lead keeps its merge pointer only while it is `merged`; erasure
  // ends its participation, so an anonymised lead is never a rollback target.
  await tx`
    UPDATE awcms_crm_leads
    SET display_name = NULL,
        status = 'anonymized',
        merged_into_lead_id = NULL,
        anonymized_at = now(),
        version = version + 1, updated_at = now(), updated_by = ${actor}
    WHERE tenant_id = ${tenantId} AND id = ${leadId}
  `;

  const absorbed = (await tx`
    SELECT absorbed_lead_id FROM awcms_crm_lead_merges
    WHERE tenant_id = ${tenantId} AND survivor_lead_id = ${leadId}
      AND reverted_at IS NULL
    ORDER BY absorbed_lead_id
  `) as { absorbed_lead_id: string }[];

  return {
    outcome: "anonymized",
    erasedContactPoints: erased.length,
    survivorOfLeadIds: absorbed.map((row) => row.absorbed_lead_id)
  };
}
