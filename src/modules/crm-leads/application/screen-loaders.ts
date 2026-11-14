/**
 * What the three `/admin/crm-leads` screens read, as functions (Issue #1166,
 * ADR-0153, ADR-0149).
 *
 * The screens do not chain directory calls inline in `.astro` frontmatter,
 * where the only test is a source-text match: a refactor that kept the CALL
 * but widened the question (a tenant id taken from the URL, a soft-deleted
 * lead included, a contact point un-masked) would stay green. The chain lives
 * here so a behavioural integration test runs the SAME code as a real viewer.
 *
 * Authorization of the entry itself stays with `loadAdminScreen`; these run
 * only after it allowed the page. Each affordance (move, assign, switch) is
 * decided by the `can()` chokepoint of the render, never by an inline check.
 *
 * Deliberate bounds:
 *
 *   - Every read is for `tenantId` of the access context; no id from the URL
 *     reaches a query without it, and an unknown id and another tenant's id
 *     give the same answer (`found: false`).
 *   - Soft-deleted, merged and anonymised leads are not LISTED (the list asks
 *     for live, open leads; the API, unlike the screen, also returns merged
 *     and anonymised ones). The DETAIL of a live merged or anonymised lead is
 *     still reachable by its id, read-only: the endpoints refuse every write on
 *     it (`LEAD_NOT_OPEN`).
 *   - The detail never carries `externalCustomerRef`: no screen shows it, so
 *     the page does not receive it.
 *   - Contact points are the MASKED view the API returns, never the value.
 *   - The settings screen loads ONE pipeline's catalogue (the selected one),
 *     so the number of queries does not grow with the number of pipelines.
 */
import type { AccessRequest } from "../../identity-access/domain/access-control";
import {
  isCrmLeadsEnabled,
  STAGE_CATEGORIES,
  type StageCategory
} from "../domain/crm-leads-constants";
import {
  fetchLeadHistory,
  fetchLeadView,
  listLeads,
  type LeadHistory,
  type LeadView
} from "./lead-directory";
import {
  fetchPipeline,
  listPipelines,
  type PipelineView,
  type RevisionView
} from "./pipeline-directory";
import { fetchSettings, type CrmLeadsSettings } from "./settings-directory";

type Sql = Bun.SQL;

/** The pieces of `loadAdminScreen`'s access context these loaders need. */
export type CrmLeadsScreenContext = {
  tx: Sql;
  tenantId: string;
  /** The viewer's own tenant-user id (for "you"). */
  me: string;
};

/** `can()` of `loadAdminScreen`: the chokepoint, one boolean per probe. */
export type CrmLeadsCan = (guard: AccessRequest) => Promise<boolean>;

/** Two keyset pages of the API's own query: the bound of what the list loads. */
export const LOAD_PAGE_SIZE = 100;
export const LOAD_PAGE_LIMIT = 2;

