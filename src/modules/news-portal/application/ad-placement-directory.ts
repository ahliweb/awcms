import { escapeHtml } from "../../../lib/html/escape";
import { recordAuditEvent } from "../../logging/application/audit-log";
import type {
  AdPlacementKey,
  AdRotationMode,
  CreateAdPlacementInput,
  UpdateAdPlacementInput
} from "../domain/ad-placement-policy";
import { AD_PLACEMENT_PRESETS } from "../domain/ad-placement-policy";
import {
  selectAdsForRotation,
  type AdRotationCandidate
} from "../domain/ad-placement-rotation";
import { isNewsMediaObjectSafeForPublicReference } from "../../media-library/application/media-object-directory";

/**
 * Read/write query module for `awcms_news_portal_ad_placements`
 * (Issue #638) — same "one directory, reads and writes" convention as
 * `ads-directory.ts`/`homepage-section-directory.ts`. The column list is
 * repeated literally at each query site (not factored into a shared
 * fragment), same convention every other directory module in this repo
 * uses.
 */
export type AdPlacementView = {
  id: string;
  tenantId: string;
  placementKey: AdPlacementKey;
  name: string;
  mediaObjectId: string;
  linkUrl: string | null;
  rotationMode: AdRotationMode;
  priority: number;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  deleteReason: string | null;
};

type AdPlacementRow = {
  id: string;
  tenant_id: string;
  placement_key: AdPlacementKey;
  name: string;
  media_object_id: string;
  link_url: string | null;
  rotation_mode: AdRotationMode;
  priority: number;
  is_active: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by: string | null;
  delete_reason: string | null;
};

function toView(row: AdPlacementRow): AdPlacementView {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    placementKey: row.placement_key,
    name: row.name,
    mediaObjectId: row.media_object_id,
    linkUrl: row.link_url,
    rotationMode: row.rotation_mode,
    priority: row.priority,
    isActive: row.is_active,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deleteReason: row.delete_reason
  };
}

const AUDIT_MODULE_KEY = "news_portal";
const AUDIT_RESOURCE_TYPE = "news_portal_ad_placement";

export async function createAdPlacement(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: CreateAdPlacementInput,
  correlationId?: string
): Promise<AdPlacementView> {
  const rows = (await tx`
    INSERT INTO awcms_news_portal_ad_placements
      (tenant_id, placement_key, name, media_object_id, link_url, rotation_mode,
       priority, is_active, starts_at, ends_at)
    VALUES (
      ${tenantId}, ${input.placementKey}, ${input.name}, ${input.mediaObjectId},
      ${input.linkUrl}, ${input.rotationMode}, ${input.priority}, ${input.isActive},
      ${input.startsAt}, ${input.endsAt}
    )
    RETURNING id, tenant_id, placement_key, name, media_object_id, link_url,
      rotation_mode, priority, is_active, starts_at, ends_at, created_at,
      updated_at, deleted_at, deleted_by, delete_reason
  `) as AdPlacementRow[];

  const created = toView(rows[0]!);

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "news_portal.ad_placement.created",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: created.id,
    severity: "info",
    message: `Ad placement created: ${created.placementKey} (${created.name}).`,
    attributes: { placementKey: created.placementKey },
    correlationId
  });

  return created;
}

