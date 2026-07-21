/**
 * Theme preview session tokens (Issue #269, ADR-0029 §6). Pure token
 * generation + hashing + expiry helpers — the DB access lives in
 * `application/theme-preview-directory.ts`.
 *
 * A preview session lets an authorized operator open a NON-INDEXABLE,
 * short-lived rendering of their DRAFT theme config — optionally in a separate
 * browser/device (responsive check) without an admin session — while never
 * touching the published version and never being reachable by search engines or
 * the public/CDN cache.
 *
 * Security shape (mirrors `src/lib/auth/session-token.ts`): the RAW token is
 * returned ONCE to the creating admin and put in the preview URL; the database
 * stores only its SHA-256 HASH, so a leak of the table never yields a usable
 * token. Tokens are single-tenant (RLS), high-entropy (256-bit), and expire.
 */

/** Default preview session lifetime — short by design (ADR-0029 §6). */
export const PREVIEW_SESSION_TTL_MINUTES = 30;
/** Hard cap a caller may request. */
export const PREVIEW_SESSION_MAX_TTL_MINUTES = 120;

/** A raw preview token is 64 lowercase hex chars (256 bits of entropy). */
const RAW_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** Generate a fresh, high-entropy raw preview token (returned to the admin, never stored raw). */
export function generatePreviewToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** True if a token from a URL is structurally a valid raw preview token (cheap pre-DB guard). */
export function isWellFormedPreviewToken(token: string): boolean {
  return typeof token === "string" && RAW_TOKEN_PATTERN.test(token);
}

/**
 * SHA-256 hash of a raw preview token — what the database stores and looks up.
 * Deterministic; a constant-time-ish equality is unnecessary because lookup is
 * by the hash itself (an attacker cannot supply a hash without the preimage).
 */
export function hashPreviewToken(rawToken: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(rawToken);
  return hasher.digest("hex");
}

/** Resolve the requested TTL to a bounded minutes value (default 30, hard cap 120). */
export function resolvePreviewTtlMinutes(requested: unknown): number {
  if (
    typeof requested !== "number" ||
    !Number.isFinite(requested) ||
    requested <= 0
  ) {
    return PREVIEW_SESSION_TTL_MINUTES;
  }
  return Math.min(Math.floor(requested), PREVIEW_SESSION_MAX_TTL_MINUTES);
}

/** True when a preview session's `expiresAt` is at/after `now` (still usable). */
export function isPreviewSessionActive(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() >= now.getTime();
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The value placed in the preview URL (`/theming/preview/{urlToken}`). It carries
 * BOTH the tenant id and the raw secret token: `${tenantId}~${rawToken}`. The
 * tenant id is NOT a secret — it only lets the tokenless preview route open the
 * correct tenant transaction so RLS can then confirm the hashed `rawToken`
 * belongs to that tenant. Security still rests entirely on the 256-bit raw token
 * (an attacker who knows a tenant id but not the token gets nothing). This avoids
 * a cross-tenant token lookup (which would need a privileged/RLS-bypassing query)
 * while keeping every read strictly tenant-scoped.
 */
export function buildPreviewUrlToken(
  tenantId: string,
  rawToken: string
): string {
  return `${tenantId}~${rawToken}`;
}

/** Parse a `${tenantId}~${rawToken}` URL token, or `null` if malformed. */
export function parsePreviewUrlToken(
  urlToken: string
): { tenantId: string; rawToken: string } | null {
  if (typeof urlToken !== "string") return null;
  const sep = urlToken.indexOf("~");
  if (sep <= 0) return null;
  const tenantId = urlToken.slice(0, sep);
  const rawToken = urlToken.slice(sep + 1);
  if (!UUID_PATTERN.test(tenantId) || !isWellFormedPreviewToken(rawToken)) {
    return null;
  }
  return { tenantId, rawToken };
}
