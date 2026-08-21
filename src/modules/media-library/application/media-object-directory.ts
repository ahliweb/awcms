import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  encodeKeysetCursor,
  KEYSET_CURSOR_CREATED_AT_SQL,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import type { NewsMediaR2Config } from "../domain/media-r2-config";
import {
  changesRightsAdjudication,
  type CopyrightStatus,
  type MediaRightsUpdateInput,
  type RightsVerificationStatus
} from "../domain/media-rights-policy";
import {
  buildNewsMediaObjectKey,
  buildNewsMediaPublicUrl
} from "../domain/media-object-key";

/**
 * Read/write directory for `awcms_news_media_objects` (Issue #633,
 * epic `news_portal`) — same "directory holds reads and writes for one
 * resource" convention as `blog-content/application/blog-post-directory.ts`.
 * Every function here takes an already tenant-scoped `Bun.SQL`/`Bun.TransactionSQL`
 * (from `withTenant`, `lib/database/tenant-context.ts`) — none of them open
 * their own transaction, matching the rest of this repo's directories.
 *
 * Out of scope here (Issue #634): actually talking to R2 (presign, HEAD/GET,
 * streaming PUT) — every status transition below is a plain metadata
 * UPDATE; the caller is responsible for having done the real R2 work first
 * (ADR-0006: provider calls never happen inside a DB transaction).
 *
 * Audit events are written for exactly the actions that still exist here:
 * create, verify, delete, restore, purge (skill `awcms-audit-log`). The epic's
 * original list also named attach/detach; ADR-0056 §A removed both, since
 * ADR-0036 moved the relation they wrote to the consumer's own FK — see the
 * marker where those two functions used to be. The intermediate
 * `pending_upload -> uploaded`
 * and any `-> orphaned`/`-> failed` transition are logged via the structured
 * logger only (`src/lib/logging/logger.ts`) — see `markNewsMediaObjectUploaded`/
 * `markNewsMediaObjectOrphaned`/`markNewsMediaObjectFailed` below for why
 * these are treated as routine lifecycle bookkeeping, not high-risk actions.
 */

export type NewsMediaObjectStatus =
  | "pending_upload"
  | "uploaded"
  | "verified"
  | "attached"
  | "orphaned"
  | "deleted"
  | "failed";

export type NewsMediaOwnerResourceType =
  | "blog_post"
  | "blog_page"
  | "homepage_section"
  | "gallery_item"
  | "ad"
  | "video_thumbnail"
  | "seo_image";

/**
 * `true` for exactly the statuses safe to reference from public content
 * (Issue #636, epic `news_portal`): `verified` (passed the full `finalize`
 * MIME-sniff/checksum pipeline, not yet attached to anything) and
 * `attached` (verified AND currently in use by a resource). Every other
 * status is unsafe to expose publicly: `pending_upload`/`uploaded` never
 * completed content verification (Issue #631's Critical finding — a bare
 * `HEAD`/upload-in-progress row could be anything), `failed` explicitly
 * rejected content verification, `orphaned` was verified but no longer
 * referenced by anything (a dangling reference pointing at it is exactly
 * the bug this predicate exists to catch), and `deleted` is soft-deleted.
 * Consumers outside this module (`blog-content`'s #636 R2-only-mode
 * validation) MUST use this predicate rather than re-deriving the "which
 * statuses are safe" list themselves, so the status model can only ever
 * change in one place.
 */
export function isNewsMediaObjectSafeForPublicReference(
  status: NewsMediaObjectStatus
): boolean {
  return status === "verified" || status === "attached";
}

export type NewsMediaObjectView = {
  id: string;
  tenantId: string;
  moduleKey: string;
  ownerResourceType: NewsMediaOwnerResourceType | null;
  ownerResourceId: string | null;
  storageDriver: string;
  bucketName: string;
  objectKey: string;
  originalFilename: string | null;
  publicUrl: string;
  mimeType: string;
  sizeBytes: number | null;
  checksumSha256: string | null;
  width: number | null;
  height: number | null;
  altText: string | null;
  caption: string | null;
  /** Issue #615 — usage rights. Distinct from `altText` (accessibility) and `caption` (editorial); see `domain/media-rights-policy.ts`. */
  creditLine: string | null;
  sourceName: string | null;
  rightsNotes: string | null;
  copyrightStatus: CopyrightStatus;
  /** A HUMAN judgement about a licence — never `status: "verified"`, which means the BYTES passed a MIME/checksum check. */
  rightsVerificationStatus: RightsVerificationStatus;
  rightsVerifiedBy: string | null;
  rightsVerifiedAt: Date | null;
  status: NewsMediaObjectStatus;
  createdByTenantUserId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  deleteReason: string | null;
  restoredAt: Date | null;
  restoredBy: string | null;
};

type NewsMediaObjectRow = {
  id: string;
  tenant_id: string;
  module_key: string;
  owner_resource_type: NewsMediaOwnerResourceType | null;
  owner_resource_id: string | null;
  storage_driver: string;
  bucket_name: string;
  object_key: string;
  original_filename: string | null;
  public_url: string;
  mime_type: string;
  size_bytes: string | number | null;
  checksum_sha256: string | null;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  caption: string | null;
  credit_line: string | null;
  source_name: string | null;
  rights_notes: string | null;
  copyright_status: CopyrightStatus;
  rights_verification_status: RightsVerificationStatus;
  rights_verified_by: string | null;
  rights_verified_at: Date | null;
  status: NewsMediaObjectStatus;
  created_by_tenant_user_id: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by: string | null;
  delete_reason: string | null;
  restored_at: Date | null;
  restored_by: string | null;
};

function toView(row: NewsMediaObjectRow): NewsMediaObjectView {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    moduleKey: row.module_key,
    ownerResourceType: row.owner_resource_type,
    ownerResourceId: row.owner_resource_id,
    storageDriver: row.storage_driver,
    bucketName: row.bucket_name,
    objectKey: row.object_key,
    originalFilename: row.original_filename,
    publicUrl: row.public_url,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    checksumSha256: row.checksum_sha256,
    width: row.width,
    height: row.height,
    altText: row.alt_text,
    caption: row.caption,
    creditLine: row.credit_line,
    sourceName: row.source_name,
    rightsNotes: row.rights_notes,
    // A row written before `sql/137` reads as `unknown`/`unverified` rather
    // than as null: the columns are NOT NULL with those defaults, and "nobody
    // has established it" is a truthful answer for a legacy archive.
    copyrightStatus: row.copyright_status,
    rightsVerificationStatus: row.rights_verification_status,
    rightsVerifiedBy: row.rights_verified_by,
    rightsVerifiedAt: row.rights_verified_at,
    status: row.status,
    createdByTenantUserId: row.created_by_tenant_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deleteReason: row.delete_reason,
    restoredAt: row.restored_at,
    restoredBy: row.restored_by
  };
}

