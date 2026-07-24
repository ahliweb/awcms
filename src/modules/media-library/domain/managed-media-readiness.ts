/**
 * Deployment-level readiness for MANAGED MEDIA (ADR-0036 ownership inversion) —
 * is this deployment's media infrastructure configured well enough for the
 * registry to be the only sanctioned source of media references?
 *
 * Pure — no `process.env` reads here; callers pass in whatever `env` they were
 * given. Same split as `media-r2-config.ts` itself and
 * `visitor-analytics/domain/visitor-analytics-config.ts`.
 *
 * ## Why this is carved out of `news-portal-preset-readiness.ts`
 *
 * That function answers ONE question by checking three unrelated facts:
 * `NEWS_PORTAL_ENABLED`, `NEWS_PORTAL_PROFILE` (both genuinely news_portal's own
 * "is my feature on" policy) and the `NEWS_MEDIA_R2_*` config block (media
 * infrastructure — which the sibling module move already relocated to
 * `media-library/domain/media-r2-config.ts`). Bundling them meant a tenant could
 * not have managed media without also running a news portal.
 *
 * This function is the media half, alone. `evaluateNewsPortalFullOnlineR2Readiness`
 * now COMPOSES it rather than re-deriving it — the reason codes below are
 * deliberately the SAME strings that function already returned, because they are
 * recorded in audit `attributes` and asserted by existing tests. Renaming them
 * would be a gratuitous break of a published signal for no gain.
 *
 * ## Deliberately NOT checked here
 *
 * Whether the TENANT wants enforcement. That is per-tenant state, not
 * deployment config, and lives in `application/media-library-tenant-state.ts`
 * (`sql/053`). Both must hold — this function alone is never sufficient to turn
 * enforcement on, or every tenant on an R2-configured deployment would be
 * silently opted in.
 */
import {
  findMissingNewsMediaR2Vars,
  findNewsMediaR2SeparationViolations,
  isNewsMediaR2Enabled
} from "./media-r2-config";

export type ManagedMediaReadinessReason =
  | "news_media_r2_disabled"
  | "news_media_r2_config_incomplete"
  | "news_media_r2_shares_sync_storage_bucket_or_credentials";

export type ManagedMediaReadinessResult = {
  ready: boolean;
  reasons: ManagedMediaReadinessReason[];
  /** Human-readable evidence, one entry per failing check — for audit `attributes`/report output. */
  detail: string[];
};

/**
 * `NEWS_MEDIA_R2_ENABLED=true` AND the R2 config complete AND separated from
 * `sync-storage`'s own R2 bucket/credentials (Keputusan kunci #1 — a shared
 * credential is the single-point-of-compromise the architecture doc §2 exists to
 * prevent). Fail-closed: any missing/ambiguous config yields `ready: false`.
 */
export function evaluateManagedMediaReadiness(
  env: NodeJS.ProcessEnv = process.env
): ManagedMediaReadinessResult {
  const reasons: ManagedMediaReadinessReason[] = [];
  const detail: string[] = [];

  if (!isNewsMediaR2Enabled(env)) {
    reasons.push("news_media_r2_disabled");
    detail.push(
      'NEWS_MEDIA_R2_ENABLED is not "true" — managed media requires the R2-only media mode to be active (no local-storage alternative exists in this mode).'
    );

    return { ready: false, reasons, detail };
  }

  const missing = findMissingNewsMediaR2Vars(env);
  if (missing.length > 0) {
    reasons.push("news_media_r2_config_incomplete");
    detail.push(
      `NEWS_MEDIA_R2_ENABLED=true but required var(s) missing: ${missing.join(", ")}.`
    );
  }

  const violations = findNewsMediaR2SeparationViolations(env);
  if (violations.length > 0) {
    reasons.push("news_media_r2_shares_sync_storage_bucket_or_credentials");
    detail.push(
      `NEWS_MEDIA_R2_* must never share a bucket or credential with sync-storage's own R2_* vars (Issue #631 architecture doc §2): ${violations.join(", ")}.`
    );
  }

  return { ready: reasons.length === 0, reasons, detail };
}
