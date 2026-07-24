/**
 * Permission KEY CONSTANTS for the tenant media registry (ADR-0036 media-library
 * ownership inversion; originally Issue #633 under `news_portal`).
 *
 * All 9 `media.*` keys are declared in `media-library/module.ts`'s `permissions`
 * array and seeded into `awcms_permissions`. The rows were first seeded under
 * `('news_portal','media',*)` (migration `042`); migration `052`
 * (`awcms_media_library_permission_ownership.sql`) repoints ownership to
 * `('media_library','media',*)` when this module was extracted out of
 * `news_portal` — INSERT the new rows, repoint any role grants, then DELETE the
 * old rows (order is load-bearing).
 *
 * ## Reachability in THIS base
 *
 * `create`/`verify`/`cancel` are enforced today by the presigned-upload flow
 * (`POST /api/v1/media/news-images/upload-sessions`, `.../{id}/finalize`,
 * `.../{id}/cancel`). `read`/`attach`/`detach`/`delete`/`restore`/`purge` are
 * declared ahead of the media lifecycle/browser surface (ADR-0026 step 5d —
 * `/api/v1/media/objects/*` + `/admin/media`) that is NOT yet ported to this
 * base, following the same "declare a permission where the code that will check
 * it lives, not scatter the string" convention `blog_content`'s
 * `posts.*`/`pages.*` set already uses. `awcms-mini`/`awcms-micro` carry the same
 * 9-key set, so this shape is inherited, not invented here.
 *
 * This file remains the single source for the key strings: `module.ts`, the
 * guards, and `tests/media-library-module.test.ts`'s parity assertion all derive
 * from it, so a key can never drift between the descriptor and the code that
 * checks it. Anything needing a media permission MUST reuse these constants
 * rather than re-typing the string.
 *
 * `activityCode` follows this module's own resource shape (`media`, plural
 * dropped to match e.g. `blog_content`'s `posts`/`pages` activity codes),
 * `action` follows the same verb set already used elsewhere in this repo for
 * a soft-deletable resource with an attach/detach lifecycle
 * (`blog_content`'s `posts.create`/`.update`/`.delete`/`.restore`/`.purge`).
 */
export const MEDIA_PERMISSION_ACTIVITY_CODE = "media";

export const MEDIA_PERMISSIONS = {
  /** Create a pending media object metadata record (also gates starting a presigned upload session, Issue #634). */
  create: "media_library.media.create",
  /** Read media object metadata (list/detail). */
  read: "media_library.media.read",
  /** Mark an uploaded object verified (MIME/checksum/dimension check passed) — also gates the finalize endpoint, Issue #634. */
  verify: "media_library.media.verify",
  /** Attach a verified media object to an owning blog/news resource. */
  attach: "media_library.media.attach",
  /** Detach a media object from its current owning resource. */
  detach: "media_library.media.detach",
  /** Soft delete media object metadata. */
  delete: "media_library.media.delete",
  /** Restore a soft-deleted media object. */
  restore: "media_library.media.restore",
  /** Hard purge an already soft-deleted media object. */
  purge: "media_library.media.purge",
  /**
   * Abort one's own not-yet-uploaded upload session (Issue #634). New in
   * this issue — #633's original set (create/read/verify/attach/detach/
   * delete/restore/purge) had no "cancel" concept yet because no upload
   * session existed. Reuses the existing `AccessAction` union member
   * `"cancel"` (`identity-access/domain/access-control.ts`, already used by
   * sync/POS cancel flows) — a distinct permission from `delete` because
   * cancelling a `pending_upload` session (nothing was ever verified/
   * attached) is a materially lower-risk action than soft-deleting a real,
   * previously-verified media object.
   */
  cancel: "media_library.media.cancel"
} as const;

export type NewsMediaPermissionKey = keyof typeof MEDIA_PERMISSIONS;
export type NewsMediaPermissionValue =
  (typeof MEDIA_PERMISSIONS)[NewsMediaPermissionKey];

/**
 * Managed-media ENFORCEMENT permissions (ADR-0036 step 5a, `sql/054`) — a
 * separate activity code from `media` above, deliberately.
 *
 * `media.*` governs individual media OBJECTS (upload this file, delete that
 * row). `enforcement.*` governs a tenant-wide POLICY: whether content may
 * reference media by raw URL at all. Those are different blast radii, so they
 * must be separately grantable — an editor who uploads images all day has no
 * business flipping the tenant's content-validation policy, and folding this
 * into `media.create` would have granted exactly that to every such editor.
 *
 * There is deliberately **no `disable` action, and there never may be.** See
 * `application/enable-managed-media-enforcement.ts` for the full reasoning: a
 * tenant able to turn its own media validation OFF is precisely the exploit
 * `sql/043`'s header documents as confirmed-exploitable in review. Enforcement
 * is one-way by construction, not by permission configuration — an operator who
 * genuinely must roll it back does so through a deployment-level change, which
 * is an auditable, deliberate act rather than a self-service button.
 */
export const MEDIA_ENFORCEMENT_PERMISSION_ACTIVITY_CODE = "enforcement";

export const MEDIA_ENFORCEMENT_PERMISSIONS = {
  /** Read whether managed-media enforcement is active for this tenant, and why it can/cannot be enabled. */
  read: "media_library.enforcement.read",
  /** Turn managed-media enforcement ON for this tenant. One-way — see above. */
  enable: "media_library.enforcement.enable"
} as const;

export type MediaEnforcementPermissionKey =
  keyof typeof MEDIA_ENFORCEMENT_PERMISSIONS;
export type MediaEnforcementPermissionValue =
  (typeof MEDIA_ENFORCEMENT_PERMISSIONS)[MediaEnforcementPermissionKey];