export type LeadListFilters = {
  pipeline?: string | null;
  category?: string | null;
  owner?: string | null;
  source?: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A UUID the URL carries, lower-cased; anything else is no filter at all. */
export function uuidOrNull(value: string | null | undefined): string | null {
  return typeof value === "string" && UUID.test(value)
    ? value.toLowerCase()
    : null;
}

/** The URL's stage category as the API's closed list; an unknown value is dropped. */
export function categoryOrNull(
  value: string | null | undefined
): StageCategory | null {
  return typeof value === "string" &&
    (STAGE_CATEGORIES as readonly string[]).includes(value)
    ? (value as StageCategory)
    : null;
}

export type LeadListRow = LeadView & {
  /** The kind of the FIRST source touch (immutable), or `null` if none is recorded. */
  sourceKind: string | null;
};

export type LeadListData = {
  enabled: boolean;
  tenantEnabled: boolean;
  leads: LeadListRow[];
  more: boolean;
  pipelines: PipelineView[];
  me: string;
  canConfigure: boolean;
};

/** The first source touch's kind per lead: one query for the whole page, never one per row. */
async function firstSourceKinds(
  tx: Sql,
  tenantId: string,
  leadIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();

  if (leadIds.length === 0) return out;

  const rows = (await tx`
    SELECT lead_id, source_kind
    FROM awcms_crm_lead_source_touches
    WHERE tenant_id = ${tenantId}
      AND touch_number = 1
      AND lead_id = ANY(${tx.array(leadIds, "uuid")})
  `) as { lead_id: string; source_kind: string }[];

  for (const row of rows) out.set(row.lead_id, row.source_kind);

  return out;
}

export async function loadLeadList(input: {
  context: CrmLeadsScreenContext;
  filters: LeadListFilters;
  configureGuard: AccessRequest;
  can: CrmLeadsCan;
}): Promise<LeadListData> {
  const { context, filters, can } = input;
  const { tx, tenantId, me } = context;

  // Checked AFTER the screen's authorization, so an unauthorised caller learns
  // nothing about the switch.
  if (!isCrmLeadsEnabled()) {
    return {
      enabled: false,
      tenantEnabled: false,
      leads: [],
      more: false,
      pipelines: [],
      me,
      canConfigure: false
    };
  }

  const pipelineId = uuidOrNull(filters.pipeline);
  const stageCategory = categoryOrNull(filters.category);
  const ownerTenantUserId = filters.owner === "me" ? me : null;
  // One awaited query at a time: `tx` is one connection.
  const leads: LeadView[] = [];
  let cursor: { createdAt: string; id: string } | null = null;
  let more = false;

  for (let page = 0; page < LOAD_PAGE_LIMIT; page += 1) {
    const result = await listLeads(tx, tenantId, {
      pipelineId,
      stageCategory,
      ownerTenantUserId,
      includeDeleted: false,
      openOnly: true,
      cursor,
      limit: LOAD_PAGE_SIZE
    });

    leads.push(...result.items);

    if (result.nextCursor === null) break;

    cursor = result.nextCursor;
    more = page === LOAD_PAGE_LIMIT - 1;
  }

  const sources = await firstSourceKinds(
    tx,
    tenantId,
    leads.map((lead) => lead.id)
  );

  return {
    enabled: true,
    tenantEnabled: (await fetchSettings(tx, tenantId)).enabled,
    leads: leads.map((lead) => ({
      ...lead,
      sourceKind: sources.get(lead.id) ?? null
    })),
    more,
    pipelines: await listPipelines(tx, tenantId),
    me,
    canConfigure: await can(input.configureGuard)
  };
}

export type LeadDetailData =
  | { enabled: false }
  | { enabled: true; found: false }
  | {
      enabled: true;
      found: true;
      tenantEnabled: boolean;
      lead: Omit<LeadView, "externalCustomerRef">;
      history: LeadHistory;
      pipeline: PipelineView;
      revision: RevisionView;
      me: string;
      canMove: boolean;
      canAssign: boolean;
    };

export async function loadLeadDetail(input: {
  context: CrmLeadsScreenContext;
  leadId: string | null;
  moveGuard: AccessRequest;
  assignGuard: AccessRequest;
  can: CrmLeadsCan;
}): Promise<LeadDetailData> {
  const { context, leadId, can } = input;
  const { tx, tenantId, me } = context;

  if (!isCrmLeadsEnabled()) return { enabled: false };

  if (leadId === null) return { enabled: true, found: false };

  const lead = await fetchLeadView(tx, tenantId, leadId);

  // A lead of another tenant, an unknown id and a soft-deleted lead are one
  // answer: the screen lists live leads only.
  if (!lead || lead.deletedAt !== null) return { enabled: true, found: false };

  const pipeline = await fetchPipeline(tx, tenantId, lead.pipelineId);

  if (!pipeline) return { enabled: true, found: false };

  const { currentRevision, ...pipelineView } = pipeline;
  // No screen shows the downstream customer reference; do not hand it over.
  const { externalCustomerRef: _omitted, ...leadView } = lead;

  return {
    enabled: true,
    found: true,
    tenantEnabled: (await fetchSettings(tx, tenantId)).enabled,
    lead: leadView,
    history: await fetchLeadHistory(tx, tenantId, leadId),
    pipeline: pipelineView,
    revision: currentRevision,
    me,
    canMove: await can(input.moveGuard),
    canAssign: await can(input.assignGuard)
  };
}

export type CrmSettingsData = {
  enabled: boolean;
  /** `null` when the deployment switch is off: nothing is read. */
  settings: CrmLeadsSettings | null;
  pipelines: PipelineView[];
  /** The pipeline whose catalogue is shown (the one in the URL, else the first). */
  selected: (PipelineView & { currentRevision: RevisionView }) | null;
};

/**
 * The settings screen's entry IS `pipelines.configure` (the permission of every
 * write on it), so there is no second `can()` probe here: it would only write a
 * second decision-log row for the decision the entry already made.
 */
export async function loadCrmSettings(input: {
  context: CrmLeadsScreenContext;
  pipelineId: string | null;
}): Promise<CrmSettingsData> {
  const { tx, tenantId } = input.context;

  if (!isCrmLeadsEnabled()) {
    return { enabled: false, settings: null, pipelines: [], selected: null };
  }

  const pipelines = await listPipelines(tx, tenantId);
  const wanted =
    pipelines.find((pipeline) => pipeline.id === input.pipelineId) ??
    pipelines[0] ??
    null;

  return {
    enabled: true,
    settings: await fetchSettings(tx, tenantId),
    pipelines,
    selected: wanted ? await fetchPipeline(tx, tenantId, wanted.id) : null
  };
}
