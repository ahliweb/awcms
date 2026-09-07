/**
 * Permission KEY CONSTANTS for the tenant media registry (ADR-0036 media-library
 * ownership inversion; originally Issue #633 under `news_portal`).
 *
 * Every `media.*` key below is declared in `media-library/module.ts`'s
 * `permissions` array and seeded into `awcms_permissions`. The rows were first
 * seeded under `('news_portal','media',*)` (migration `042`); migration `052`
 * (`awcms_media_library_permission_ownership.sql`) repoints ownership to
 * `('media_library','media',*)` when this module was extracted out of
 * `news_portal` — INSERT the new rows, repoint any role grants, then DELETE the
 * old rows (order is load-bearing). `sql/087` then REVOKES two of the nine it
 * seeded; see below.
 *
 * ## Reachability in THIS base
 *
 * Nine keys today (`update` was the eighth, `sql/137`; `adjudicate_rights` is
 * the ninth, `sql/152`, Issue #794). ADR-0056 §A is why the count is not the
 * nine `awcms-mini`/`awcms-micro` carry PLUS these two: `attach`/`detach` were
 * REVOKED (`sql/087`). They described writes on a relation this module
 * stopped owning at ADR-0036 — a post's image is
 * `awcms_blog_posts.featured_media_id`, changed through `blog_content`'s
 * permission, not this module's. Both were seeded into a catalog every tenant
 * owner receives whole, while no route, function, or job ever checked them.
 *
 * Of the nine that remain, every one is enforced by real code:
 * `create`/`verify`/`cancel` by the presigned-upload flow
 * (`POST /api/v1/media/news-images/upload-sessions`, `.../{id}/finalize`,
 * `.../{id}/cancel`), `read` by `GET /api/v1/media/objects`, `update`/
 * `adjudicate_rights` by `PATCH /api/v1/media/objects/{id}`
 * (`src/pages/api/v1/media/objects/[id].ts`), and `delete`/`restore`/`purge`
 * by the object lifecycle endpoints (ADR-0056 §B). Adding a key means writing
 * the guard that checks it in the same change — a key declared "ahead of its
 * surface" is how the two revoked ones survived three waves of review looking
 * correct.
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
 * a soft-deletable resource (`blog_content`'s
 * `posts.create`/`.update`/`.delete`/`.restore`/`.purge`).
 */
export const MEDIA_PERMISSION_ACTIVITY_CODE = "media";

export const MEDIA_PERMISSIONS = {
  /** Create a pending media object metadata record (also gates starting a presigned upload session, Issue #634). */
  create: "media_library.media.create",
  /** Read media object metadata (list/detail). */
  read: "media_library.media.read",
  /** Mark an uploaded object verified (MIME/checksum/dimension check passed) — also gates the finalize endpoint, Issue #634. */
  verify: "media_library.media.verify",
  /**
   * Edit media object METADATA — the rights fields of Issue #615 (`sql/137`).
   *
   * The eighth key, and its surface landed in the same change, as the note
   * above requires. Deliberately not `verify`: that word already means the
   * BYTES passed a MIME/checksum check, and a licence decision is a person
   * answering a question about a contract. One word for both would make the
   * legal half read as done whenever a file sniffed clean.
   */
  update: "media_library.media.update",
  /**
   * Transition `rightsVerificationStatus` — the NINTH key (Issue #794,
   * `sql/152`), split OUT of `update` above.
   *
   * Since Issue #782/PR #791, `rightsVerificationStatus === 'verified'` makes
   * `creditLine`/`sourceName`/`copyrightStatus` cross into the PUBLIC
   * `GET /api/v1/media/objects` response (`resolvePublicMediaRightsFields`).
   * Before that PR the status was a purely internal editorial flag and one
   * permission for the whole rights form was harmless; after it, the same
   * permission let whoever could type a credit line also self-attest it
   * cleared for publication — no second reviewer, no distinct authority.
   *
   * `PATCH /api/v1/media/objects/{id}` requires this ADDITIONALLY to `update`
   * whenever the request body would touch a routine field AND the
   * verification status in the same call; a request that changes ONLY
   * `rightsVerificationStatus` requires this permission ALONE (see that
   * route's header for the full reasoning) — so a tenant can staff a
   * "rights reviewer" role that adjudicates without also being able to edit
   * the credit line it is adjudicating.
   *
   * Seeded with no default role grant beyond the standard new-tenant `owner`
   * catalogue inclusion every permission gets (`sql/152`'s own header) — no
   * OTHER role, and no EXISTING tenant, receives it without a deliberate
   * grant.
   */
  adjudicate_rights: "media_library.media.adjudicate_rights",
  /** Soft delete media object metadata. */
  delete: "media_library.media.delete",
  /** Restore a soft-deleted media object. */
  restore: "media_library.media.restore",
  /** Hard purge an already soft-deleted media object. */
  purge: "media_library.media.purge",
  /**
   * Abort one's own not-yet-uploaded upload session (Issue #634). New in
   * this issue — #633's original set (create/read/verify/delete/restore/purge,
   * plus the since-revoked attach/detach) had no "cancel" concept yet because
   * no upload session existed. Reuses the existing `AccessAction` union member
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
