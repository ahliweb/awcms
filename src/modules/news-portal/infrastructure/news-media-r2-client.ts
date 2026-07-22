/**
 * Cloudflare R2 client for the news-media presigned upload flow (Issue #634,
 * epic `news_portal`). `Bun.S3Client` (Bun-native, S3-API-compatible — R2 is
 * S3-compatible; no npm AWS/S3 SDK per project constraint), same pattern as
 * `sync-storage/infrastructure/object-storage-uploader.ts`: circuit breaker
 * + timeout around every real network call. Deliberately a SEPARATE
 * provider-circuit-breaker key (`news-media-r2`, not `object-storage`) so an
 * outage in one bucket/credential pair never trips the breaker for the
 * other — matching "Keputusan kunci #1" (separate bucket/credentials from
 * `sync-storage`) in `.claude/skills/awcms-news-portal/SKILL.md`.
 *
 * Every method here is called strictly OUTSIDE any DB transaction by its
 * caller (route handlers under `src/pages/api/v1/media/news-images/`) —
 * ADR-0006. `presignUploadUrl` is a pure, local HMAC signature computation
 * (no network round-trip at all), but is still kept out of any `withTenant`/
 * `sql.begin` block for the same reason: this file is the one and only
 * place that touches R2 credentials/config, and keeping that discipline
 * uniform (rather than "only the genuinely-networked calls count") avoids
 * a future refactor accidentally moving a real network call inside a
 * transaction by analogy with this one. `listObjects`/`deleteObject`
 * (Issue #690, epic #679 — R2 lifecycle cleanup & reconciliation job) are no
 * exception: `scripts/news-media-r2-reconcile.ts` calls both strictly
 * between (never inside) its per-tenant `withTenant` transactions.
 *
 * ## `listObjects`/`deleteObject` (Issue #690)
 *
 * Added for `scripts/news-media-r2-reconcile.ts`'s dry-run-first
 * reconciliation between this table's metadata and the R2 bucket's actual
 * contents. Same circuit breaker + timeout + truncated-error discipline as
 * every other method here — a reconciliation run against an R2 outage must
 * fail safely (report the provider error, skip that tenant/page, never
 * crash the whole job or block unrelated DB-only work), not retry forever
 * or throw an unhandled rejection.
 *
 * `listObjects` wraps `Bun.S3Client.list()` (a real `ListObjectsV2` call —
 * paginated via `continuationToken`/`nextContinuationToken`, exactly the S3
 * REST API shape, verified empirically against a fake local XML-serving
 * `Bun.serve()` server the same way `tests/unit/news-media-r2-client.test.ts`
 * already does for `headObject`/`getObject`). `deleteObject` wraps
 * `Bun.S3Client.file(key).delete()` — real S3/R2 `DELETE` semantics are
 * already idempotent (deleting an already-absent key succeeds, per the S3
 * API spec), so this method does not itself special-case "not found" as
 * success; a genuine HTTP-level failure (5xx, timeout, network error) is
 * the only path that reports `ok: false`.
 *
 * ## `getObject` streaming size cap (security-auditor Critical finding, PR #653 review)
 *
 * `getObject` used to be a single `file.arrayBuffer()` call — buffer
 * everything, THEN let the caller check the size. That is a TOCTOU hole: a
 * presigned PUT URL is not single-use, so between a `headObject` call
 * reporting a small size and this `getObject` call actually running, an
 * attacker can re-PUT a multi-gigabyte object to the SAME key (still
 * starting with valid image magic bytes, so the MIME sniff would still
 * pass). `file.arrayBuffer()` would then buffer the ENTIRE object into the
 * Bun process's memory — a process that serves every tenant — before this
 * function ever gets a chance to reject it for size. `getObject` now reads
 * the object as a stream (`S3File.stream()`) and aborts (cancels the
 * stream) the moment the running total exceeds `maxBytes`, WITHOUT ever
 * buffering more than `maxBytes` worth of chunks. `headObject`'s own size
 * check is kept as a cheap fast-path (skip an attempt entirely for an
 * object R2 already reports as too big), but it is no longer the only line
 * of defense — the real enforcement now happens during the read itself.
 */
import { getProviderCircuitBreaker } from "../../../lib/database/circuit-breaker";
import { withTimeout } from "../../../lib/integration/timeout";

const PROVIDER_KEY = "news-media-r2";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_ERROR_MESSAGE_LENGTH = 500;

function truncateError(message: string): string {
  return message.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
    : message;
}