const AUDIT_MODULE_KEY = "media_library";
const AUDIT_RESOURCE_TYPE = "news_media_object";

export type CreatePendingNewsMediaObjectInput = {
  mimeType: string;
  originalFilename?: string;
  altText?: string;
  caption?: string;
};

export class UnsupportedNewsMediaMimeTypeInputError extends Error {
  constructor(mimeType: string, allowedMimeTypes: string[]) {
    super(
      `Mime type "${mimeType}" is not in the configured allow-list: ${allowedMimeTypes.join(", ")}.`
    );
    this.name = "UnsupportedNewsMediaMimeTypeInputError";
  }
}

/**
 * Creates a `status='pending_upload'` metadata row: generates the object
 * key server-side (§6 convention) and the public URL from the trusted
 * `config.publicBaseUrl` — NEVER from client input. `mimeType` is validated
 * against `config.allowedMimeTypes` BEFORE the key is built (defense in
 * depth — this is not the only place mime validation happens; #634's
 * confirm step must still re-validate against actual bytes).
 */
export async function createPendingNewsMediaObject(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  config: NewsMediaR2Config,
  input: CreatePendingNewsMediaObjectInput,
  correlationId?: string
): Promise<NewsMediaObjectView> {
  const mimeType = input.mimeType.toLowerCase().trim();

  if (!config.allowedMimeTypes.includes(mimeType)) {
    throw new UnsupportedNewsMediaMimeTypeInputError(
      mimeType,
      config.allowedMimeTypes
    );
  }

  const objectKey = buildNewsMediaObjectKey({ tenantId, mimeType });
  const publicUrl = buildNewsMediaPublicUrl(config.publicBaseUrl, objectKey);

  const rows = (await tx`
    INSERT INTO awcms_news_media_objects
      (tenant_id, bucket_name, object_key, original_filename, public_url,
       mime_type, alt_text, caption, created_by_tenant_user_id)
    VALUES (
      ${tenantId}, ${config.bucket}, ${objectKey}, ${input.originalFilename ?? null},
      ${publicUrl}, ${mimeType}, ${input.altText ?? null}, ${input.caption ?? null},
      ${actorTenantUserId}
    )
    RETURNING id, tenant_id, module_key, owner_resource_type, owner_resource_id,
      storage_driver, bucket_name, object_key, original_filename, public_url,
      mime_type, size_bytes, checksum_sha256, width, height, alt_text, caption,
          credit_line, source_name, rights_notes, copyright_status,
          rights_verification_status, rights_verified_by, rights_verified_at,
      status, created_by_tenant_user_id, created_at, updated_at,
      deleted_at, deleted_by, delete_reason, restored_at, restored_by
  `) as NewsMediaObjectRow[];

  const created = toView(rows[0]!);

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "news_media.object.created",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: created.id,
    severity: "info",
    message: `News media object created (pending upload): ${objectKey}.`,
    attributes: { objectKey, mimeType },
    correlationId
  });

  return created;
}

export type FetchNewsMediaObjectOptions = {
  includeDeleted?: boolean;
};

/**
 * Column list shared by the keyset list query below. The point lookups keep
 * their inline lists — rewriting six working queries to share a constant would
 * be churn dressed as tidiness — but a list query must select these columns
 * PLUS the cursor expression, and repeating them a seventh time beside an
 * `AS created_at_cursor` alias is exactly where a column silently goes missing.
 */
const SELECT_COLUMNS =
  "id, tenant_id, module_key, owner_resource_type, owner_resource_id, " +
  "storage_driver, bucket_name, object_key, original_filename, public_url, " +
  "mime_type, size_bytes, checksum_sha256, width, height, alt_text, caption, " +
  // Issue #615 — usage rights. Listed here rather than only on the point
  // lookups because the browse screen shows a credit beside each thumbnail, and
  // an editor picking an image needs to see who it belongs to BEFORE choosing.
  "credit_line, source_name, rights_notes, copyright_status, " +
  "rights_verification_status, rights_verified_by, rights_verified_at, " +
  "status, created_by_tenant_user_id, created_at, updated_at, " +
  "deleted_at, deleted_by, delete_reason, restored_at, restored_by";

/** Page size for {@link listMediaObjects} — bounded, keyset-paginated. */
export const MEDIA_OBJECT_LIST_LIMIT = 50;

/**
 * Which soft-delete state a listing wants.
 *
 * A boolean `includeDeleted` (the point lookups' convention) is wrong for a
 * BROWSE surface: the admin screen's whole reason to look at deleted objects is
 * to restore or purge them, and folding them in with live ones makes "show me
 * what I deleted" impossible to ask. Three explicit states, `"live"` by default
 * — a listing that silently included soft-deleted objects would put rows in
 * front of an operator that no consumer can resolve.
 */
export type MediaObjectDeletionFilter = "live" | "deleted" | "all";

export type ListMediaObjectsFilter = {
  status?: NewsMediaObjectStatus;
  /** Exact match on the stored (already lowercased) mime type. */
  mimeType?: string;
  deletion?: MediaObjectDeletionFilter;
};

