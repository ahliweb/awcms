/**
 * The `NEWS_MEDIA_R2_*` / `sync-storage` `R2_*` separation check (Issue #631
 * architecture doc §2, "Keputusan kunci #1"), in a file of its own (Issue #1132).
 *
 * It is the one place that reads BOTH credential pairs: it compares the news-media
 * access key pair against `sync-storage`'s own `R2_ACCESS_KEY_ID` /
 * `R2_SECRET_ACCESS_KEY` for equality. `ops/run-job.sh` hands a job every secret
 * its import graph can reach (Issue #1120), so keeping the comparison apart from
 * `media-r2-config.ts` means a job that merely resolves the media config
 * (`news-media:reconcile`) is not granted the `sync-storage` pair. Only
 * `managed-media-readiness.ts` imports this file, and so only the jobs that
 * evaluate deployment readiness (`blog:publish:scheduled`) receive that pair.
 *
 * Pure — no `process.env` reads outside the `env` argument.
 */

function isSet(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Keputusan kunci #1 (`.claude/skills/awcms-news-portal/SKILL.md`,
 * architecture doc §2): news-media R2 bucket/credentials MUST be separate
 * from `sync-storage`'s own `R2_*` vars (Issue #436). Compares whichever
 * of the two pairs is actually set — an unset `sync-storage` R2 var never
 * produces a false "collision" (both sides empty-string would otherwise
 * look "equal").
 */
export type NewsMediaR2SeparationViolation =
  | "bucket_shared_with_sync_r2"
  | "access_key_id_shared_with_sync_r2"
  | "secret_access_key_shared_with_sync_r2";

export function findNewsMediaR2SeparationViolations(
  env: NodeJS.ProcessEnv = process.env
): NewsMediaR2SeparationViolation[] {
  const violations: NewsMediaR2SeparationViolation[] = [];

  const newsBucket = env.NEWS_MEDIA_R2_BUCKET;
  const syncBucket = env.R2_BUCKET;
  if (isSet(newsBucket) && isSet(syncBucket) && newsBucket === syncBucket) {
    violations.push("bucket_shared_with_sync_r2");
  }

  const newsAccessKeyId = env.NEWS_MEDIA_R2_ACCESS_KEY_ID;
  const syncAccessKeyId = env.R2_ACCESS_KEY_ID;
  if (
    isSet(newsAccessKeyId) &&
    isSet(syncAccessKeyId) &&
    newsAccessKeyId === syncAccessKeyId
  ) {
    violations.push("access_key_id_shared_with_sync_r2");
  }

  const newsSecretAccessKey = env.NEWS_MEDIA_R2_SECRET_ACCESS_KEY;
  const syncSecretAccessKey = env.R2_SECRET_ACCESS_KEY;
  if (
    isSet(newsSecretAccessKey) &&
    isSet(syncSecretAccessKey) &&
    newsSecretAccessKey === syncSecretAccessKey
  ) {
    violations.push("secret_access_key_shared_with_sync_r2");
  }

  return violations;
}
