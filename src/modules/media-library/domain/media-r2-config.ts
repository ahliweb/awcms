/**
 * `NEWS_MEDIA_R2_*` configuration gate (Issue #632, epic `news_portal`
 * #631-#642/#649). Pure — no `process.env` reads here; callers
 * (`scripts/validate-env.ts`, `scripts/security-readiness.ts`,
 * `application/apply-news-portal-preset.ts`) pass in whatever `env` they
 * were given. Same split as `visitor-analytics/domain/visitor-analytics-config.ts`
 * and `email/domain/email-config.ts`.
 *
 * ## Naming — a deliberate deviation from Issue #632's own body text
 *
 * Issue #632's body literally lists `CLOUDFLARE_ACCOUNT_ID`,
 * `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_NEWS_IMAGE_BUCKET`,
 * `R2_NEWS_IMAGE_PUBLIC_BASE_URL`, etc. **This file intentionally does
 * NOT use those names.** `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` are the
 * EXACT names `sync-storage` already uses (`object-storage-uploader.ts`,
 * Issue #436) for its own, unrelated, *private* object queue bucket. Reusing
 * them here would make news-portal media and sync-storage share literally
 * the same credential — precisely the single-point-of-compromise risk
 * Issue #631's architecture doc was written to prevent (see
 * `docs/awcms-mini/news-portal/full-online-r2-architecture.md` §2,
 * "Keputusan kunci #1" in `.claude/skills/awcms-news-portal/SKILL.md`).
 *
 * Every var below instead follows §4 of that document EXACTLY as written
 * there (`NEWS_MEDIA_R2_*` prefix) — this is the authoritative source, not
 * the issue body. Note the architecture doc's §4 table does NOT include a
 * separate `NEWS_MEDIA_R2_CUSTOM_DOMAIN` var (§11 clarifies
 * `NEWS_MEDIA_R2_PUBLIC_BASE_URL` already IS the custom-domain URL) — this
 * file follows the doc, not a broader reading of the issue body.
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

/**
 * Required only when `NEWS_MEDIA_R2_ENABLED=true` — mirrors
 * `R2_REQUIRED_WHEN_ENABLED` in `scripts/validate-env.ts` (the existing
 * `sync-storage` R2 conditional check), same shape, different var names,
 * one extra key (`NEWS_MEDIA_R2_PUBLIC_BASE_URL` — news media is public by
 * design, sync-storage's bucket never is, so it has no public-base-URL
 * concept at all).
 */
export const NEWS_MEDIA_R2_REQUIRED_WHEN_ENABLED = [
  "NEWS_MEDIA_R2_ACCOUNT_ID",
  "NEWS_MEDIA_R2_ACCESS_KEY_ID",
  "NEWS_MEDIA_R2_SECRET_ACCESS_KEY",
  "NEWS_MEDIA_R2_BUCKET",
  "NEWS_MEDIA_R2_PUBLIC_BASE_URL"
] as const;