export async function fetchAdPlacementById(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<AdPlacementView | null> {
  const rows = (await tx`
    SELECT id, tenant_id, placement_key, name, media_object_id, link_url,
      rotation_mode, priority, is_active, starts_at, ends_at, created_at,
      updated_at, deleted_at, deleted_by, delete_reason
    FROM awcms_news_portal_ad_placements
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
  `) as AdPlacementRow[];

  const row = rows[0];
  return row ? toView(row) : null;
}

/** Admin listing — every non-deleted ad placement (active or not, in/out of schedule window). */
export async function listAdPlacements(
  tx: Bun.SQL,
  tenantId: string
): Promise<AdPlacementView[]> {
  const rows = (await tx`
    SELECT id, tenant_id, placement_key, name, media_object_id, link_url,
      rotation_mode, priority, is_active, starts_at, ends_at, created_at,
      updated_at, deleted_at, deleted_by, delete_reason
    FROM awcms_news_portal_ad_placements
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
    ORDER BY placement_key ASC, priority DESC, created_at DESC
    LIMIT 500
  `) as AdPlacementRow[];

  return rows.map(toView);
}

export async function updateAdPlacement(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  input: UpdateAdPlacementInput,
  correlationId?: string
): Promise<AdPlacementView | null> {
  const rows = (await tx`
    UPDATE awcms_news_portal_ad_placements
    SET placement_key = COALESCE(${input.placementKey ?? null}, placement_key),
        name = COALESCE(${input.name ?? null}, name),
        media_object_id = COALESCE(${input.mediaObjectId ?? null}, media_object_id),
        link_url = CASE WHEN ${input.linkUrl === undefined} THEN link_url ELSE ${input.linkUrl ?? null} END,
        rotation_mode = COALESCE(${input.rotationMode ?? null}, rotation_mode),
        priority = COALESCE(${input.priority ?? null}, priority),
        is_active = COALESCE(${input.isActive ?? null}, is_active),
        starts_at = CASE WHEN ${input.startsAt === undefined} THEN starts_at ELSE ${input.startsAt ?? null} END,
        ends_at = CASE WHEN ${input.endsAt === undefined} THEN ends_at ELSE ${input.endsAt ?? null} END,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id, tenant_id, placement_key, name, media_object_id, link_url,
      rotation_mode, priority, is_active, starts_at, ends_at, created_at,
      updated_at, deleted_at, deleted_by, delete_reason
  `) as AdPlacementRow[];

  const updated = rows[0] ? toView(rows[0]) : null;
  if (!updated) return null;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "news_portal.ad_placement.updated",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: id,
    severity: "info",
    message: `Ad placement updated: ${updated.placementKey} (${updated.name}).`,
    attributes: { placementKey: updated.placementKey },
    correlationId
  });

  return updated;
}

export async function softDeleteAdPlacement(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  reason: string,
  correlationId?: string
): Promise<boolean> {
  const rows = (await tx`
    UPDATE awcms_news_portal_ad_placements
    SET deleted_at = now(), deleted_by = ${actorTenantUserId}, delete_reason = ${reason},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING placement_key
  `) as { placement_key: AdPlacementKey }[];

  if (rows.length === 0) return false;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "news_portal.ad_placement.deleted",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: id,
    severity: "warning",
    message: "Ad placement deleted.",
    attributes: { placementKey: rows[0]!.placement_key, reason },
    correlationId
  });

  return true;
}

export type ActiveAdPlacementForRendering = {
  id: string;
  name: string;
  linkUrl: string | null;
  rotationMode: AdRotationMode;
  priority: number;
  createdAt: Date;
  mediaPublicUrl: string;
  mediaAltText: string | null;
};

type ActiveAdPlacementRow = {
  id: string;
  name: string;
  link_url: string | null;
  rotation_mode: AdRotationMode;
  priority: number;
  created_at: Date;
  media_public_url: string;
  media_alt_text: string | null;
};

/**
 * Public-safe query for one placement — tenant-scoped (explicit
 * `tenant_id = $1` predicate, RLS FORCE'd defense in depth, same convention
 * `ads-directory.ts`'s `listActiveAdsForPlacement` uses), `is_active =
 * true`, within the schedule window (`starts_at`/`ends_at` NULL-permissive),
 * AND joined against the media registry so only a `verified`/`attached`
 * (i.e. `isNewsMediaObjectSafeForPublicReference`) media object's
 * server-generated `public_url` is ever returned — never a client-supplied
 * URL, because there is no such column on this table at all. A row whose
 * media object has since been soft-deleted/orphaned/failed verification is
 * silently excluded here (degrade, don't error), same "a section existing
 * doesn't mean everything it references is still safe" caveat
 * `homepage-section-directory.ts`'s equivalent query documents.
 *
 * Not wired to any public page route in this issue — same "tested
 * public-safe helper, wiring is a later issue's job" precedent
 * `listActiveAdsForPlacement` (#542) set, and `homepage-section-composer.ts`
 * (#637) explicitly deferred `ad_slot` integration to this issue's R2-only
 * ad system existing first. A derived app or a later issue's homepage/
 * article template work calls `selectAndRenderActiveAdsForPlacement`
 * directly.
 */
