/**
 * What the five WRITE screens of `crm_leads` read, as functions (Issue #1166,
 * ADR-0153): `/admin/crm-leads/new`, `/admin/crm-leads/deleted`,
 * `/admin/crm-leads/{id}/edit`, `/admin/crm-leads/{id}/merge` and
 * `/admin/crm-leads/{id}/conversion`.
 *
 * Same discipline as `screen-loaders.ts`, and for the same reason: the chain
 * lives here, not inline in `.astro` frontmatter, so a behavioural integration
 * test runs the SAME code as a real viewer instead of matching source text.
 * Authorization of the ENTRY stays with `loadAdminScreen`; each affordance
 * beyond it is decided by the `can()` chokepoint of the render.
 *
 * Deliberate bounds, the same as the read screens:
 *
 *   - every read is for `tenantId` of the access context; an unknown id, a
 *     foreign id and (for the screens that act on a LIVE lead) a soft-deleted
 *     id are ONE answer, `found: false`;
 *   - contact points are the MASKED view the API returns, never the value;
 *   - `externalCustomerRef` never reaches a page, and neither does a
 *     conversion's evidence reference: the conversion list is cut down to
 *     `id`, `mode`, `occurredAt` and `reversedAt` here, at the loader, so the
 *     page cannot print what it was never handed;
 *   - the deleted list is the newest {@link DELETED_PAGE_SIZE} rows and says
 *     when there are more, instead of a total it cannot stand behind.
 */
import type { AccessRequest } from "../../identity-access/domain/access-control";
import { isCrmLeadsEnabled } from "../domain/crm-leads-constants";
import {
  fetchLeadHistory,
  fetchLeadView,
  fetchLeadViews,
  findCandidates,
  listDeletedLeads,
  type LeadView
} from "./lead-directory";
import {
  fetchPipeline,
  listPipelines,
  type PipelineView,
  type RevisionView
} from "./pipeline-directory";
import { type CrmLeadsCan, type CrmLeadsScreenContext } from "./screen-loaders";
import { fetchSettings } from "./settings-directory";

/** Rows of the deleted-leads screen: one keyset page of the API's own query. */
export const DELETED_PAGE_SIZE = 100;

/** A lead as a write screen receives it: no downstream customer reference. */
export type ScreenLead = Omit<LeadView, "externalCustomerRef">;

function withoutCustomerRef(lead: LeadView): ScreenLead {
  const { externalCustomerRef: _omitted, ...rest } = lead;

  return rest;
}

// ---- /admin/crm-leads/new -------------------------------------------------

export type LeadCreateData = {
  enabled: boolean;
  tenantEnabled: boolean;
  /** Active pipelines only: an archived one refuses a new lead. */
  pipelines: PipelineView[];
  me: string;
};

export async function loadLeadCreate(input: {
  context: CrmLeadsScreenContext;
}): Promise<LeadCreateData> {
  const { tx, tenantId, me } = input.context;

  if (!isCrmLeadsEnabled()) {
    return { enabled: false, tenantEnabled: false, pipelines: [], me };
  }

  return {
    enabled: true,
    tenantEnabled: (await fetchSettings(tx, tenantId)).enabled,
    pipelines: (await listPipelines(tx, tenantId)).filter(
      (pipeline) => pipeline.status === "active"
    ),
    me
  };
}

// ---- /admin/crm-leads/{id}/edit -------------------------------------------

export type LeadEditData =
  | { enabled: false }
  | { enabled: true; found: false }
  | {
      enabled: true;
      found: true;
      tenantEnabled: boolean;
      lead: ScreenLead;
      canDelete: boolean;
    };

export async function loadLeadEdit(input: {
  context: CrmLeadsScreenContext;
  leadId: string | null;
  deleteGuard: AccessRequest;
  can: CrmLeadsCan;
}): Promise<LeadEditData> {
  const { tx, tenantId } = input.context;

  if (!isCrmLeadsEnabled()) return { enabled: false };

  if (input.leadId === null) return { enabled: true, found: false };

  const lead = await fetchLeadView(tx, tenantId, input.leadId);

  // A foreign id, an unknown id and a deleted lead are one answer.
  if (!lead || lead.deletedAt !== null) return { enabled: true, found: false };

  return {
    enabled: true,
    found: true,
    tenantEnabled: (await fetchSettings(tx, tenantId)).enabled,
    lead: withoutCustomerRef(lead),
    canDelete: await input.can(input.deleteGuard)
  };
}

// ---- /admin/crm-leads/deleted ---------------------------------------------

export type DeletedLeadsData = {
  enabled: boolean;
  tenantEnabled: boolean;
  leads: ScreenLead[];
  /** There are older deleted leads than the {@link DELETED_PAGE_SIZE} shown. */
  more: boolean;
  pipelines: PipelineView[];
};

export async function loadDeletedLeads(input: {
  context: CrmLeadsScreenContext;
}): Promise<DeletedLeadsData> {
  const { tx, tenantId } = input.context;

  if (!isCrmLeadsEnabled()) {
    return {
      enabled: false,
      tenantEnabled: false,
      leads: [],
      more: false,
      pipelines: []
    };
  }

  const page = await listDeletedLeads(tx, tenantId, {
    cursor: null,
    limit: DELETED_PAGE_SIZE
  });

  return {
    enabled: true,
    tenantEnabled: (await fetchSettings(tx, tenantId)).enabled,
    leads: page.items.map(withoutCustomerRef),
    more: page.nextCursor !== null,
    pipelines: await listPipelines(tx, tenantId)
  };
}

