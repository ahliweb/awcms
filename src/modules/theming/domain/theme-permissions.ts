/**
 * `theming` permission constants (Issue #269, ADR-0029 §8). Mirrors the seeded
 * rows in `sql/034` exactly — the module's `permissions` descriptor and every
 * route guard reference these constants rather than re-typing the literals, so a
 * rename can never drift one copy from another (same convention every module's
 * `*-permissions.ts` uses).
 */
export const THEMING_MODULE_KEY = "theming";

/** Read theme state/descriptors/version history; edit the draft config/selections. */
export const THEMING_CONFIG_ACTIVITY_CODE = "config";
export type ThemingConfigAction = "read" | "update";

/** Publish a draft to an immutable version; rollback (restore) to a prior version; retire (archive) the active theme. */
export const THEMING_VERSION_ACTIVITY_CODE = "version";
export type ThemingVersionAction = "publish" | "restore" | "archive";

/** Create a short-lived, authorized preview session. */
export const THEMING_PREVIEW_ACTIVITY_CODE = "preview";
export type ThemingPreviewAction = "create";