/**
 * Browse the tenant's media registry — keyset paginated, newest first
 * (ADR-0056 §C).
 *
 * ## Why this is a new function and not a widened `?ids=`
 *
 * `GET /api/v1/media/objects` demands `?ids=`: it is a batch RESOLVER, built
 * for `awcms-astro` to swap ids for URLs at build time, and it answers only for
 * objects safe to reference publicly. Before this function the application
 * layer had `fetchNewsMediaObjectById`, `fetchNewsMediaObjectsByIds`, and
 * `fetchNewsMediaObjectByObjectKey` — every one a point lookup. There was no
 * way to ask "what media does this tenant have", so a browse screen could not
 * be built on the existing surface at all, whatever the permissions said.
 *
 * Teaching the resolver a no-`ids` mode would turn a request that is a 400
 * today into a dump of the whole registry — a contract change wearing the
 * clothes of an addition. Hence a separate function and a separate route.
 *
 * ## Deliberately unlike the resolver
 *
 * This returns rows in ANY status, including `pending_upload` and `failed`,
 * and (when asked) soft-deleted ones. That is the opposite of
 * `isNewsMediaObjectSafeForPublicReference`, and it is correct here: an
 * administrator's reason to open this list is usually the objects that are NOT
 * healthy. The `media.read` guard is what keeps that inside the tenant, and no
 * caller of this function may use its rows as a public reference — use the port
 * for that.
 *
 * The cursor carries FULL-PRECISION `created_at` text
 * (`KEYSET_CURSOR_CREATED_AT_SQL`), never a JS `Date`, so a page boundary
 * cannot skip rows sharing a millisecond — the trap this repo already paid for
 * (Issue #158), and one a media registry walks straight into, since a batch
 * upload writes many rows inside the same millisecond.
 */
export async function listMediaObjects(
  tx: Bun.SQL,
  tenantId: string,
  filter: ListMediaObjectsFilter = {},
  cursor?: KeysetCursor
): Promise<{ items: NewsMediaObjectView[]; nextCursor: string | null }> {
  const statusParam = filter.status ?? null;
  const mimeTypeParam = filter.mimeType ?? null;
  const deletion: MediaObjectDeletionFilter = filter.deletion ?? "live";
  const cursorCreatedAt = cursor ? cursor.createdAt : null;
  const cursorId = cursor ? cursor.id : null;

  const rows = (await tx`
    SELECT ${tx.unsafe(SELECT_COLUMNS)},
           ${tx.unsafe(KEYSET_CURSOR_CREATED_AT_SQL)} AS created_at_cursor
    FROM awcms_news_media_objects
    WHERE tenant_id = ${tenantId}
      AND (${statusParam}::text IS NULL OR status = ${statusParam})
      AND (${mimeTypeParam}::text IS NULL OR mime_type = ${mimeTypeParam})
      AND (
        ${deletion} = 'all'
        OR (${deletion} = 'live' AND deleted_at IS NULL)
        OR (${deletion} = 'deleted' AND deleted_at IS NOT NULL)
      )
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (created_at, id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT ${MEDIA_OBJECT_LIST_LIMIT}
  `) as (NewsMediaObjectRow & { created_at_cursor: string })[];

  const last = rows[rows.length - 1];

  return {
    items: rows.map(toView),
    nextCursor:
      rows.length === MEDIA_OBJECT_LIST_LIMIT && last
        ? encodeKeysetCursor(last.created_at_cursor, last.id)
        : null
  };
}

export async function fetchNewsMediaObjectById(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  options: FetchNewsMediaObjectOptions = {}
): Promise<NewsMediaObjectView | null> {
  const rows = (
    options.includeDeleted
      ? await tx`
        SELECT id, tenant_id, module_key, owner_resource_type, owner_resource_id,
          storage_driver, bucket_name, object_key, original_filename, public_url,
          mime_type, size_bytes, checksum_sha256, width, height, alt_text, caption,
          credit_line, source_name, rights_notes, copyright_status,
          rights_verification_status, rights_verified_by, rights_verified_at,
          status, created_by_tenant_user_id, created_at, updated_at,
          deleted_at, deleted_by, delete_reason, restored_at, restored_by
        FROM awcms_news_media_objects
        WHERE tenant_id = ${tenantId} AND id = ${id}
      `
      : await tx`
        SELECT id, tenant_id, module_key, owner_resource_type, owner_resource_id,
          storage_driver, bucket_name, object_key, original_filename, public_url,
          mime_type, size_bytes, checksum_sha256, width, height, alt_text, caption,
          credit_line, source_name, rights_notes, copyright_status,
          rights_verification_status, rights_verified_by, rights_verified_at,
          status, created_by_tenant_user_id, created_at, updated_at,
          deleted_at, deleted_by, delete_reason, restored_at, restored_by
        FROM awcms_news_media_objects
        WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
      `
  ) as NewsMediaObjectRow[];

  return rows[0] ? toView(rows[0]) : null;
}

/**
 * Bulk sibling of `fetchNewsMediaObjectById` (Issue #835 §1): resolves many
 * ids in ONE `id = ANY(...)` round-trip instead of one query per id. Used by
 * `news-media-port-adapter.ts`'s `resolveMediaReferences`, whose signature
 * is already batch-shaped — callers correctly hand it the whole id set, only
 * for the old implementation to loop `fetchNewsMediaObjectById` N times. The
 * default (`includeDeleted` omitted) filters `deleted_at IS NULL`, matching
 * the point lookup. Order is not guaranteed — callers key by id, never by
 * position.
 */
export async function fetchNewsMediaObjectsByIds(
  tx: Bun.SQL,
  tenantId: string,
  ids: readonly string[],
  options: FetchNewsMediaObjectOptions = {}
): Promise<NewsMediaObjectView[]> {
  const uniqueIds = [...new Set(ids)];

  if (uniqueIds.length === 0) {
    return [];
  }

  const rows = (
    options.includeDeleted
      ? await tx`
        SELECT id, tenant_id, module_key, owner_resource_type, owner_resource_id,
          storage_driver, bucket_name, object_key, original_filename, public_url,
          mime_type, size_bytes, checksum_sha256, width, height, alt_text, caption,
          credit_line, source_name, rights_notes, copyright_status,
          rights_verification_status, rights_verified_by, rights_verified_at,
          status, created_by_tenant_user_id, created_at, updated_at,
          deleted_at, deleted_by, delete_reason, restored_at, restored_by
        FROM awcms_news_media_objects
        WHERE tenant_id = ${tenantId} AND id = ANY(${tx.array(uniqueIds, "uuid")})
      `
      : await tx`
        SELECT id, tenant_id, module_key, owner_resource_type, owner_resource_id,
          storage_driver, bucket_name, object_key, original_filename, public_url,
          mime_type, size_bytes, checksum_sha256, width, height, alt_text, caption,
          credit_line, source_name, rights_notes, copyright_status,
          rights_verification_status, rights_verified_by, rights_verified_at,
          status, created_by_tenant_user_id, created_at, updated_at,
          deleted_at, deleted_by, delete_reason, restored_at, restored_by
        FROM awcms_news_media_objects
        WHERE tenant_id = ${tenantId} AND id = ANY(${tx.array(uniqueIds, "uuid")})
          AND deleted_at IS NULL
      `
  ) as NewsMediaObjectRow[];

  return rows.map(toView);
}

