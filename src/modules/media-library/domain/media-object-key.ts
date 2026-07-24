/**
 * Object key convention + trusted public URL construction for the R2-only
 * news media registry (Issue #633, epic `news_portal`). Pure — no network/DB
 * access, no `process.env` reads (callers pass in `NewsMediaR2Config` from
 * `news-media-r2-config.ts`).
 *
 * Format, EXACTLY as `docs/awcms-mini/news-portal/full-online-r2-architecture.md`
 * §6 mandates:
 *
 *   news-media/{tenantId}/{yyyy}/{mm}/{uuid}.{ext}
 *
 * - `tenantId` — the tenant UUID (never the human-readable `tenantCode`).
 * - `{yyyy}/{mm}` — upload-date partition (server clock, not client input).
 * - `{uuid}` — `crypto.randomUUID()` (Bun-native), the only component that
 *   uniquely identifies the object. Never the client's original filename,
 *   an article title, or any other client-supplied text — this is what
 *   makes the key unguessable (mitigates the residual risk in doc §8: a
 *   `pending_upload` row is not itself an access control) and prevents path
 *   traversal / unsafe-character / information-leak issues a raw filename
 *   would introduce.
 * - `{ext}` — derived from the SERVER-VALIDATED mime type (doc §6/§9), never
 *   from the client's original file extension. This is what closes the
 *   "file.jpg that is actually HTML/PHP" spoofing gap.
 *
 * `original_filename` is stored as its own metadata column (never part of
 * the key) purely for editor-facing display.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extension map for the mime types `news-media-r2-config.ts` allows by
 * default. Deliberately explicit (no generic `mime.split("/")[1]` fallback)
 * — if an operator ever widens `NEWS_MEDIA_R2_ALLOWED_MIME_TYPES` to a mime
 * type not listed here, `deriveExtensionFromMimeType` must fail loudly
 * (forcing this map to be extended deliberately) rather than silently
 * deriving an unreviewed extension from the mime subtype string.
 */
const MIME_TYPE_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};

/** `undefined` when `mimeType` has no known-safe extension mapping. */
export function deriveExtensionFromMimeType(
  mimeType: string
): string | undefined {
  return MIME_TYPE_TO_EXTENSION[mimeType.toLowerCase().trim()];
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

export type BuildNewsMediaObjectKeyInput = {
  tenantId: string;
  mimeType: string;
  /** Defaults to `crypto.randomUUID()` — override only from tests. */
  uuid?: string;
  /** Defaults to `new Date()` — override only from tests. */
  now?: Date;
};

export class UnsupportedNewsMediaMimeTypeError extends Error {
  constructor(mimeType: string) {
    super(
      `No object-key extension mapping for mime type "${mimeType}" — add it to MIME_TYPE_TO_EXTENSION in news-media-object-key.ts deliberately before allowing it.`
    );
    this.name = "UnsupportedNewsMediaMimeTypeError";
  }
}

/**
 * Builds a fresh, server-generated object key. Throws
 * `UnsupportedNewsMediaMimeTypeError` for any mime type without a reviewed
 * extension mapping — callers must validate `mimeType` against the
 * configured allow-list (`NewsMediaR2Config.allowedMimeTypes`) BEFORE
 * calling this, this is a second, structural line of defense, not the
 * primary check.
 */
export function buildNewsMediaObjectKey(
  input: BuildNewsMediaObjectKeyInput
): string {
  const ext = deriveExtensionFromMimeType(input.mimeType);
  if (!ext) {
    throw new UnsupportedNewsMediaMimeTypeError(input.mimeType);
  }

  const now = input.now ?? new Date();
  const uuid = input.uuid ?? crypto.randomUUID();
  const yyyy = now.getUTCFullYear().toString();
  const mm = pad2(now.getUTCMonth() + 1);

  return `news-media/${input.tenantId}/${yyyy}/${mm}/${uuid}.${ext}`;
}

/**
 * Validates that `objectKey` matches the full §6 format AND belongs to
 * `tenantId` — used both to sanity-check keys this module generated and to
 * reject any object key supplied from outside (e.g. a confirm step payload
 * in #634) that doesn't match the server-generated shape/prefix.
 */
export function isValidNewsMediaObjectKey(
  tenantId: string,
  objectKey: string
): boolean {
  const escapedTenantId = tenantId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^news-media/${escapedTenantId}/\\d{4}/\\d{2}/[0-9a-f-]{36}\\.[a-z0-9]+$`,
    "i"
  );

  if (!pattern.test(objectKey)) return false;

  const uuidSegment = objectKey.split("/").pop()?.split(".")[0] ?? "";
  return UUID_PATTERN.test(uuidSegment);
}

export class UntrustedNewsMediaPublicBaseUrlError extends Error {
  constructor(publicBaseUrl: string) {
    super(
      `NEWS_MEDIA_R2_PUBLIC_BASE_URL must be an absolute https URL, got: "${publicBaseUrl}".`
    );
    this.name = "UntrustedNewsMediaPublicBaseUrlError";
  }
}

/**
 * Builds the public URL for a media object strictly from the trusted,
 * server-side-configured `publicBaseUrl` (`NEWS_MEDIA_R2_PUBLIC_BASE_URL`,
 * Issue #632's config resolver) and a server-generated `objectKey` — NEVER
 * from any client-supplied URL/host. Rejects a malformed/non-https base URL
 * rather than silently building an unsafe link (defense in depth; the base
 * URL itself is also checked by `scripts/validate-env.ts`'s
 * `isHttpsAbsoluteUrl` at config-validate time).
 */
export function buildNewsMediaPublicUrl(
  publicBaseUrl: string,
  objectKey: string
): string {
  let parsed: URL;
  try {
    parsed = new URL(publicBaseUrl);
  } catch {
    throw new UntrustedNewsMediaPublicBaseUrlError(publicBaseUrl);
  }

  if (parsed.protocol !== "https:") {
    throw new UntrustedNewsMediaPublicBaseUrlError(publicBaseUrl);
  }

  const trimmedBase = publicBaseUrl.replace(/\/+$/, "");
  return `${trimmedBase}/${objectKey}`;
}
