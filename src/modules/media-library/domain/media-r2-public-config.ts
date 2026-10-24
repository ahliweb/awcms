/**
 * The NON-credential half of the `NEWS_MEDIA_R2_*` configuration (Issue #1132).
 *
 * `media-r2-config.ts` resolves the whole block, including the R2 access key pair.
 * A scheduled job that only needs the public base URL (`blog:ads:ingest` builds
 * an object's URL from it and nothing else) would therefore import a file that
 * reads the credentials, and `ops/run-job.sh` hands a job every secret its import
 * graph can reach (Issue #1120). This file reads the settings and NEVER a
 * credential, and imports nothing that does, so a job that imports only this
 * file is not granted `NEWS_MEDIA_R2_ACCESS_KEY_ID` / `NEWS_MEDIA_R2_SECRET_ACCESS_KEY`.
 *
 * Do not add a credential read here, and do not import `media-r2-config.ts` or
 * `media-r2-separation.ts` from here: `tests/jobs-env-scoped-reach.test.ts` holds
 * the job grants to the import graph and fails on the first such edge. The full
 * resolver, `resolveNewsMediaR2Config()`, composes this one with the credential
 * pair, so the two cannot drift: every non-credential field comes from here.
 *
 * Pure — no `process.env` reads outside the `env` argument.
 */

export const NEWS_MEDIA_R2_DEFAULT_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
] as const;

/** SVG is deliberately excluded by default — see architecture doc §9 (XSS via embedded `<script>`). */
export const NEWS_MEDIA_R2_DISALLOWED_MIME_TYPE_DEFAULT = "image/svg+xml";

/**
 * Every MIME type this codebase actually knows how to reason about for
 * `NEWS_MEDIA_R2_ALLOWED_MIME_TYPES` (Issue #635): the four raster types
 * `news-media-mime-sniffer.ts` can sniff from magic bytes, PLUS
 * `image/svg+xml` (excluded by default above, but a real, deliberate
 * override path exists for it — `checkNewsMediaR2SvgNotAllowed`,
 * `scripts/security-readiness.ts` — so it belongs in the "known" set, not
 * the "unknown/unsafe" one). An operator listing anything OUTSIDE this set
 * (`text/html`, `application/octet-stream`, a typo, ...) has misconfigured
 * the allow-list: the sniffer can never accept such an upload (every real
 * upload would fail-safe reject at `finalize`), so config:validate treats
 * it as a hard error rather than a silent no-op, per Issue #635's
 * acceptance criteria ("Allowed MIME types include unsafe/non-image
 * types").
 */
export const NEWS_MEDIA_R2_KNOWN_MIME_TYPES = [
  ...NEWS_MEDIA_R2_DEFAULT_ALLOWED_MIME_TYPES,
  NEWS_MEDIA_R2_DISALLOWED_MIME_TYPE_DEFAULT
] as const;

/**
 * Upper bound for `NEWS_MEDIA_R2_PRESIGNED_UPLOAD_TTL_SECONDS` (Issue #635).
 * Architecture doc §8 describes the default (300s/5min) as "short-lived —
 * enough for one interactive upload, too short to be useful to a leaked
 * URL long after being generated." A presigned PUT URL is not single-use
 * (§8's own residual-risk note), so the whole TTL-based mitigation
 * degrades the longer the window is — 1 hour is a generous ceiling that
 * still keeps that property meaningful (an operator who needs longer has a
 * different problem, e.g. a slow client upload path, not a config this
 * check should silently accommodate).
 */
export const NEWS_MEDIA_R2_MAX_PRESIGNED_UPLOAD_TTL_SECONDS = 3600;

/**
 * Floor for `NEWS_MEDIA_R2_ORPHAN_GRACE_DAYS` (Issue #690,
 * `r2-backup-lifecycle.md` §3: "Masa tenggang minimum 30 hari sebelum hapus
 * fisik, dapat dikonfigurasi operator"). Unlike
 * `NEWS_MEDIA_R2_MAX_PRESIGNED_UPLOAD_TTL_SECONDS` (a ceiling), this is a
 * FLOOR — the doc's own "minimum 30 hari" language, not a suggested default
 * an operator is free to shrink arbitrarily. `isOrphanGraceTooShort` reports
 * a value below this as unsafe (`security:readiness`, warning severity —
 * same non-blocking-but-flagged pattern as `isPresignedUploadTtlTooLong`).
 */