export type NewsMediaR2ClientConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Override for tests only (a local fake S3-compatible HTTP server — same convention as `object-storage-uploader.ts`'s `R2UploaderConfig.endpoint`). */
  endpoint?: string;
  timeoutMs?: number;
};

export type NewsMediaR2PresignUploadInput = {
  objectKey: string;
  mimeType: string;
  ttlSeconds: number;
};

export type NewsMediaR2HeadResult =
  | { ok: true; exists: true; sizeBytes: number }
  | { ok: true; exists: false }
  | { ok: false; error: string };

export type NewsMediaR2GetResult =
  | { ok: true; sizeExceeded: false; bytes: Uint8Array }
  | { ok: true; sizeExceeded: true }
  | { ok: false; error: string };

export type NewsMediaR2ObjectSummary = {
  key: string;
  /** `undefined` only if R2 itself omits it from the listing response — never expected in practice, but not assumed. */
  sizeBytes?: number;
  /** ISO 8601 string, as reported by R2's `LastModified` — used as the age signal for "orphan-in-R2" objects (no matching DB row, so no DB-side timestamp exists), never parsed as a source of truth about DB state. */
  lastModified?: string;
};

export type NewsMediaR2ListObjectsInput = {
  prefix: string;
  continuationToken?: string;
  maxKeys?: number;
};

export type NewsMediaR2ListObjectsResult =
  | {
      ok: true;
      objects: NewsMediaR2ObjectSummary[];
      isTruncated: boolean;
      /** Present iff `isTruncated` — pass back in as `continuationToken` for the next page. */
      nextContinuationToken?: string;
    }
  | { ok: false; error: string };

export type NewsMediaR2DeleteResult =
  { ok: true } | { ok: false; error: string };

export type NewsMediaR2Client = {
  /**
   * Presigned `PUT` URL scoped to exactly one server-generated object key,
   * expiring after `ttlSeconds` — never includes raw R2 credentials, only a
   * signed URL (`full-online-r2-architecture.md` §8).
   */
  presignUploadUrl(input: NewsMediaR2PresignUploadInput): string;
  /**
   * Cheap existence + size check (§9 step 1) — a fast-path only. An object
   * this reports as within-bounds is NOT trusted on its own; `getObject`
   * re-enforces the size cap itself against the bytes it actually reads,
   * because this value can be stale by the time `getObject` runs (a
   * presigned PUT URL can be reused to overwrite the same key).
   */
  headObject(objectKey: string): Promise<NewsMediaR2HeadResult>;
  /**
   * Full object `GET` (§9 steps 2/5), read as a stream and capped at
   * `maxBytes` — the read is aborted the moment the running total exceeds
   * `maxBytes`, without ever buffering more than that much (see this
   * module's header). Returns `{ ok: true, sizeExceeded: true }` (no
   * `bytes`) rather than throwing, so a legitimately-oversized/maliciously
   * swapped object is a normal rejection outcome, not an error path.
   */
  getObject(objectKey: string, maxBytes: number): Promise<NewsMediaR2GetResult>;
  /**
   * Lists (up to) `input.maxKeys` (R2/S3 default 1000) objects under
   * `input.prefix` — Issue #690's reconciliation job always scopes this to
   * a single tenant's own prefix (`news-media/{tenantId}/`), never an
   * unscoped bucket-wide listing, even though the bucket itself has no
   * tenant-level access control of its own (R2 credentials are shared
   * across tenants for this bucket — the object KEY prefix is the only
   * tenant boundary at the storage layer). Paginate by passing the previous
   * call's `nextContinuationToken` back in as `input.continuationToken`
   * until `isTruncated` is `false`.
   */
  listObjects(
    input: NewsMediaR2ListObjectsInput
  ): Promise<NewsMediaR2ListObjectsResult>;
  /**
   * Deletes one object by key. Idempotent by the underlying S3/R2 API's own
   * semantics (deleting an already-absent key is not an error) — this
   * method does not add its own "already gone" special case on top.
   */
  deleteObject(objectKey: string): Promise<NewsMediaR2DeleteResult>;
};

/**
 * Reads `stream` incrementally, accumulating chunks only up to `maxBytes`.
 * The instant the running total exceeds `maxBytes`, the stream is cancelled
 * and `null` is returned — chunks already buffered are dropped and no
 * further reads happen, so memory use is bounded at (at most) `maxBytes`
 * plus one chunk, never the full object size.
 */