export type MarkNewsMediaObjectUploadedInput = {
  sizeBytes?: number;
  checksumSha256?: string;
};

/**
 * `pending_upload -> uploaded`. The `WHERE status = 'pending_upload'` guard
 * is this table's mutual-exclusion primitive: Postgres serializes concurrent
 * `UPDATE`s against the same row, so exactly one concurrent caller ever
 * transitions a given row out of `pending_upload` — every other caller's
 * `UPDATE` matches zero rows and gets `null` back. Issue #634's finalize
 * orchestration (security-auditor High finding, PR #653 review) calls this
 * with NO `input` at all as the atomic "claim" step BEFORE attempting any
 * R2 network call — this is what prevents N concurrent `finalize` requests
 * (different `Idempotency-Key`s, so the idempotency store alone cannot
 * dedupe them) from each triggering their own expensive R2 `HEAD`+`GET`
 * for the same object. `sizeBytes`/`checksumSha256` are optional precisely
 * because at claim time (before the real `GET` has happened) neither is
 * known yet — `COALESCE` leaves the column untouched (`NULL`, for a fresh
 * claim) when omitted, so a caller that already knows both values (a
 * standalone/legacy call site, or a test) can still set them here in one
 * step, same as before this change. Deliberately NOT an audited action on
 * its own: "uploaded" only means bytes exist at the object key, not that
 * they were verified as safe/matching content (`markNewsMediaObjectVerified`
 * is the audited "verify" action the epic's acceptance criteria actually
 * requires).
 */
export async function markNewsMediaObjectUploaded(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  input: MarkNewsMediaObjectUploadedInput = {}
): Promise<NewsMediaObjectView | null> {
  const rows = (await tx`
    UPDATE awcms_news_media_objects
    SET status = 'uploaded',
        size_bytes = COALESCE(${input.sizeBytes ?? null}, size_bytes),
        checksum_sha256 = COALESCE(${input.checksumSha256 ?? null}, checksum_sha256),
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id}
      AND status = 'pending_upload' AND deleted_at IS NULL
    RETURNING id, tenant_id, module_key, owner_resource_type, owner_resource_id,
      storage_driver, bucket_name, object_key, original_filename, public_url,
      mime_type, size_bytes, checksum_sha256, width, height, alt_text, caption,
          credit_line, source_name, rights_notes, copyright_status,
          rights_verification_status, rights_verified_by, rights_verified_at,
      status, created_by_tenant_user_id, created_at, updated_at,
      deleted_at, deleted_by, delete_reason, restored_at, restored_by
  `) as NewsMediaObjectRow[];

  return rows[0] ? toView(rows[0]) : null;
}

export type MarkNewsMediaObjectVerifiedInput = {
  width?: number;
  height?: number;
  /**
   * The REAL size/checksum, computed from the bytes actually read by the
   * capped streaming `GET` (`news-media-r2-client.ts`'s `getObject`) —
   * never from a `HEAD` response, which can be stale/raced (security-auditor
   * Critical finding, PR #653 review). Optional + `COALESCE`d so a caller
   * that already set them via `markNewsMediaObjectUploaded` (the legacy/
   * standalone one-step flow) does not need to repeat them here.
   */
  sizeBytes?: number;
  checksumSha256?: string;
};

/**
 * `uploaded -> verified` — server-side MIME sniffing/checksum verification
 * (doc §9, #634's confirm step) passed. This is the "verify" audit action
 * the epic's acceptance criteria requires.
 */
export async function markNewsMediaObjectVerified(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  input: MarkNewsMediaObjectVerifiedInput = {},
  correlationId?: string
): Promise<NewsMediaObjectView | null> {
  const rows = (await tx`
    UPDATE awcms_news_media_objects
    SET status = 'verified', width = ${input.width ?? null}, height = ${input.height ?? null},
        size_bytes = COALESCE(${input.sizeBytes ?? null}, size_bytes),
        checksum_sha256 = COALESCE(${input.checksumSha256 ?? null}, checksum_sha256),
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id}
      AND status = 'uploaded' AND deleted_at IS NULL
    RETURNING id, tenant_id, module_key, owner_resource_type, owner_resource_id,
      storage_driver, bucket_name, object_key, original_filename, public_url,
      mime_type, size_bytes, checksum_sha256, width, height, alt_text, caption,
          credit_line, source_name, rights_notes, copyright_status,
          rights_verification_status, rights_verified_by, rights_verified_at,
      status, created_by_tenant_user_id, created_at, updated_at,
      deleted_at, deleted_by, delete_reason, restored_at, restored_by
  `) as NewsMediaObjectRow[];

  const updated = rows[0] ? toView(rows[0]) : null;
  if (!updated) return null;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "news_media.object.verified",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: id,
    severity: "info",
    message: `News media object verified: ${updated.objectKey}.`,
    attributes: { objectKey: updated.objectKey },
    correlationId
  });

  return updated;
}

/*
 * ADR-0056 §A — `attachNewsMediaObject`/`detachNewsMediaObject` USED TO LIVE
 * HERE, and are gone along with the two permissions that named them
 * (`sql/087`).
 *
 * They wrote `status = 'attached'` plus `owner_resource_type`/`owner_resource_id`
 * — the object→content relation this module owned BEFORE ADR-0036's inversion.
 * After it, a media object's attachment is stated by the consumer's own FK
 * (`awcms_blog_posts.featured_media_id`, `awcms_news_portal_ad_placements.
 * media_object_id`), so attaching means updating the consumer's row under the
 * consumer's permission. Nothing in `src/`, `scripts/`, or `tests/` had called
 * either function.
 *
 * The `attached` STATUS survives them deliberately: `sql/041`'s CHECK still
 * admits it and `isNewsMediaObjectSafeForPublicReference` still treats it as
 * safe, so rows already in that state keep resolving. Nothing writes it
 * anymore, which is the honest end state — `verified` is what the finalize
 * flow produces, and it is equally referenceable.
 */

