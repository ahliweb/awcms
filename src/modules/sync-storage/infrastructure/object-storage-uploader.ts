/**
 * Object storage uploader (Issue #436 — dispatcher for
 * `awcms_object_sync_queue`, closing the "Belum tersedia: dispatcher
 * upload R2 nyata" gap called out in `../../README.md`).
 *
 * This is the only place in the codebase that talks to an actual external
 * object storage provider. Two implementations behind one `ObjectUploader`
 * port, chosen by `resolveObjectUploader` based on the row's own
 * `requires_upload` flag (set once, at enqueue time, from `R2_ENABLED` —
 * see `pages/api/v1/sync/objects/index.ts`):
 *
 * - `createNoopObjectUploader` — `requires_upload = false` (R2 disabled or
 *   STORAGE_DRIVER=local): the object is already durable locally, so there
 *   is nothing to dispatch. No network, no file I/O, always succeeds.
 *   ADR-0006 / doc 16: "provider opsional... fitur off tidak menghentikan
 *   aplikasi" — this path can never fail on account of the provider being
 *   off, because it never talks to the provider at all.
 * - `createR2ObjectUploader` — `requires_upload = true`: really uploads the
 *   local file's bytes via Bun's native `Bun.S3Client` (R2 is
 *   S3-API-compatible; Bun-only per project constraint, no npm AWS/S3 SDK).
 *
 * Both are called strictly OUTSIDE any DB transaction by the dispatcher
 * (`../application/object-dispatch.ts`) — never call a provider inside
 * `withTenant`/`sql.begin` (ADR-0006).
 */
import { getProviderCircuitBreaker } from "../../../lib/database/circuit-breaker";
import { parseRetryAfterClamped } from "../../../lib/integration/retry-after";
import { withTimeout } from "../../../lib/integration/timeout";
import {
  confinedPathRefusalMessage,
  resolveConfinedPath
} from "../../../lib/security/confined-path";
import {
  OBJECT_SYNC_BREAKER_HOLD_MS,
  OBJECT_SYNC_MAX_RETRY_AFTER_MS,
  OBJECT_SYNC_MIN_RETRY_AFTER_MS,
  isSafeObjectKey,
  objectSyncStorageKey,
  verifyObjectChecksum
} from "../domain/object-queue";
import { resolveObjectSyncConfig } from "../domain/object-sync-config";

export type ObjectUploadInput = {
  objectKey: string;
  localPath: string;
  checksumSha256: string;
  /**
   * Finding A7 — the destination key is namespaced by tenant, so the uploader
   * needs to know whose row it is holding. Required rather than optional: an
   * optional tenant would let a caller silently opt out of the namespace, which
   * is the property being added.
   */
  tenantId: string;
};

/**
 * Outcomes of one upload attempt (Issue #1432).
 *
 * - `ok: true` — the provider accepted the object.
 * - `ok: false` — the attempt FAILED and a retry is spent. `retryAfterMs` is
 *   the provider's own `Retry-After` (429/503), already clamped; the dispatcher
 *   never shortens its own backoff with it. Local faults (missing file,
 *   checksum drift, unconfined path) also land here but never touch the
 *   provider breaker.
 * - `ok: false, skipped: true` — NOTHING reached the provider (breaker open, or
 *   the half-open probe is held). No attempt happened, so no retry is spent;
 *   the dispatcher holds the row for `holdMs` and moves on. Same contract as
 *   email/WhatsApp/Telegram/push (#1409).
 */
export type UploadResult =
  | { ok: true }
  | { ok: false; skipped?: false; error: string; retryAfterMs?: number }
  | { ok: false; skipped: true; error: string; holdMs: number };

export type ObjectUploader = (
  input: ObjectUploadInput
) => Promise<UploadResult>;

const PROVIDER_KEY = "object-storage";
const DEFAULT_UPLOAD_TIMEOUT_MS = 10_000;
const MAX_ERROR_MESSAGE_LENGTH = 500;

function truncateError(message: string): string {
  return message.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
    : message;
}

export function createNoopObjectUploader(): ObjectUploader {
  return async () => ({ ok: true });
}

export type R2UploaderConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /**
   * Override for tests/dev only (e.g. a local fake S3-compatible HTTP
   * server standing in for R2 — see
   * `tests/integration/object-dispatch.integration.test.ts`). Defaults to
   * the real Cloudflare R2 endpoint derived from `accountId`. Always
   * supplied by the caller from configuration, never from request/user
   * input (SSRF-safe per doc 10 §Webhook/callback verification).
   */
  endpoint?: string;
  timeoutMs?: number;
};

/**
 * Real upload path. Verifies the local file's actual sha256 against the
 * checksum recorded at enqueue time *before* attempting the network call —
 * catches local corruption/drift without wasting an upload attempt (this is
 * the first real caller of `verifyObjectChecksum`; previously only
 * exercised directly by unit tests). Every call is timeout-bounded
 * (`withTimeout`) and gated by a shared circuit breaker
 * (`getProviderCircuitBreaker("object-storage")`, doc 16 — the same generic
 * breaker `withTenant` already uses for the database, extended here to an
 * external provider) so a wedged/down provider fails fast on subsequent
 * calls instead of piling up hung requests.
 */