// Exported for direct, network-independent unit testing (`readCappedStream`
// against a synthetic `ReadableStream` proves the abort-before-fully-
// buffering property deterministically — going only through a real
// `Bun.S3Client`/loopback HTTP server is not reliable for this, since OS/Bun
// socket-level read-ahead buffering can race far ahead of this function's
// own per-chunk consumption on a fast local link, independent of whether
// this function's cap logic is correct).
export async function readCappedStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number
): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;
    if (!value || value.byteLength === 0) continue;

    total += value.byteLength;

    if (total > maxBytes) {
      await reader
        .cancel("news-media-r2: object exceeds maxUploadBytes, aborting read")
        .catch(() => {
          // Best-effort — the read is already being abandoned either way.
        });
      return null;
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

export function createNewsMediaR2Client(
  config: NewsMediaR2ClientConfig
): NewsMediaR2Client {
  const endpoint =
    config.endpoint ?? `https://${config.accountId}.r2.cloudflarestorage.com`;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client = new Bun.S3Client({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket,
    endpoint,
    region: "auto"
  });
  const breaker = getProviderCircuitBreaker(PROVIDER_KEY);

  return {
    presignUploadUrl({ objectKey, mimeType, ttlSeconds }) {
      return client.file(objectKey).presign({
        method: "PUT",
        expiresIn: ttlSeconds,
        type: mimeType
      });
    },

    async headObject(objectKey) {
      const attemptedAt = new Date();

      if (!breaker.canAttempt(attemptedAt)) {
        return {
          ok: false,
          error: "News media R2 circuit breaker is open; skipping attempt."
        };
      }

      try {
        const file = client.file(objectKey);
        const exists = await withTimeout(
          file.exists(),
          timeoutMs,
          `news-media-r2 HEAD exists ${objectKey}`
        );

        if (!exists) {
          // A clean "not found" answer is a successful HEAD call, not a
          // provider malfunction — never trips the breaker.
          breaker.recordSuccess(new Date());
          return { ok: true, exists: false };
        }

        const stat = await withTimeout(
          file.stat(),
          timeoutMs,
          `news-media-r2 HEAD stat ${objectKey}`
        );

        breaker.recordSuccess(new Date());
        return { ok: true, exists: true, sizeBytes: stat.size };
      } catch (error) {
        breaker.recordFailure(new Date());
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: truncateError(message) };
      }
    },

    async getObject(objectKey, maxBytes) {
      const attemptedAt = new Date();

      if (!breaker.canAttempt(attemptedAt)) {
        return {
          ok: false,
          error: "News media R2 circuit breaker is open; skipping attempt."
        };
      }

      try {
        const file = client.file(objectKey);
        const bytes = await withTimeout(
          readCappedStream(file.stream(), maxBytes),
          timeoutMs,
          `news-media-r2 GET ${objectKey}`
        );

        breaker.recordSuccess(new Date());

        if (bytes === null) {
          return { ok: true, sizeExceeded: true };
        }

        return { ok: true, sizeExceeded: false, bytes };
      } catch (error) {
        breaker.recordFailure(new Date());
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: truncateError(message) };
      }
    },

    async listObjects({ prefix, continuationToken, maxKeys }) {
      const attemptedAt = new Date();

      if (!breaker.canAttempt(attemptedAt)) {
        return {
          ok: false,
          error: "News media R2 circuit breaker is open; skipping attempt."
        };
      }

      try {
        const response = await withTimeout(
          client.list({ prefix, continuationToken, maxKeys }),
          timeoutMs,
          `news-media-r2 LIST ${prefix}`
        );

        breaker.recordSuccess(new Date());

        const objects: NewsMediaR2ObjectSummary[] = (
          response.contents ?? []
        ).map((entry) => ({
          key: entry.key,
          sizeBytes: entry.size,
          lastModified: entry.lastModified
        }));

        return {
          ok: true,
          objects,
          isTruncated: response.isTruncated ?? false,
          nextContinuationToken: response.isTruncated
            ? response.nextContinuationToken
            : undefined
        };
      } catch (error) {
        breaker.recordFailure(new Date());
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: truncateError(message) };
      }
    },

    async deleteObject(objectKey) {
      const attemptedAt = new Date();

      if (!breaker.canAttempt(attemptedAt)) {
        return {
          ok: false,
          error: "News media R2 circuit breaker is open; skipping attempt."
        };
      }

      try {
        await withTimeout(
          client.file(objectKey).delete(),
          timeoutMs,
          `news-media-r2 DELETE ${objectKey}`
        );

        breaker.recordSuccess(new Date());
        return { ok: true };
      } catch (error) {
        breaker.recordFailure(new Date());
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: truncateError(message) };
      }
    }
  };
}
