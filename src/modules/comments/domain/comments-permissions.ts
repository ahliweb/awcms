/**
 * `comments` permission catalog constants (ADR-0041 §6, ported from awcms-micro
 * Issue #271) — the module key + activity codes the admin/moderation API guards
 * on and the sql/067 permission seed declares. Kept in `domain/` (pure, no
 * imports) so both the route handlers and the `module.ts` descriptor reference
 * the same literals.
 */
export const COMMENTS_MODULE_KEY = "comments";

/** Activity for moderation-queue read + approve/reject/spam/archive/restore/delete. */
export const COMMENTS_MODERATION_ACTIVITY_CODE = "moderation";

/** Activity for per-tenant comment configuration. */
export const COMMENTS_SETTINGS_ACTIVITY_CODE = "settings";
