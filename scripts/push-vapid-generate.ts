/**
 * push-vapid-generate.ts — `bun run push:vapid:generate`.
 *
 * Issue #466 (epic #463, ADR-0074). Prints one fresh VAPID key pair in the
 * exact shape `.env` wants. Operator-run, once per deployment, never scheduled.
 *
 * ## Why this exists rather than "use openssl"
 *
 * The format is specific and easy to get subtly wrong: the public key is the
 * **uncompressed P-256 point** (65 bytes, `0x04` prefix) and the private key is
 * the **raw 32-byte scalar**, both base64url without padding. `openssl ecparam`
 * emits PEM, and every recipe for converting it involves two more commands and
 * a chance to hand over the DER-wrapped form instead — which imports fine here
 * and is then rejected by every push service as a 401.
 *
 * ## Rotation is not free, and the output says so
 *
 * The public key is baked into every browser subscription at
 * `PushManager.subscribe()` time. Generating a new pair does not re-key
 * existing subscribers; it makes them permanently undeliverable, and they will
 * only recover by re-subscribing. That warning is printed with the keys rather
 * than filed in a document, because this is the moment somebody is about to do
 * it.
 *
 * Touches no database and reads no configuration.
 */
import { base64UrlEncode } from "../src/modules/push-delivery/domain/web-push-encryption";

async function main() {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;

  const publicRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey)
  );
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as {
    d?: string;
  };

  if (!jwk.d) {
    // Cannot happen for an extractable private key; refusing beats printing a
    // half key pair an operator would paste into production.
    console.error("push:vapid:generate FAILED — no private scalar in the JWK.");
    process.exit(1);
  }

  console.log("# VAPID key pair (ADR-0074). Paste into .env:");
  console.log(`PUSH_VAPID_PUBLIC_KEY=${base64UrlEncode(publicRaw)}`);
  console.log(`PUSH_VAPID_PRIVATE_KEY=${jwk.d}`);
  console.log("PUSH_VAPID_SUBJECT=mailto:CHANGE-ME@example.com");
  console.log("");
  console.log(
    "# Keep this pair. Rotating it does NOT re-key existing browser subscriptions —"
  );
  console.log(
    "# it makes every one of them permanently undeliverable until the user re-subscribes,"
  );
  console.log(
    "# because the public key is baked into each subscription at subscribe() time."
  );
}

if (import.meta.main) {
  await main();
}
