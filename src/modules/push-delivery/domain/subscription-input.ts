/**
 * Validation for a device registration payload (Issue #466). Pure — no
 * database, no network, no DNS.
 *
 * The body this parses is the browser's own `PushSubscription.toJSON()` shape
 * (`{ endpoint, keys: { p256dh, auth } }`, RFC 8030 §6 + RFC 8291 §3), plus a
 * `transport` discriminator, so page script can post what the platform handed
 * it without reshaping it first. A client that has to transcribe fields is a
 * client that transcribes them wrongly.
 *
 * ## What is checked here, and what is deliberately NOT
 *
 * Checked: shape, scheme, key sizes, and that the host is not an IP literal.
 * All four are properties of the STRING and stay true forever.
 *
 * Not checked: whether the endpoint's host resolves to a private address. That
 * one is real — an attacker holding a session could otherwise register an
 * endpoint aimed at an internal service and let the dispatcher deliver to it —
 * but it is answered by DNS, and a DNS answer at registration time says nothing
 * about the same name minutes later. Enforcing it here would produce an
 * assurance that expires silently while looking permanent. The authority is
 * `ssrfSafeFetch` in the send path, which resolves immediately before it
 * connects; this file removes only what is knowable without asking anybody.
 *
 * The IP-literal rejection is the part that IS knowable: `https://10.0.0.5/…`
 * needs no resolver to be recognised, and no push service issues one.
 */
import { isIP } from "node:net";

import { isBlockedAddress } from "../../../lib/auth/ssrf-guard";
import type { PushTransport } from "./push-provider-contract";

/**
 * An endpoint is opaque to us, so the bound is about storage rather than
 * meaning: the column is `text`, one row per device, and an unbounded
 * credential-shaped string posted by an authenticated caller is a cheap way to
 * grow a table nobody watches. Real endpoints are ~200 characters; FCM
 * registration tokens ~160.
 */
export const MAX_PUSH_ENDPOINT_LENGTH = 2048;

/** RFC 8291 §3.1 — uncompressed P-256 point: `0x04 || X(32) || Y(32)`. */
const P256DH_BYTES = 65;
/** RFC 8291 §3.2 — the subscriber's authentication secret is 16 bytes. */
const AUTH_SECRET_BYTES = 16;

export type ValidatedSubscriptionInput = {
  transport: PushTransport;
  endpoint: string;
  p256dhKey?: string;
  authSecret?: string;
};

export type SubscriptionInputValidation =
  | { valid: true; value: ValidatedSubscriptionInput }
  | { valid: false; errors: { field: string; message: string }[] };

function decodedLength(base64Url: string): number {
  const padded = base64Url.replace(/-/g, "+").replace(/_/g, "/");

  return Buffer.from(
    padded + "=".repeat((4 - (padded.length % 4)) % 4),
    "base64"
  ).length;
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];

  return typeof value === "string" ? value.trim() : "";
}

/**
 * Rejects an endpoint whose host is a literal private or reserved address.
 *
 * ## The `isIP` guard is load-bearing, not defensive
 *
 * `isBlockedAddress` fails CLOSED for anything that is not a valid IP literal —
 * correct where it is normally called, which is on addresses a resolver already
 * returned. Handed a DNS name it answers "blocked", so calling it directly here
 * would reject `https://updates.push.services.mozilla.com/...` along with
 * everything else: registration would be impossible for every real push
 * service, and the error would say the endpoint pointed at a private address.
 *
 * So the literal-address question is only ASKED when the host is a literal.
 * `new URL("https://[::1]/x").hostname` keeps its brackets, which `isIP` does
 * not accept, so they are stripped first.
 */
function hasBlockedLiteralHost(url: URL): boolean {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  if (isIP(hostname) === 0) return false;

  return isBlockedAddress(hostname);
}

export function validateSubscriptionInput(
  body: unknown
): SubscriptionInputValidation {
  const errors: { field: string; message: string }[] = [];

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Body must be a JSON object." }]
    };
  }

  const source = body as Record<string, unknown>;
  const transport = readString(source, "transport");
  const endpoint = readString(source, "endpoint");

  if (transport !== "web_push" && transport !== "fcm") {
    errors.push({
      field: "transport",
      message: 'transport must be "web_push" or "fcm".'
    });
  }

  if (endpoint === "") {
    errors.push({ field: "endpoint", message: "endpoint is required." });
  } else if (endpoint.length > MAX_PUSH_ENDPOINT_LENGTH) {
    errors.push({
      field: "endpoint",
      message: `endpoint must be at most ${MAX_PUSH_ENDPOINT_LENGTH} characters.`
    });
  }

  const keys =
    typeof source.keys === "object" &&
    source.keys !== null &&
    !Array.isArray(source.keys)
      ? (source.keys as Record<string, unknown>)
      : {};
  const p256dhKey = readString(keys, "p256dh");
  const authSecret = readString(keys, "auth");

  if (transport === "web_push") {
    // The endpoint is a URL issued by the push service. `https:` only: RFC 8030
    // §6 defines it as one, and a `http:` endpoint would carry an encrypted
    // payload over a channel where the VAPID authorization header is not.
    let url: URL | null = null;

    try {
      url = new URL(endpoint);
    } catch {
      url = null;
    }

    if (endpoint !== "" && (url === null || url.protocol !== "https:")) {
      errors.push({
        field: "endpoint",
        message: "A web_push endpoint must be an https: URL (RFC 8030 §6)."
      });
    } else if (url !== null && hasBlockedLiteralHost(url)) {
      errors.push({
        field: "endpoint",
        message:
          "A web_push endpoint may not point at a literal private or reserved address."
      });
    }

    if (decodedLength(p256dhKey) !== P256DH_BYTES) {
      errors.push({
        field: "keys.p256dh",
        message: `keys.p256dh must decode to ${P256DH_BYTES} bytes (an uncompressed P-256 point).`
      });
    }

    if (decodedLength(authSecret) !== AUTH_SECRET_BYTES) {
      errors.push({
        field: "keys.auth",
        message: `keys.auth must decode to ${AUTH_SECRET_BYTES} bytes (RFC 8291 §3.2).`
      });
    }
  }

  if (transport === "fcm") {
    // Mirrors `awcms_push_subscriptions_keys_match_transport_check`. Rejected
    // rather than dropped: a client sending Web Push key material with
    // `transport: "fcm"` has confused its two registration paths, and silently
    // discarding half of what it sent would store a row that cannot deliver
    // while reporting success.
    if (p256dhKey !== "" || authSecret !== "") {
      errors.push({
        field: "keys",
        message: "An fcm registration carries no keys; omit `keys`."
      });
    }

    if (endpoint !== "" && /\s/.test(endpoint)) {
      errors.push({
        field: "endpoint",
        message: "An fcm registration token contains no whitespace."
      });
    }
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value:
      transport === "web_push"
        ? {
            transport: "web_push",
            endpoint,
            p256dhKey,
            authSecret
          }
        : { transport: "fcm", endpoint }
  };
}