// ---- /admin/crm-leads/{id}/merge ------------------------------------------

export type MergeCandidate = {
  lead: ScreenLead;
  /** Which KINDS of contact point matched (never the values). */
  matchedKinds: string[];
  /** A merge needs the same pipeline; another is shown but cannot be chosen. */
  samePipeline: boolean;
};

export type LeadMergeData =
  | { enabled: false }
  | { enabled: true; found: false }
  | {
      enabled: true;
      found: true;
      tenantEnabled: boolean;
      lead: ScreenLead;
      pipelineName: string;
      candidates: MergeCandidate[];
      /** Every merge this lead is part of, oldest first: `id`, survivor, absorbed, `undoUntil`, `revertedAt`. */
      merges: {
        id: string;
        survivorLeadId: string;
        absorbedLeadId: string;
        mergedAt: string;
        undoUntil: string;
        revertedAt: string | null;
      }[];
      mergeUndoHours: number;
      me: string;
    };

export async function loadLeadMerge(input: {
  context: CrmLeadsScreenContext;
  leadId: string | null;
}): Promise<LeadMergeData> {
  const { tx, tenantId, me } = input.context;

  if (!isCrmLeadsEnabled()) return { enabled: false };

  if (input.leadId === null) return { enabled: true, found: false };

  const lead = await fetchLeadView(tx, tenantId, input.leadId);

  if (!lead || lead.deletedAt !== null) return { enabled: true, found: false };

  const settings = await fetchSettings(tx, tenantId);
  const history = await fetchLeadHistory(tx, tenantId, lead.id);
  // Candidates only for a lead that can still be merged: an absorbed or
  // anonymised lead has none to offer.
  const found =
    lead.status === "open" ? await findCandidates(tx, tenantId, lead.id) : [];
  const views = new Map(
    (
      await fetchLeadViews(
        tx,
        tenantId,
        found.map((candidate) => candidate.leadId)
      )
    ).map((view) => [view.id, view])
  );
  const candidates: MergeCandidate[] = [];

  for (const candidate of found) {
    const view = views.get(candidate.leadId);

    if (!view) continue;

    candidates.push({
      lead: withoutCustomerRef(view),
      matchedKinds: candidate.matchedKinds,
      samePipeline: view.pipelineId === lead.pipelineId
    });
  }

  const pipelines = await listPipelines(tx, tenantId);

  return {
    enabled: true,
    found: true,
    tenantEnabled: settings.enabled,
    lead: withoutCustomerRef(lead),
    pipelineName:
      pipelines.find((pipeline) => pipeline.id === lead.pipelineId)?.name ?? "",
    candidates,
    merges: history.merges.map((row) => ({
      id: String(row.id),
      survivorLeadId: String(row.survivorLeadId),
      absorbedLeadId: String(row.absorbedLeadId),
      mergedAt: String(row.mergedAt),
      undoUntil: String(row.undoUntil),
      revertedAt: row.revertedAt === null ? null : String(row.revertedAt)
    })),
    mergeUndoHours: settings.mergeUndoHours,
    me
  };
}

// ---- /admin/crm-leads/{id}/conversion -------------------------------------

export type LeadConversionData =
  | { enabled: false }
  | { enabled: true; found: false }
  | {
      enabled: true;
      found: true;
      tenantEnabled: boolean;
      lead: ScreenLead;
      /** The converted stages of the pipeline's CURRENT revision: the targets a conversion may name. */
      convertedStages: RevisionView["stages"];
      /** `id`, `mode`, `occurredAt`, `reversedAt` only: no customer or evidence reference. */
      conversions: {
        id: string;
        mode: string;
        occurredAt: string;
        reversedAt: string | null;
      }[];
      canApprove: boolean;
      canManual: boolean;
    };

export async function loadLeadConversion(input: {
  context: CrmLeadsScreenContext;
  leadId: string | null;
  approveGuard: AccessRequest;
  manualGuard: AccessRequest;
  can: CrmLeadsCan;
}): Promise<LeadConversionData> {
  const { tx, tenantId } = input.context;

  if (!isCrmLeadsEnabled()) return { enabled: false };

  if (input.leadId === null) return { enabled: true, found: false };

  const lead = await fetchLeadView(tx, tenantId, input.leadId);

  if (!lead || lead.deletedAt !== null) return { enabled: true, found: false };

  const pipeline = await fetchPipeline(tx, tenantId, lead.pipelineId);

  if (!pipeline) return { enabled: true, found: false };

  const history = await fetchLeadHistory(tx, tenantId, lead.id);

  return {
    enabled: true,
    found: true,
    tenantEnabled: (await fetchSettings(tx, tenantId)).enabled,
    lead: withoutCustomerRef(lead),
    convertedStages: pipeline.currentRevision.stages.filter(
      (stage) => stage.category === "converted"
    ),
    conversions: history.conversions.map((row) => ({
      id: String(row.id),
      mode: String(row.mode),
      occurredAt: String(row.occurredAt),
      reversedAt: row.reversedAt === null ? null : String(row.reversedAt)
    })),
    canApprove: await input.can(input.approveGuard),
    canManual: await input.can(input.manualGuard)
  };
}
