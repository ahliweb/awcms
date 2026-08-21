/**
 * `site_profile` permission constants (Issue #596, ADR-0102).
 *
 * Single source of truth shared by the module descriptor, the route guards and
 * `sql/135`'s catalog seed — the three that must agree or a guard denies every
 * caller including the owner.
 */
export const SITE_PROFILE_MODULE_KEY = "site_profile";

export const SITE_PROFILE_ACTIVITY_CODE = "profile";

/**
 * `read` and `update` are separately grantable for the reason `sql/058` gives
 * for splitting `seo_distribution.config.*`: changing what every public page's
 * footer and contact block says is a different power from reading it.
 */
export const SITE_PROFILE_READ_GUARD = {
  moduleKey: SITE_PROFILE_MODULE_KEY,
  activityCode: SITE_PROFILE_ACTIVITY_CODE,
  action: "read" as const
};

export const SITE_PROFILE_UPDATE_GUARD = {
  moduleKey: SITE_PROFILE_MODULE_KEY,
  activityCode: SITE_PROFILE_ACTIVITY_CODE,
  action: "update" as const
};
