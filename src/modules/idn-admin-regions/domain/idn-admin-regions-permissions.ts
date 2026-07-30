/**
 * Permission vocabulary for `idn_admin_regions` (ADR-0046, seeded by
 * `sql/081`). Keys are composed by `module-management`'s `keyOf` as
 * `${moduleKey}.${activityCode}.${action}`.
 *
 * The two lifecycle actions map onto EXISTING `AccessAction` literals on
 * purpose: activate -> `configure`, rollback -> `restore`. Inventing an
 * `activate`/`rollback` literal would widen the union and plant a latent-authz
 * trap — an action no role seeds denies even the tenant owner while the calling
 * code looks perfectly correct.
 */
export const IDN_ADMIN_REGIONS_MODULE_KEY = "idn_admin_regions";

/** Region lookup (the hierarchy itself). */
export const IDN_REGION_ACTIVITY_CODE = "region";

/** Dataset versions: their provenance and their lifecycle. */
export const IDN_DATASET_ACTIVITY_CODE = "dataset";

/** Fully-composed keys, for guards and tests that must not re-derive the string. */
export const IDN_ADMIN_REGIONS_PERMISSIONS = {
  regionRead: `${IDN_ADMIN_REGIONS_MODULE_KEY}.${IDN_REGION_ACTIVITY_CODE}.read`,
  datasetRead: `${IDN_ADMIN_REGIONS_MODULE_KEY}.${IDN_DATASET_ACTIVITY_CODE}.read`,
  datasetActivate: `${IDN_ADMIN_REGIONS_MODULE_KEY}.${IDN_DATASET_ACTIVITY_CODE}.configure`,
  datasetRollback: `${IDN_ADMIN_REGIONS_MODULE_KEY}.${IDN_DATASET_ACTIVITY_CODE}.restore`
} as const;
