/**
 * Classification for ADR-0044 §4 Fase 2, step two: deciding what can become a
 * managed ad placement and what must be reported as residue.
 *
 * Pure — no `Bun.SQL`, no network, no env resolution — so the decision that
 * governs whether a live advertisement survives the migration can be tested
 * exhaustively without a database, and so the job script contains no judgement
 * of its own.
 *
 * ## Why "already in the bucket" is the only automatic case
 *
 * `awcms_blog_ads.image_url` is free text: it can point anywhere on the
 * internet. Turning an arbitrary external URL into a managed media object
 * means fetching third-party bytes FROM THE SERVER, on demand, at an address
 * an admin typed. That is a server-side request forgery primitive, and this
 * repo already decided how it feels about those — the OIDC discovery client
 * refuses private and metadata addresses precisely so an admin-supplied URL
 * cannot make the server reach inward (`docs/adr/0031`, Issue #185).
 *
 * Building that fetcher here, inside a data-migration script, would be the
 * worst possible place for it: run once, under time pressure, by an operator
 * who is watching row counts rather than egress. So it is not built here. A
 * remote image is RESIDUE — reported, with its URL, for a human to re-upload
 * through the media library, which already has upload validation, MIME
 * sniffing, and size caps that no migration script would reproduce correctly.
 *
 * What CAN be automated is the case where the image URL is already the public
 * URL of one of THIS tenant's registered media objects. Then nothing is
 * imported at all: the ad is simply re-pointed at a registry row that already
 * exists and already went through upload validation, MIME sniffing, and
 * verification. That is a bookkeeping fix.
 *
 * Note what this rules out. An object sitting in the bucket with no registry
 * row is ALSO residue, not a candidate for the job to register on the spot.
 * Minting a `verified` row for bytes the job never fetched would be a
 * migration script quietly making the exact assertion the upload pipeline
 * exists to make — and the worker role is not even granted the INSERT that
 * would allow it (`sql/079`).
 *
 * ## The residue contract
 *
 * Every ad ends up in exactly one bucket, and no bucket is silent. ADR-0044
 * §4 is explicit that an ad vanishing from a live site with no record is worse
 * than one that fails to migrate loudly, so "unrecognised" is a reported
 * outcome here, never a skipped row.
 */
import type { AdTarget, AdTargetType } from "./ad-placement-policy";
import { isAdTargetType } from "./ad-placement-policy";

export type LegacyAdResidueReason =
  /** `image_url` is not a parseable absolute URL at all. */
  | "malformed_url"
  /** A real URL, but not under this deployment's media public base — see the header. */
  | "remote_image"
  /**
   * Under the media public base, but the path is not a well-formed object key
   * for THIS tenant. Either a hand-edited URL or another tenant's object; both
   * are refusals, and the second is the one that matters.
   */
  | "foreign_object_key"
  /**
   * A well-formed object key for this tenant, but no row in the media registry
   * claims it. The bytes may well be in the bucket; nothing has vouched for
   * them, and this job does not vouch for them either.
   */
  | "unregistered_media_object"
  /** The legacy placement row carries a `placement_type` outside the shared vocabulary. */
  | "unknown_placement_type"
  /** A `widget`/`post`/`page` placement whose `target_id` is null — it names no resource. */
  | "scoped_placement_without_target";

export type LegacyAdClassification =
  | { kind: "ingestable"; objectKey: string }
  | { kind: "residue"; reason: LegacyAdResidueReason; detail: string };

export type ClassifyLegacyAdImageInput = {
  tenantId: string;
  imageUrl: string;
  /** `NEWS_MEDIA_R2_PUBLIC_BASE_URL` — the deployment's own trusted base. */
  publicBaseUrl: string;
};

/**
 * `isValidNewsMediaObjectKey` is re-implemented here rather than imported from
 * `media_library` to keep this module dependency-free and synchronously
 * testable, the same reasoning `ad-placement-policy.ts` records for
 * `AD_PLACEMENT_DEFAULT_MEDIA_TYPES`. The shapes are pinned to each other by a
 * test rather than by an import.
 */