export const NEWS_MEDIA_R2_MIN_ORPHAN_GRACE_DAYS = 30;

export const NEWS_MEDIA_R2_DEFAULTS = {
  enabled: false,
  presignedUploadTtlSeconds: 300,
  maxUploadBytes: 10_485_760,
  allowedMimeTypes: [...NEWS_MEDIA_R2_DEFAULT_ALLOWED_MIME_TYPES] as string[],
  pendingTtlMinutes: 60,
  orphanGraceDays: NEWS_MEDIA_R2_MIN_ORPHAN_GRACE_DAYS
} as const;

export type NewsMediaR2PublicConfig = {
  enabled: boolean;
  accountId: string;
  bucket: string;
  publicBaseUrl: string;
  presignedUploadTtlSeconds: number;
  maxUploadBytes: number;
  allowedMimeTypes: string[];
  pendingTtlMinutes: number;
  /** Grace period (days) between a media object becoming `orphaned` and `scripts/news-media-r2-reconcile.ts` (Issue #690) physically deleting its R2 object + soft-deleting its metadata row (`r2-backup-lifecycle.md` §3). Also reused as the age threshold (against the R2-reported `lastModified`) before that same job will physically delete an "orphan-in-R2" object (a bucket object with no matching metadata row at all — see that script's own header for why one config knob covers both cases). */
  orphanGraceDays: number;
};

function isSet(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!isSet(value)) return fallback;
  return value === "true";
}

/** `undefined` when unset/blank/non-positive-integer — never throws, never NaN. */
export function parsePositiveInt(
  value: string | undefined
): number | undefined {
  if (!isSet(value)) return undefined;

  const trimmed = (value as string).trim();

  if (!/^\d+$/.test(trimmed)) return undefined;

  const parsed = Number.parseInt(trimmed, 10);

  return parsed > 0 ? parsed : undefined;
}

function parseMimeList(value: string | undefined): string[] {
  if (!isSet(value)) return [...NEWS_MEDIA_R2_DEFAULTS.allowedMimeTypes];

  return (value as string)
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * Everything in `NewsMediaR2Config` except the access key pair. Falls back to
 * `NEWS_MEDIA_R2_DEFAULTS` for anything unset/malformed and never throws —
 * malformed values are reported by `checkNewsMediaR2Config`
 * (`scripts/validate-env.ts`), not here.
 */
export function resolveNewsMediaR2PublicConfig(
  env: NodeJS.ProcessEnv = process.env
): NewsMediaR2PublicConfig {
  return {
    enabled: parseBoolean(
      env.NEWS_MEDIA_R2_ENABLED,
      NEWS_MEDIA_R2_DEFAULTS.enabled
    ),
    accountId: env.NEWS_MEDIA_R2_ACCOUNT_ID ?? "",
    bucket: env.NEWS_MEDIA_R2_BUCKET ?? "",
    publicBaseUrl: env.NEWS_MEDIA_R2_PUBLIC_BASE_URL ?? "",
    presignedUploadTtlSeconds:
      parsePositiveInt(env.NEWS_MEDIA_R2_PRESIGNED_UPLOAD_TTL_SECONDS) ??
      NEWS_MEDIA_R2_DEFAULTS.presignedUploadTtlSeconds,
    maxUploadBytes:
      parsePositiveInt(env.NEWS_MEDIA_R2_MAX_UPLOAD_BYTES) ??
      NEWS_MEDIA_R2_DEFAULTS.maxUploadBytes,
    allowedMimeTypes: parseMimeList(env.NEWS_MEDIA_R2_ALLOWED_MIME_TYPES),
    pendingTtlMinutes:
      parsePositiveInt(env.NEWS_MEDIA_R2_PENDING_TTL_MINUTES) ??
      NEWS_MEDIA_R2_DEFAULTS.pendingTtlMinutes,
    orphanGraceDays:
      parsePositiveInt(env.NEWS_MEDIA_R2_ORPHAN_GRACE_DAYS) ??
      NEWS_MEDIA_R2_DEFAULTS.orphanGraceDays
  };
}