export async function listActiveAdPlacementsForRendering(
  tx: Bun.SQL,
  tenantId: string,
  placementKey: AdPlacementKey,
  now: Date = new Date()
): Promise<ActiveAdPlacementForRendering[]> {
  const rows = (await tx`
    SELECT p.id, p.name, p.link_url, p.rotation_mode, p.priority, p.created_at,
      m.public_url AS media_public_url, m.alt_text AS media_alt_text,
      m.status AS media_status
    FROM awcms_news_portal_ad_placements p
    JOIN awcms_news_media_objects m
      ON m.id = p.media_object_id AND m.tenant_id = p.tenant_id
    WHERE p.tenant_id = ${tenantId} AND p.deleted_at IS NULL AND p.is_active = true
      AND p.placement_key = ${placementKey}
      AND (p.starts_at IS NULL OR p.starts_at <= ${now})
      AND (p.ends_at IS NULL OR p.ends_at >= ${now})
      AND m.deleted_at IS NULL
    ORDER BY p.created_at DESC
  `) as (ActiveAdPlacementRow & { media_status: string })[];

  return rows
    .filter((row) =>
      isNewsMediaObjectSafeForPublicReference(
        row.media_status as Parameters<
          typeof isNewsMediaObjectSafeForPublicReference
        >[0]
      )
    )
    .map((row) => ({
      id: row.id,
      name: row.name,
      linkUrl: row.link_url,
      rotationMode: row.rotation_mode,
      priority: row.priority,
      createdAt: row.created_at,
      mediaPublicUrl: row.media_public_url,
      mediaAltText: row.media_alt_text
    }));
}

/**
 * Whitelist render — `<img>` wrapped in `<a rel="sponsored noopener
 * noreferrer">` only when `linkUrl` is set, both attributes escaped, no
 * other markup possible (Issue #638 §Security notes: "Advertisement
 * rendering must not become an XSS channel"). `mediaPublicUrl` is always
 * the registry's own server-generated public URL (never client input,
 * see `news-media-object-key.ts`'s `buildNewsMediaPublicUrl`); `linkUrl` was
 * already write-time validated as an absolute http(s) URL
 * (`ad-placement-policy.ts`'s `isSafeAdLinkUrl`) — escaped here purely for
 * HTML-attribute safety, not URL-scheme re-validation. Same `rel`
 * attributes `ads-directory.ts`'s `renderAdHtml` uses.
 */
export function renderAdPlacementHtml(
  ad: ActiveAdPlacementForRendering
): string {
  const altText = ad.mediaAltText ?? ad.name;
  const image = `<img src="${escapeHtml(ad.mediaPublicUrl)}" alt="${escapeHtml(altText)}">`;

  if (!ad.linkUrl) {
    return `<div class="ad">${image}</div>`;
  }

  return `<div class="ad"><a href="${escapeHtml(ad.linkUrl)}" rel="sponsored noopener noreferrer" target="_blank">${image}</a></div>`;
}

/**
 * Orchestrates the public rendering path end to end for one placement:
 * fetch the eligible-active pool (`listActiveAdPlacementsForRendering`),
 * cap/order it per the placement preset's `maxItems` and each row's own
 * `rotationMode` (`ad-placement-rotation.ts`'s `selectAdsForRotation`), then
 * render each survivor (`renderAdPlacementHtml`). The rotation mode used
 * for the whole selection is read from the FIRST eligible row (ordered by
 * `created_at DESC` from the underlying query) — an admin configuring
 * multiple ads for the same placement is expected to give them the same
 * `rotationMode`; this issue does not model a separate placement-key-wide
 * rotation setting distinct from the per-row field. Falls back to
 * `"latest"` when the pool is empty (irrelevant — nothing to select).
 */
export async function selectAndRenderActiveAdsForPlacement(
  tx: Bun.SQL,
  tenantId: string,
  placementKey: AdPlacementKey,
  now: Date = new Date()
): Promise<string[]> {
  const eligible = await listActiveAdPlacementsForRendering(
    tx,
    tenantId,
    placementKey,
    now
  );

  if (eligible.length === 0) {
    return [];
  }

  const rotationMode = eligible[0]!.rotationMode;
  const preset = AD_PLACEMENT_PRESETS[placementKey];

  const selected = selectAdsForRotation<
    ActiveAdPlacementForRendering & AdRotationCandidate
  >(eligible, rotationMode, preset.maxItems);

  return selected.map((ad) => renderAdPlacementHtml(ad));
}