export type NewsMediaR2Config = {
  enabled: boolean;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
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
 * Resolves the full config from `env`, falling back to
 * `NEWS_MEDIA_R2_DEFAULTS` for anything unset/malformed. Never throws —
 * malformed values are reported by `checkNewsMediaR2Config`
 * (`scripts/validate-env.ts`), not here.
 */
export function resolveNewsMediaR2Config(
  env: NodeJS.ProcessEnv = process.env
): NewsMediaR2Config {
  return {
    enabled: parseBoolean(
      env.NEWS_MEDIA_R2_ENABLED,
      NEWS_MEDIA_R2_DEFAULTS.enabled
    ),
    accountId: env.NEWS_MEDIA_R2_ACCOUNT_ID ?? "",
    accessKeyId: env.NEWS_MEDIA_R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.NEWS_MEDIA_R2_SECRET_ACCESS_KEY ?? "",
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

export function isNewsMediaR2Enabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return resolveNewsMediaR2Config(env).enabled;
}

/**
 * Required keys missing/empty when `NEWS_MEDIA_R2_ENABLED=true`. Empty
 * array when disabled (nothing required) or fully configured.
 */
export function findMissingNewsMediaR2Vars(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  if (env.NEWS_MEDIA_R2_ENABLED !== "true") return [];

  return NEWS_MEDIA_R2_REQUIRED_WHEN_ENABLED.filter(
    (name) => !isSet(env[name])
  );
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

/** `true` when the configured allow-list contains the disallowed-by-default SVG MIME type. */
export function allowsSvgMimeType(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return resolveNewsMediaR2Config(env).allowedMimeTypes.includes(
    NEWS_MEDIA_R2_DISALLOWED_MIME_TYPE_DEFAULT
  );
}

/**
 * Allow-list entries outside `NEWS_MEDIA_R2_KNOWN_MIME_TYPES` (Issue #635)
 * — misconfigured/unsafe/non-image entries the MIME sniffer could never
 * accept regardless. Empty when disabled or fully within the known set.
 */
export function findUnknownNewsMediaR2MimeTypes(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  if (env.NEWS_MEDIA_R2_ENABLED !== "true") return [];

  const known: readonly string[] = NEWS_MEDIA_R2_KNOWN_MIME_TYPES;

  return resolveNewsMediaR2Config(env).allowedMimeTypes.filter(
    (mimeType) => !known.includes(mimeType)
  );
}

/**
 * `true` when `NEWS_MEDIA_R2_PRESIGNED_UPLOAD_TTL_SECONDS` exceeds
 * `NEWS_MEDIA_R2_MAX_PRESIGNED_UPLOAD_TTL_SECONDS` (Issue #635). `false`
 * when disabled or unset (falls back to the safe default).
 */
export function isPresignedUploadTtlTooLong(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (env.NEWS_MEDIA_R2_ENABLED !== "true") return false;

  return (
    resolveNewsMediaR2Config(env).presignedUploadTtlSeconds >
    NEWS_MEDIA_R2_MAX_PRESIGNED_UPLOAD_TTL_SECONDS
  );
}

/**
 * `true` when `NEWS_MEDIA_R2_ORPHAN_GRACE_DAYS` is set below
 * `NEWS_MEDIA_R2_MIN_ORPHAN_GRACE_DAYS` (Issue #690, `r2-backup-lifecycle.md`
 * §3's "minimum 30 hari"). `false` when disabled or unset (falls back to the
 * safe default, which already equals the floor).
 */
export function isOrphanGraceTooShort(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (env.NEWS_MEDIA_R2_ENABLED !== "true") return false;

  return (
    resolveNewsMediaR2Config(env).orphanGraceDays <
    NEWS_MEDIA_R2_MIN_ORPHAN_GRACE_DAYS
  );
}

/**
 * A trailing "." makes a hostname a fully-qualified DNS name that
 * resolves IDENTICALLY to the same name without the dot (DNS root label —
 * `abc.r2.dev.` and `abc.r2.dev` are the same host to any resolver/
 * browser), but `new URL(...).hostname` preserves it literally, which
 * would otherwise let a one-character trailing-dot variant silently slip
 * past both the `.r2.dev` suffix check and the exact loopback-string
 * checks below (reviewer + security-auditor finding, PR #665 re-review).
 * Normalize it away before either check runs.
 */
function stripTrailingDot(hostname: string): string {
  return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
}

/**
 * Hostnames Cloudflare R2 assigns automatically for a bucket that has NO
 * custom domain mapped — architecture doc §11: "bukan URL `r2.dev` bawaan
 * (yang tidak stabil untuk produksi dan tidak mendukung caching/branding
 * kustom)". Matches the exact `<bucket-hash>.r2.dev` pattern R2 issues,
 * not merely "contains r2.dev" (avoids a false positive against a
 * legitimate custom domain that happens to contain that substring
 * elsewhere in its path).
 */
function isR2DevHost(hostname: string): boolean {
  return /\.r2\.dev$/i.test(stripTrailingDot(hostname));
}

/**
 * Loopback hosts — never a legitimate production public media domain.
 * Covers IPv4 (`127.0.0.1`, unbracketed), IPv6 (`::1`, both bracketed
 * `[::1]` — the form `new URL(...).hostname` actually returns for an IPv6
 * host — and unbracketed), `0.0.0.0` (binds-to-all-interfaces, not a
 * routable address either), and `localhost`, all case-insensitively
 * (IPv6 literals are lowercased by `URL` already, but `localhost` is not).
 */
function isLoopbackHost(hostname: string): boolean {
  const normalized = stripTrailingDot(hostname).toLowerCase();

  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

export type NewsMediaR2PublicBaseUrlProductionUnsafeReason =
  "r2_dev_default_domain" | "loopback_host" | "unparseable_url";

/**
 * `null` when the URL is safe for production use (or n/a — see callers);
 * otherwise the specific reason it is NOT safe (Issue #635, architecture
 * doc §11). Pure URL-hostname inspection — does not itself decide whether
 * "production" applies; callers (`security-readiness.ts`) gate that on
 * `APP_ENV === "production"`.
 */
export function findNewsMediaR2PublicBaseUrlProductionUnsafeReason(
  publicBaseUrl: string
): NewsMediaR2PublicBaseUrlProductionUnsafeReason | null {
  let hostname: string;

  try {
    hostname = new URL(publicBaseUrl).hostname;
  } catch {
    return "unparseable_url";
  }

  if (isLoopbackHost(hostname)) return "loopback_host";
  if (isR2DevHost(hostname)) return "r2_dev_default_domain";

  return null;
}