function isObjectKeyForTenant(tenantId: string, objectKey: string): boolean {
  const escapedTenantId = tenantId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^news-media/${escapedTenantId}/\\d{4}/\\d{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.[a-z0-9]+$`,
    "i"
  );

  return pattern.test(objectKey);
}

export function classifyLegacyAdImage(
  input: ClassifyLegacyAdImageInput
): LegacyAdClassification {
  let imageUrl: URL;
  let baseUrl: URL;

  try {
    imageUrl = new URL(input.imageUrl);
  } catch {
    return {
      kind: "residue",
      reason: "malformed_url",
      detail: input.imageUrl
    };
  }

  try {
    baseUrl = new URL(input.publicBaseUrl);
  } catch {
    // A deployment with no usable media base cannot ingest anything. Reporting
    // every ad as remote is the correct, loud outcome: nothing is lost, and the
    // operator finds out from the report rather than from an empty run.
    return {
      kind: "residue",
      reason: "remote_image",
      detail: input.imageUrl
    };
  }

  // Origin comparison, not string prefix. `https://media.example.test.evil.com/`
  // starts with `https://media.example.test` as a string, and a prefix check
  // would happily treat an attacker-controlled host as the deployment's own.
  if (imageUrl.origin !== baseUrl.origin) {
    return { kind: "residue", reason: "remote_image", detail: input.imageUrl };
  }

  const basePath = baseUrl.pathname.replace(/\/+$/, "");

  if (basePath && !imageUrl.pathname.startsWith(`${basePath}/`)) {
    return { kind: "residue", reason: "remote_image", detail: input.imageUrl };
  }

  const objectKey = decodeURIComponent(
    imageUrl.pathname.slice(basePath.length).replace(/^\/+/, "")
  );

  if (!isObjectKeyForTenant(input.tenantId, objectKey)) {
    return {
      kind: "residue",
      reason: "foreign_object_key",
      detail: objectKey
    };
  }

  return { kind: "ingestable", objectKey };
}

export type LegacyPlacementRow = {
  placementType: string;
  targetId: string | null;
};

export type LegacyPlacementMapping =
  | { kind: "mapped"; target: AdTarget }
  | {
      kind: "residue";
      reason: "unknown_placement_type" | "scoped_placement_without_target";
      detail: string;
    };

/**
 * The legacy `placement_type` vocabulary and the new `target_type` vocabulary
 * are the SAME four values — deliberately, because PR #301 chose them to be
 * (`AD_TARGET_TYPES`). So this mapping is an identity, and its whole job is to
 * prove that at runtime rather than assume it: if either side ever drifts, a
 * legacy row lands in residue with its type named, instead of being written as
 * a target the render query will never match.
 *
 * A `global` row's `target_id` is discarded rather than carried. The legacy
 * schema left the column nullable and enforced "forbidden for global" only in
 * application code, so a stray id is a shape the old table genuinely permits —
 * and migration 078's pairing CHECK would reject it on write.
 */
export function mapLegacyPlacementToTarget(
  row: LegacyPlacementRow
): LegacyPlacementMapping {
  if (!isAdTargetType(row.placementType)) {
    return {
      kind: "residue",
      reason: "unknown_placement_type",
      detail: row.placementType
    };
  }

  const targetType: AdTargetType = row.placementType;

  if (targetType === "global") {
    return { kind: "mapped", target: { targetType, targetId: null } };
  }

  if (!row.targetId) {
    // A scoped legacy row with no target names no resource. It could not have
    // rendered anywhere under the old system either (its query matched on
    // `target_id IS NOT DISTINCT FROM`, so it only ever matched a caller
    // explicitly asking for a null target of that type).
    return {
      kind: "residue",
      reason: "scoped_placement_without_target",
      detail: `${targetType} placement with no target_id`
    };
  }

  return { kind: "mapped", target: { targetType, targetId: row.targetId } };
}

/**
 * An ad with NO placement rows at all. The legacy render query joined
 * placements, so such an ad rendered nowhere — it is configuration an editor
 * created and never finished. Migrating it as `global` would put an
 * advertisement on every page of a live site that has never displayed it,
 * which is a strictly worse failure than leaving it behind, so it is reported
 * instead of guessed at.
 */
export const UNPLACED_LEGACY_AD_DETAIL =
  "ad has no placement rows — it rendered nowhere under the legacy system";