/**
 * `pending_upload|uploaded|verified -> orphaned` — flags a never-attached
 * object as a cleanup candidate (doc `r2-backup-lifecycle.md` §2, e.g. a
 * pending TTL job). Deliberately excluded from the required audit-event
 * list (create/verify/attach/detach/delete/restore/purge) — this is routine
 * lifecycle bookkeeping performed by an automated job, not itself a
 * high-risk action; callers may still `log()` it structurally.
 *
 * Sets `orphaned_at = now()` (migration 046, Issue #690) — the moment the
 * `NEWS_MEDIA_R2_ORPHAN_GRACE_DAYS` grace period
 * (`scripts/news-media-r2-reconcile.ts`) starts counting from. Nothing else
 * in this file writes `orphaned_at` — it is set exactly once, here, and only
 * read afterward (by the reconciliation job's stale-orphan sweep), so the
 * grace period can never be silently reset/extended by an unrelated update.
 */
export async function markNewsMediaObjectOrphaned(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<NewsMediaObjectView | null> {
  const rows = (await tx`
    UPDATE awcms_news_media_objects
    SET status = 'orphaned', orphaned_at = now(), updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id}
      AND status IN ('pending_upload', 'uploaded', 'verified') AND deleted_at IS NULL
    RETURNING id, tenant_id, module_key, owner_resource_type, owner_resource_id,
      storage_driver, bucket_name, object_key, original_filename, public_url,
      mime_type, size_bytes, checksum_sha256, width, height, alt_text, caption,
          credit_line, source_name, rights_notes, copyright_status,
          rights_verification_status, rights_verified_by, rights_verified_at,
      status, created_by_tenant_user_id, created_at, updated_at,
      deleted_at, deleted_by, delete_reason, restored_at, restored_by
  `) as NewsMediaObjectRow[];

  return rows[0] ? toView(rows[0]) : null;
}

export type MarkNewsMediaObjectFailedOptions = {
  /**
   * Issue #690: when set, this transition ONLY claims rows also older than
   * this cutoff (`created_at < olderThan`) — used by
   * `scripts/news-media-r2-reconcile.ts` as the ATOMIC claim step for
   * expired `pending_upload`/`uploaded` rows, the exact same "guarded
   * UPDATE...WHERE, Postgres serializes concurrent writers" mutual-exclusion
   * idiom `finalizeNewsMediaUploadSession`'s own claim
   * (`markNewsMediaObjectUploaded`) already established: if a client's
   * `finalize()` call concurrently transitions the SAME row away from
   * `pending_upload`/`uploaded` first, this `UPDATE`'s `WHERE` no longer
   * matches, so it claims zero rows here — the row is never yanked out from
   * under a genuinely in-flight upload. Omitted (the pre-#690 default) for
   * every other caller (verification rejection, R2 provider error at
   * finalize time) — no age filter, exactly the original behavior.
   */
  olderThan?: Date;
};

/**
 * `pending_upload|uploaded -> failed` — upload or verification failed
 * (checksum mismatch, R2 error, disallowed content sniffed, etc), OR (Issue
 * #690, `options.olderThan` set) the row expired past
 * `NEWS_MEDIA_R2_PENDING_TTL_MINUTES` without ever being finalized. Same
 * "not in the required audit list" reasoning as `markNewsMediaObjectOrphaned`.
 */
export async function markNewsMediaObjectFailed(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  options: MarkNewsMediaObjectFailedOptions = {}
): Promise<NewsMediaObjectView | null> {
  const rows = (
    options.olderThan
      ? await tx`
        UPDATE awcms_news_media_objects
        SET status = 'failed', updated_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${id}
          AND status IN ('pending_upload', 'uploaded') AND deleted_at IS NULL
          AND created_at < ${options.olderThan}
        RETURNING id, tenant_id, module_key, owner_resource_type, owner_resource_id,
          storage_driver, bucket_name, object_key, original_filename, public_url,
          mime_type, size_bytes, checksum_sha256, width, height, alt_text, caption,
          credit_line, source_name, rights_notes, copyright_status,
          rights_verification_status, rights_verified_by, rights_verified_at,
          status, created_by_tenant_user_id, created_at, updated_at,
          deleted_at, deleted_by, delete_reason, restored_at, restored_by
      `
      : await tx`
        UPDATE awcms_news_media_objects
        SET status = 'failed', updated_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${id}
          AND status IN ('pending_upload', 'uploaded') AND deleted_at IS NULL
        RETURNING id, tenant_id, module_key, owner_resource_type, owner_resource_id,
          storage_driver, bucket_name, object_key, original_filename, public_url,
          mime_type, size_bytes, checksum_sha256, width, height, alt_text, caption,
          credit_line, source_name, rights_notes, copyright_status,
          rights_verification_status, rights_verified_by, rights_verified_at,
          status, created_by_tenant_user_id, created_at, updated_at,
          deleted_at, deleted_by, delete_reason, restored_at, restored_by
      `
  ) as NewsMediaObjectRow[];

  return rows[0] ? toView(rows[0]) : null;
}

/**
 * Hard delete for a `status = 'failed'` row past
 * `NEWS_MEDIA_R2_PENDING_TTL_MINUTES` (Issue #690,
 * `scripts/news-media-r2-reconcile.ts`) — the row never became a real,
 * referenceable resource (`r2-backup-lifecycle.md` §2: a stale `pending`
 * row is "bukan resource yang pernah dipakai siapa pun"), so this is a hard
 * DELETE, not the soft-delete path `softDeleteNewsMediaObject`/
 * `purgeNewsMediaObject` use for a resource that WAS real. The `WHERE`
 * guard (`status = 'failed' AND created_at < olderThan`) re-verifies
 * eligibility atomically at delete time — this is called only AFTER the
 * caller has already deleted (or confirmed the absence of) the R2 object
 * for `object_key`, per this module's own ordering discipline (see
 * `scripts/news-media-r2-reconcile.ts`'s header for the full DB-claim-first,
 * R2-delete-second rationale and its self-healing relationship with
 * "orphan-in-R2" detection).
 */
export async function purgeExpiredPendingNewsMediaObject(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  olderThan: Date
): Promise<boolean> {
  const rows = (await tx`
    DELETE FROM awcms_news_media_objects
    WHERE tenant_id = ${tenantId} AND id = ${id}
      AND status = 'failed' AND deleted_at IS NULL AND created_at < ${olderThan}
    RETURNING object_key
  `) as { object_key: string }[];

  if (rows.length === 0) return false;

  await recordAuditEvent(tx, {
    tenantId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "news_media.object.pending_expired_purged",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: id,
    severity: "warning",
    message: `News media object purged: expired pending upload past its TTL (${rows[0]!.object_key}).`,
    attributes: { objectKey: rows[0]!.object_key }
  });

  return true;
}

/**
 * `orphaned -> ` soft-deleted (Issue #690,
 * `scripts/news-media-r2-reconcile.ts`) — physical R2 cleanup grace period
 * (`NEWS_MEDIA_R2_ORPHAN_GRACE_DAYS`, `r2-backup-lifecycle.md` §3) has
 * elapsed for a row already flagged `orphaned`. Unlike
 * `purgeExpiredPendingNewsMediaObject`, this is a SOFT delete — the row WAS
 * a real, once-verified media object (§3's retention table: "Baris metadata
 * `deleted` (soft delete): baris tetap ada (audit trail)... objek fisik R2
 * dihapus setelah masa tenggang"). `status`/`orphaned_at` are left
 * unchanged (soft delete stays orthogonal to `status`, same convention as
 * every other transition in this file). No `actorTenantUserId` — this is a
 * system job, not a human action; `deleted_by` stays `NULL`.
 */
export async function markStaleOrphanedNewsMediaObjectDeleted(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  olderThan: Date
): Promise<boolean> {
  const rows = (await tx`
    UPDATE awcms_news_media_objects
    SET deleted_at = now(), delete_reason = 'r2_orphan_grace_period_expired',
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id}
      AND status = 'orphaned' AND deleted_at IS NULL AND orphaned_at < ${olderThan}
    RETURNING object_key
  `) as { object_key: string }[];

  if (rows.length === 0) return false;

  await recordAuditEvent(tx, {
    tenantId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "news_media.object.orphan_expired_deleted",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: id,
    severity: "warning",
    message: `News media object soft deleted: orphan grace period expired (${rows[0]!.object_key}).`,
    attributes: { objectKey: rows[0]!.object_key }
  });

  return true;
}

/**
 * Point lookup used as the FINAL, immediate-before-delete gate for
 * "orphan-in-R2" candidates (Issue #690,
 * `scripts/news-media-r2-reconcile.ts`) — an R2 object whose key had NO
 * matching row in the job's own earlier bulk DB scan. Between that scan and
 * the moment the job is actually about to call `deleteObject`, a NEW row
 * for the SAME key could have been created (this is impossible in the
 * current upload flow, since `createPendingNewsMediaObject` always inserts
 * the row BEFORE a client ever receives a presigned URL for that key — but
 * this re-check exists precisely so the job's safety property does not rest
 * on that invariant holding forever). Deliberately ignores `deleted_at`
 * (ANY row for this key — soft-deleted or not — means "already tracked,
 * do not treat as an untracked orphan-in-R2 object"), using the exact same
 * `(tenant_id, object_key)` unique index `createPendingNewsMediaObject`'s
 * own INSERT relies on.
 */
export async function objectKeyExistsForTenant(
  tx: Bun.SQL,
  tenantId: string,
  objectKey: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT 1 AS exists_flag FROM awcms_news_media_objects
    WHERE tenant_id = ${tenantId} AND object_key = ${objectKey}
    LIMIT 1
  `) as { exists_flag: number }[];

  return rows.length > 0;
}

/**
 * Point lookup by object key returning the row itself, for ADR-0044 §4's
 * legacy advertisement ingest (`scripts/blog-ads-ingest.ts`). That job holds a
 * public URL it has already decomposed into an object key for this tenant, and
 * needs the id and status of whatever registry row claims it.
 *
 * Distinct from `objectKeyExistsForTenant` in the one way that matters: this
 * EXCLUDES soft-deleted rows. That function deliberately ignores `deleted_at`
 * because its question is "is this key tracked at all" before a destructive
 * R2 delete. The question here is the opposite — "may a new advertisement be
 * pointed at this" — and a soft-deleted media object is precisely what must
 * not acquire a fresh public reference.
 */
export async function fetchNewsMediaObjectByObjectKey(
  tx: Bun.SQL,
  tenantId: string,
  objectKey: string
): Promise<{ id: string; status: NewsMediaObjectStatus } | null> {
  const rows = (await tx`
    SELECT id, status FROM awcms_news_media_objects
    WHERE tenant_id = ${tenantId} AND object_key = ${objectKey}
      AND deleted_at IS NULL
    LIMIT 1
  `) as { id: string; status: NewsMediaObjectStatus }[];

  return rows[0] ?? null;
}

export type NewsMediaReconciliationSnapshotRow = {
  id: string;
  objectKey: string;
  status: NewsMediaObjectStatus;
  createdAt: Date;
  orphanedAt: Date | null;
  deletedAt: Date | null;
};

/**
 * Default safety bound for `fetchNewsMediaObjectsForReconciliation` —
 * mirrors `src/lib/jobs/batching.ts`'s `DEFAULT_MAX_PASSES` reasoning (a
 * single scheduled run must never load an unbounded number of rows into
 * memory). A tenant with more than this many non-purged media rows only
 * gets a PARTIAL snapshot this run (oldest rows first, so the longest-
 * overdue cleanup candidates are prioritized) — `scripts/news-media-r2-
 * reconcile.ts` surfaces this as `status: "partial"` job telemetry, same
 * convention `audit-log-purge.ts`'s `hitPassLimit` uses, and the remainder
 * is picked up on a LATER run (this snapshot is re-derived fresh every run,
 * never a persisted cursor).
 */
export const NEWS_MEDIA_RECONCILIATION_SNAPSHOT_LIMIT = 20_000;

/**
 * The single DB-side input to `categorizeNewsMediaReconciliation`
 * (`news-media-reconciliation-categorization.ts`, Issue #690) — every
 * non-purged row for one tenant (any `status`, including already
 * soft-deleted), so that module's `orphanInR2` category can correctly tell
 * "genuinely no row references this R2 key" apart from "there IS a row, it
 * just isn't one of the expected-present statuses". Ordered oldest-first
 * (`created_at ASC`) so a snapshot truncated by
 * `NEWS_MEDIA_RECONCILIATION_SNAPSHOT_LIMIT` always contains the
 * longest-overdue cleanup candidates rather than an arbitrary subset.
 */
export async function fetchNewsMediaObjectsForReconciliation(
  tx: Bun.SQL,
  tenantId: string,
  limit: number = NEWS_MEDIA_RECONCILIATION_SNAPSHOT_LIMIT
): Promise<NewsMediaReconciliationSnapshotRow[]> {
  const rows = (await tx`
    SELECT id, object_key, status, created_at, orphaned_at, deleted_at
    FROM awcms_news_media_objects
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at ASC
    LIMIT ${limit}
  `) as {
    id: string;
    object_key: string;
    status: NewsMediaObjectStatus;
    created_at: Date;
    orphaned_at: Date | null;
    deleted_at: Date | null;
  }[];

  return rows.map((row) => ({
    id: row.id,
    objectKey: row.object_key,
    status: row.status,
    createdAt: row.created_at,
    orphanedAt: row.orphaned_at,
    deletedAt: row.deleted_at
  }));
}

/**
 * `uploaded -> pending_upload` — reverts the atomic claim
 * `markNewsMediaObjectUploaded` makes, ONLY for a transient/infra reason
 * (R2 provider error, circuit breaker open, timeout) rather than a
 * definitive content-rejection (that path is `markNewsMediaObjectFailed`,
 * permanent — the client must start a new upload session). Issue #634's
 * finalize orchestration (security-auditor High finding, PR #653 review)
 * claims a row BEFORE calling R2 so concurrent `finalize` calls cannot each
 * trigger their own R2 round trip; without this revert, a single transient
 * R2 failure would leave the row stuck in `uploaded` forever with no path
 * back to a retryable state.
 */
export async function revertNewsMediaObjectUploadClaim(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<NewsMediaObjectView | null> {
  const rows = (await tx`
    UPDATE awcms_news_media_objects
    SET status = 'pending_upload', updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id}
      AND status = 'uploaded' AND deleted_at IS NULL
    RETURNING id, tenant_id, module_key, owner_resource_type, owner_resource_id,
      storage_driver, bucket_name, object_key, original_filename, public_url,
      mime_type, size_bytes, checksum_sha256, width, height, alt_text, caption,
          credit_line, source_name, rights_notes, copyright_status,
          rights_verification_status, rights_verified_by, rights_verified_at,
      status, created_by_tenant_user_id, created_at, updated_at,
      deleted_at, deleted_by, delete_reason, restored_at, restored_by
  `) as NewsMediaObjectRow[];

  return rows[0] ? toView(rows[0]) : null;
}

/**
 * Soft delete — orthogonal to `status` (same convention as
 * `awcms_blog_posts`): deleting never rewrites `status`, it only sets
 * `deleted_at`/`deleted_by`/`delete_reason`. Works from any status.
 */
export async function softDeleteNewsMediaObject(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  reason: string,
  correlationId?: string
): Promise<boolean> {
  const rows = (await tx`
    UPDATE awcms_news_media_objects
    SET deleted_at = now(), deleted_by = ${actorTenantUserId}, delete_reason = ${reason},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING object_key
  `) as { object_key: string }[];

  if (rows.length === 0) return false;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "news_media.object.deleted",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: id,
    severity: "warning",
    message: `News media object soft deleted: ${rows[0]!.object_key}.`,
    attributes: { objectKey: rows[0]!.object_key, reason },
    correlationId
  });

  return true;
}

export async function restoreNewsMediaObject(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  correlationId?: string
): Promise<NewsMediaObjectView | null> {
  const rows = (await tx`
    UPDATE awcms_news_media_objects
    SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL,
        restored_at = now(), restored_by = ${actorTenantUserId}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NOT NULL
    RETURNING id, tenant_id, module_key, owner_resource_type, owner_resource_id,
      storage_driver, bucket_name, object_key, original_filename, public_url,
      mime_type, size_bytes, checksum_sha256, width, height, alt_text, caption,
          credit_line, source_name, rights_notes, copyright_status,
          rights_verification_status, rights_verified_by, rights_verified_at,
      status, created_by_tenant_user_id, created_at, updated_at,
      deleted_at, deleted_by, delete_reason, restored_at, restored_by
  `) as NewsMediaObjectRow[];

  const restored = rows[0] ? toView(rows[0]) : null;
  if (!restored) return null;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "news_media.object.restored",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: id,
    severity: "info",
    message: `News media object restored: ${restored.objectKey}.`,
    attributes: { objectKey: restored.objectKey },
    correlationId
  });

  return restored;
}

export type PurgeNewsMediaObjectResult =
  | { ok: true; objectKey: string }
  /** No row matched `id` in this tenant with `deleted_at IS NOT NULL`. */
  | { ok: false; reason: "not_purgeable" }
  /** A live FK still points at the row — see the savepoint note below. */
  | { ok: false; reason: "still_referenced" };

/** Postgres foreign-key violation. */
const FOREIGN_KEY_VIOLATION = "23503";

/**
 * The SQLSTATE is on `errno`, NOT on `code`. Bun sets `code` to its own
 * `"ERR_POSTGRES_SERVER_ERROR"` for every server error alike, so comparing
 * `code` against a SQLSTATE is always false — the error would be rethrown and
 * the caller-actionable 409 would surface as a 500. Verified against
 * PostgreSQL 18 + Bun 1.3.14; `String()` because `errno` is typed loosely
 * enough to be a number in other Bun error shapes. Same idiom as the ten other
 * violation checks in this repo (`role-admin.ts`, `office-directory.ts`, ...).
 */
function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "errno" in error &&
    String((error as { errno?: unknown }).errno) === FOREIGN_KEY_VIOLATION
  );
}

/** Fixed identifier — never built from input. */
const PURGE_SAVEPOINT = "awcms_purge_media_object";

/**
 * Hard delete of the REGISTRY ROW. Eligibility is enforced in the `WHERE`
 * (`deleted_at IS NOT NULL`), so an object that was never soft-deleted comes
 * back `not_purgeable` rather than silently vanishing.
 *
 * ## This does NOT delete the R2 object (ADR-0056 §B)
 *
 * The reconciliation job owns the bucket. Deleting bytes here would put two
 * writers on one bucket with two different ideas of what is safe to remove, and
 * the job already has the ordering discipline for it (see
 * `scripts/news-media-r2-reconcile.ts`). The accepted, stated cost is a window
 * where the R2 object outlives its registry row — closed by the next
 * reconciliation tick, which sees a key with no row and treats it as an
 * orphan-in-R2.
 *
 * ## Why a savepoint, and why no pre-check
 *
 * `awcms_news_portal_ad_placements.media_object_id` is a hard, NOT NULL FK to
 * this table with no `ON DELETE` clause — so purging a still-referenced object
 * raises `23503`. In PostgreSQL that ABORTS the transaction: every later
 * statement fails with "current transaction is aborted", and the COMMIT
 * `withTenant` performs on a returned 4xx fails too. Catching the error without
 * a savepoint turns a caller-actionable 409 into a 500.
 *
 * There is deliberately no pre-check SELECT to go with it — unlike
 * `provisionTenant`, which pre-checks then uses the savepoint only for the race.
 * A pre-check here would have to name the referencing tables, i.e. this module
 * would have to know its own CONSUMERS (`module.ts`: "media must never depend on
 * its own consumers"). Letting the FK answer keeps that knowledge in the
 * database, where it already lives, and stays correct the day a second module
 * adds a reference.
 */
export async function purgeNewsMediaObject(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  correlationId?: string
): Promise<PurgeNewsMediaObjectResult> {
  await tx.unsafe(`SAVEPOINT ${PURGE_SAVEPOINT}`);

  let rows: { object_key: string }[];

  try {
    rows = (await tx`
      DELETE FROM awcms_news_media_objects
      WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NOT NULL
      RETURNING object_key
    `) as { object_key: string }[];

    await tx.unsafe(`RELEASE SAVEPOINT ${PURGE_SAVEPOINT}`);
  } catch (error) {
    await tx.unsafe(`ROLLBACK TO SAVEPOINT ${PURGE_SAVEPOINT}`);

    if (isForeignKeyViolation(error)) {
      return { ok: false, reason: "still_referenced" };
    }
    throw error;
  }

  if (rows.length === 0) return { ok: false, reason: "not_purgeable" };

  const objectKey = rows[0]!.object_key;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "news_media.object.purged",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: id,
    severity: "warning",
    message: `News media object purged: ${objectKey}.`,
    attributes: { objectKey },
    correlationId
  });

  return { ok: true, objectKey };
}

/**
 * Edit usage-rights metadata (Issue #615).
 *
 * ## Why a dedicated function rather than a general `updateMediaObject`
 *
 * Because most of this row must not be editable. `object_key`, `bucket_name`,
 * `checksum_sha256`, `mime_type` and `public_url` describe a file that exists in
 * R2; letting a PATCH touch them would let a browser make the registry disagree
 * with storage, and the reconciliation job would then "fix" the wrong side. This
 * function names the seven columns it may write and can never widen by accident.
 *
 * ## The adjudication is stamped here, not sent by the client
 *
 * `rights_verified_by` is the authenticated actor and `rights_verified_at` is
 * the transaction clock. A client-supplied verifier is a client-supplied
 * signature on a legal decision, and this row is what a takedown dispute is
 * argued from. Moving BACK to `unverified` clears both, so the record never
 * carries a verifier for a verification that no longer stands — which the
 * `rights_adjudication_check` CHECK also enforces from below.
 *
 * ## Audit severity follows the decision, not the edit
 *
 * Fixing a typo in a credit line is `info`. Declaring an image cleared for
 * publication — or refusing it — is `warning`, because that is the entry someone
 * reconstructing a takedown will search for.
 */
export async function updateMediaObjectRights(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  input: MediaRightsUpdateInput,
  correlationId?: string
): Promise<NewsMediaObjectView | null> {
  const existing = await fetchNewsMediaObjectById(tx, tenantId, id);

  // Matched on `deleted_at IS NULL` below too. A soft-deleted object is not
  // editable: its rights record is evidence about something already withdrawn.
  if (!existing || existing.deletedAt !== null) {
    return null;
  }

  const adjudicationChanged = changesRightsAdjudication(
    input,
    existing.rightsVerificationStatus
  );
  const nextStatus =
    input.rightsVerificationStatus ?? existing.rightsVerificationStatus;
  const becomesUnverified = nextStatus === "unverified";

  // The adjudication columns are stamped from the AUTHENTICATED actor and the
  // transaction clock, never from the request body: a client-supplied verifier
  // is a client-supplied signature on a legal decision. They are cleared when
  // the status returns to unverified, so the row never names a verifier for a
  // verification that no longer stands — the CHECK enforces the same from below.

  // `CASE WHEN <flag> THEN <value> ELSE column END` rather than a bare
  // assignment: on a PATCH, `undefined` means "leave alone" and `null` means
  // "clear", and a plain `SET credit_line = $n` collapses the two — a form that
  // submits only the copyright status would erase a credit somebody else typed.
  const rows = (await tx`
    UPDATE awcms_news_media_objects
    SET
      credit_line = CASE
        WHEN ${input.creditLine !== undefined} THEN ${input.creditLine ?? null}
        ELSE credit_line
      END,
      source_name = CASE
        WHEN ${input.sourceName !== undefined} THEN ${input.sourceName ?? null}
        ELSE source_name
      END,
      rights_notes = CASE
        WHEN ${input.rightsNotes !== undefined} THEN ${input.rightsNotes ?? null}
        ELSE rights_notes
      END,
      copyright_status = CASE
        WHEN ${input.copyrightStatus !== undefined}
          THEN ${input.copyrightStatus ?? null}
        ELSE copyright_status
      END,
      rights_verification_status = ${nextStatus},
      rights_verified_by = CASE
        WHEN ${adjudicationChanged}
          THEN ${becomesUnverified ? null : actorTenantUserId}
        ELSE rights_verified_by
      END,
      rights_verified_at = CASE
        WHEN ${adjudicationChanged}
          THEN (CASE WHEN ${becomesUnverified} THEN NULL ELSE now() END)
        ELSE rights_verified_at
      END,
      updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING ${tx.unsafe(SELECT_COLUMNS)}
  `) as NewsMediaObjectRow[];

  const row = rows[0];

  if (!row) {
    return null;
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: adjudicationChanged
      ? "news_media.object.rights_adjudicated"
      : "news_media.object.rights_updated",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: id,
    severity: adjudicationChanged ? "warning" : "info",
    message: adjudicationChanged
      ? `Media rights ${nextStatus}: ${existing.objectKey}.`
      : `Media rights metadata updated: ${existing.objectKey}.`,
    attributes: {
      objectKey: existing.objectKey,
      previousRightsVerificationStatus: existing.rightsVerificationStatus,
      rightsVerificationStatus: nextStatus,
      copyrightStatus: input.copyrightStatus ?? existing.copyrightStatus
    },
    correlationId
  });

  return toView(row);
}
