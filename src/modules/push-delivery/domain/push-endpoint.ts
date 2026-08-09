/**
 * Endpoint handling for push subscriptions (Issue #465).
 *
 * A Web Push endpoint URL and an FCM registration token are both
 * credential-grade: anyone holding one can push to that device until it is
 * rotated. They get the same normalize / hash / mask treatment
 * `profile-identity/domain/identifier.ts` gives a login identifier — but with
 * their OWN implementation rather than a cross-module import, because that
 * function's headline behaviour is an email-specific branch (`a***@host`) which
 * would be wrong here in a way that still LOOKS masked. A cross-module
 * dependency bought only to inherit the wrong branch is worse than twenty
 * lines.
 *
 * Normalization is deliberately minimal — trim only. These values are opaque
 * to us and issued by somebody else; lower-casing an FCM token would corrupt
 * it, and lower-casing a URL path would break delivery. The only thing we may
 * safely assume is that surrounding whitespace was never meaningful.
 */
import { createHash } from "node:crypto";

/** The dedupe/lookup key. Every query and every unique constraint uses this, never the raw value. */
export function hashPushEndpoint(normalizedEndpoint: string): string {
  return createHash("sha256").update(normalizedEndpoint).digest("hex");
}

export function normalizePushEndpoint(rawEndpoint: string): string {
  return rawEndpoint.trim();
}

/**
 * What every log line, diagnostic, list surface, and error snippet shows.
 *
 * Keeps a short HEAD as well as a tail because the head is the part that
 * identifies the push service (`https://fcm.googleapis.com/...`,
 * `https://updates.push.services.mozilla.com/...`) — the single most useful
 * thing when reading a failure — while carrying no secret. The tail is what
 * lets an operator tell two subscriptions apart. What sits between them is the
 * part that authenticates, and it never appears.
 */
export function maskPushEndpoint(normalizedEndpoint: string): string {
  const tailLength = 6;
  const opaqueHeadLength = 8;

  if (normalizedEndpoint.length <= opaqueHeadLength + tailLength) {
    // Too short to reveal a head/tail pair without revealing most of it. Such a
    // value is not a real endpoint, but it can reach here from a test or a
    // malformed registration, and "mask less when the value is odd" is exactly
    // the wrong instinct.
    return "*".repeat(normalizedEndpoint.length);
  }

  const tail = normalizedEndpoint.slice(-tailLength);

  // A Web Push endpoint is a URL, and its ORIGIN is the useful, non-secret
  // part. Taken as an origin rather than as the first N characters: a fixed
  // character count lands mid-host for one push service and mid-path for
  // another, which is how a mask ends up either useless or leaky depending on
  // which vendor issued the value.
  try {
    const { origin } = new URL(normalizedEndpoint);

    if (origin !== "null") {
      return `${origin}/…${tail}`;
    }
  } catch {
    // Not a URL — an FCM registration token. Falls through.
  }

  // An opaque token has no structure worth showing, so the head is short: just
  // enough for an operator to tell two of them apart in a log.
  return `${normalizedEndpoint.slice(0, opaqueHeadLength)}…${tail}`;
}
