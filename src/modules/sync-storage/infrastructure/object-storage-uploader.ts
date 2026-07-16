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
import { withTimeout } from "../../../lib/integration/timeout";
import { verifyObjectChecksum } from "../domain/object-queue";

export type ObjectUploadInput = {
  objectKey: string;
  localPath: string;
  checksumSha256: string;
};

export type UploadResult = { ok: true } | { ok: false; error: string };

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
    const attemptedAt = new Date();

    if (!breaker.canAttempt(attemptedAt)) {
      return {
        ok: false,
        error: "Object storage circuit breaker is open; skipping attempt."
      };
    }

    try {
      const file = Bun.file(input.localPath);

      if (!(await file.exists())) {
        throw new Error(`Local file not found: ${input.localPath}`);
      }

      const bytes = await file.arrayBuffer();
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(bytes);
      const actualChecksum = hasher.digest("hex");

      if (!verifyObjectChecksum(input.checksumSha256, actualChecksum)) {
        throw new Error(
          "Local file checksum does not match the checksum recorded at enqueue time."
        );
      }

      await withTimeout(
        client.write(input.objectKey, bytes),
        timeoutMs,
        `object-storage upload ${input.objectKey}`
      );

      breaker.recordSuccess(new Date());
      return { ok: true };
    } catch (error) {
      breaker.recordFailure(new Date());
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: truncateError(message) };
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
      ok: false,
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