export function createR2ObjectUploader(
  config: R2UploaderConfig
): ObjectUploader {
  const endpoint =
    config.endpoint ?? `https://${config.accountId}.r2.cloudflarestorage.com`;
  const timeoutMs = config.timeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS;
  const client = new Bun.S3Client({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket,
    endpoint,
    region: "auto"
  });
  const breaker = getProviderCircuitBreaker(PROVIDER_KEY);

  return async (input) => {
    // Local validation FIRST, before the breaker is asked for a permit. A local
    // fault says nothing about R2's health, so it must neither trip the shared
    // `object-storage` breaker (five broken rows would open it for every
    // tenant) nor hold the half-open probe while it fails (Issue #1432).
    //
    // Finding A7, second line of defence. The enqueue route already refuses an
    // unconfined `localPath`, but rows queued BEFORE that check exists are
    // still in the table, and this is the process that actually opens the
    // file. The check that matters is the one next to the syscall.
    let bytes: ArrayBuffer;
    let storageKey: string;

    try {
      const confined = resolveConfinedPath(
        resolveObjectSyncConfig().localRootPath,
        input.localPath
      );

      if (!confined.ok) {
        // The refusal reason is deliberately NOT in the message: this string is
        // written to `last_error` and read back by the node through
        // `GET /sync/objects/status`.
        throw new Error(confinedPathRefusalMessage());
      }

      if (!isSafeObjectKey(input.objectKey)) {
        throw new Error("objectKey is not a valid object storage key.");
      }

      const file = Bun.file(confined.absolutePath);

      if (!(await file.exists())) {
        // The path is NOT interpolated. Before confinement this read
        // `Local file not found: ${input.localPath}`, and the difference
        // between that and a read error is an existence oracle for any path on
        // the host — answerable one string at a time, through a status endpoint
        // the node is entitled to poll.
        throw new Error("Local object file is missing or unreadable.");
      }

      bytes = await file.arrayBuffer();
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(bytes);
      const actualChecksum = hasher.digest("hex");

      if (!verifyObjectChecksum(input.checksumSha256, actualChecksum)) {
        throw new Error(
          "Local file checksum does not match the checksum recorded at enqueue time."
        );
      }

      // Tenant-namespaced at PUT time, not in the queue row: an S3/R2 PUT to an
      // existing key is an overwrite, and without the prefix one node could
      // name another tenant's key and replace its object. Applied here so no
      // migration is needed and the key a node reads back from
      // `GET /sync/objects/status` is still the one it sent.
      storageKey = objectSyncStorageKey(input.tenantId, input.objectKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      return { ok: false, error: truncateError(message) };
    }

    const permit = breaker.tryAcquire(new Date());

    if (!permit) {
      return {
        ok: false,
        skipped: true,
        holdMs: OBJECT_SYNC_BREAKER_HOLD_MS,
        error: "Object storage circuit breaker is open; skipping attempt."
      };
    }

    const controller = new AbortController();

    try {
      // A presigned PUT through `fetch`, not `client.write`: `Bun.S3Client`
      // throws an `S3Error` that carries neither the HTTP status nor the
      // response headers, so `Retry-After` would be unreachable. The signature
      // is the same SigV4 one, the bytes are the same, and the destination is
      // still the configured endpoint only (SSRF-safe, see `R2UploaderConfig`).
      const url = client.presign(storageKey, {
        method: "PUT",
        expiresIn: Math.max(60, Math.ceil(timeoutMs / 1000) + 30)
      });
      const response = await withTimeout(
        fetch(url, {
          method: "PUT",
          body: bytes,
          signal: controller.signal
        }),
        timeoutMs,
        `object-storage upload ${storageKey}`
      );

      // The body is never read (it can echo request details); free the socket.
      await response.body?.cancel();

      if (!response.ok) {
        const now = new Date();

        breaker.recordFailure(now);

        const retryAfterMs =
          response.status === 429 || response.status === 503
            ? parseRetryAfterClamped(
                response.headers.get("retry-after"),
                now,
                OBJECT_SYNC_MIN_RETRY_AFTER_MS,
                OBJECT_SYNC_MAX_RETRY_AFTER_MS
              )
            : undefined;

        return {
          ok: false,
          error: `Object storage responded with HTTP ${response.status}.`,
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {})
        };
      }

      breaker.recordSuccess(new Date());
      return { ok: true };
    } catch (error) {
      controller.abort();
      breaker.recordFailure(new Date());
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: truncateError(message) };
    } finally {
      // Idempotent: a no-op once recordSuccess/recordFailure moved the state.
      // Guards any path that leaves without a verdict.
      permit.release();
    }
  };
}

function resolveUploadTimeoutMs(): number {
  const raw = Number(process.env.OBJECT_SYNC_UPLOAD_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_UPLOAD_TIMEOUT_MS;
}

/**
 * Production resolver: picks the uploader for one queue row based on its
 * own `requiresUpload` flag (not the *current* `R2_ENABLED` value — the
 * flag was already decided at enqueue time and should not silently drift if
 * the env changes between enqueue and dispatch). If `requiresUpload` is
 * true but R2 credentials are missing (a misconfiguration `config:validate`
 * should already have caught at boot — see `scripts/validate-env.ts`), this
 * still degrades to a clean failed-attempt result instead of throwing, so a
 * single misconfigured row cannot crash a whole dispatch batch.
 */
export function resolveObjectUploader(requiresUpload: boolean): ObjectUploader {
  if (!requiresUpload) {
    return createNoopObjectUploader();
  }

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return async () => ({
      ok: false as const,
      error:
        "R2 credentials are not configured (requires R2_ACCOUNT_ID, " +
        "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)."
    });
  }

  return createR2ObjectUploader({
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    timeoutMs: resolveUploadTimeoutMs()
  });
}
