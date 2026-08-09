/**
 * VAPID key material from configuration (Issue #466, ADR-0074). Pure — the same
 * parse-once-use-twice split as `fcm-credentials.ts`, so `config:validate`
 * rejects a bad key pair at BOOT through the code path the adapter uses at send
 * time.
 *
 * ## Why these are three plain variables and not one blob
 *
 * A VAPID key pair is two base64url strings and a contact URI. Unlike an FCM
 * service account there is no vendor-issued JSON document to carry, so wrapping
 * them in one would invent a format nobody else writes — an operator generating
 * keys with any standard tool gets exactly these three values.
 *
 * The public key is ALSO published to the browser (it is the
 * `applicationServerKey` passed to `PushManager.subscribe()`), which is why it
 * is the one piece of this trio that is not a secret and can be rendered into a
 * page.
 */

/** Uncompressed P-256 point: 0x04 || X(32) || Y(32). */
const PUBLIC_KEY_BYTES = 65;
/** P-256 private scalar. */
const PRIVATE_KEY_BYTES = 32;

export type VapidConfigResult =
  | {
      ok: true;
      config: { publicKey: string; privateKey: string; subject: string };
    }
  | { ok: false; reason: string };

function decodedLength(base64Url: string): number {
  const padded = base64Url.replace(/-/g, "+").replace(/_/g, "/");

  return Buffer.from(
    padded + "=".repeat((4 - (padded.length % 4)) % 4),
    "base64"
  ).length;
}

/**
 * RFC 8292 §2.1: `sub` must be a `mailto:` or `https:` URI — how a push service
 * contacts the operator about abuse before blocking them. Enforced rather than
 * defaulted: a placeholder here means the first warning a deployment gets about
 * its own traffic is the block itself.
 */
function isValidSubject(subject: string): boolean {
  if (subject.startsWith("mailto:")) {
    return subject.length > "mailto:".length && subject.includes("@");
  }

  try {
    return new URL(subject).protocol === "https:";
  } catch {
    return false;
  }
}

export function parseVapidConfig(env: NodeJS.ProcessEnv): VapidConfigResult {
  const publicKey = env.PUSH_VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.PUSH_VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = env.PUSH_VAPID_SUBJECT?.trim() ?? "";

  const missing = [
    publicKey === "" ? "PUSH_VAPID_PUBLIC_KEY" : null,
    privateKey === "" ? "PUSH_VAPID_PRIVATE_KEY" : null,
    subject === "" ? "PUSH_VAPID_SUBJECT" : null
  ].filter((name): name is string => name !== null);

  if (missing.length > 0) {
    return { ok: false, reason: `missing ${missing.join(", ")}` };
  }

  if (decodedLength(publicKey) !== PUBLIC_KEY_BYTES) {
    // Checked by LENGTH rather than left to the crypto import, because a
    // truncated or padded key produces an import error at the first send with
    // nothing pointing at the variable that caused it.
    return {
      ok: false,
      reason: `PUSH_VAPID_PUBLIC_KEY must decode to ${PUBLIC_KEY_BYTES} bytes (an uncompressed P-256 point)`
    };
  }

  if (decodedLength(privateKey) !== PRIVATE_KEY_BYTES) {
    return {
      ok: false,
      reason: `PUSH_VAPID_PRIVATE_KEY must decode to ${PRIVATE_KEY_BYTES} bytes`
    };
  }

  if (!isValidSubject(subject)) {
    return {
      ok: false,
      reason:
        "PUSH_VAPID_SUBJECT must be a mailto: address or an https: URL (RFC 8292 §2.1)"
    };
  }

  return { ok: true, config: { publicKey, privateKey, subject } };
}
