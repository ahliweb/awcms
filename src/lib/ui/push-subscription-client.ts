/**
 * Browser-side helpers for enabling push notifications (Issue #466).
 *
 * Lives next to `admin-form-client.ts` and for the same load-bearing reason:
 * the admin screen's `<script>` imports it, and an Astro `<script>` that
 * imports is bundled EXTERNAL, where `default-src 'self'` allows it. An
 * import-free script is inlined, and inline scripts are blocked by this app's
 * CSP — the page's behaviour would die silently.
 *
 * ## The two halves, and why only one of them is here
 *
 * `urlBase64ToUint8Array` is pure and is exercised by
 * `tests/push-service-worker.test.ts` directly. Everything else touches
 * `navigator.serviceWorker` and `Notification`, which exist in no test runner
 * this repo has, so those are kept as thin as possible around the platform
 * calls: what cannot be tested should at least contain nothing worth testing.
 */

/**
 * The path the service worker is served from. A FIXED path, not a bundled
 * asset: a registration is keyed by script URL, so a content-hashed name would
 * change on every build and orphan every subscription the previous build made.
 */
export const PUSH_SERVICE_WORKER_PATH = "/push-sw.js";

/**
 * `PushManager.subscribe()` wants the VAPID public key as raw bytes, and the
 * server sends it as base64url — the form `.env` holds and the form every
 * standard tool prints.
 *
 * Written out rather than reached for from a library because the conversion is
 * where this quietly goes wrong: `atob` rejects the base64url alphabet, so a
 * key containing `-` or `_` (roughly three quarters of all keys, since each of
 * 65 bytes has a chance of producing one) throws `InvalidCharacterError` at
 * subscribe time. A key without them works, which is exactly how this ships
 * green and fails for most deployments.
 */
export function urlBase64ToUint8Array(
  base64Url: string
): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  // Backed by a plain `ArrayBuffer` rather than `new Uint8Array(length)`, whose
  // inferred `ArrayBufferLike` includes `SharedArrayBuffer` and is therefore
  // not assignable to `BufferSource` — which is what `applicationServerKey`
  // takes.
  const output = new Uint8Array(new ArrayBuffer(raw.length));

  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }

  return output;
}

export type PushEnableOutcome =
  { ok: true; endpointMasked: string } | { ok: false; reason: string };

/**
 * Whether this browser can subscribe at all.
 *
 * Checked before anything is offered, because the alternative is a button that
 * throws: Safari before 16.4, every browser in a non-secure context, and any
 * embedded webview without a push backend simply lack these objects.
 */
export function isPushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Registers the worker, asks for permission, subscribes, and posts the result.
 *
 * ## `denied` is not `default`
 *
 * A browser that has already been refused permission returns `denied` from
 * `requestPermission()` WITHOUT prompting, forever, until the user changes it
 * in browser settings. Reported as its own message rather than as a generic
 * failure: "click again" is advice that cannot possibly work, and it is the
 * advice a caller gives when the two are collapsed.
 */
export async function enablePushOnThisDevice(
  applicationServerKey: string
): Promise<PushEnableOutcome> {
  if (!isPushSupported()) {
    return {
      ok: false,
      reason: "This browser does not support push notifications."
    };
  }

  const permission = await Notification.requestPermission();

  if (permission === "denied") {
    return {
      ok: false,
      reason:
        "Notifications are blocked for this site. Re-enable them in your browser's site settings — this page cannot ask again."
    };
  }

  if (permission !== "granted") {
    return { ok: false, reason: "Notification permission was not granted." };
  }

  const registration = await navigator.serviceWorker.register(
    PUSH_SERVICE_WORKER_PATH
  );

  // `ready` rather than the register() result: a worker that is installing
  // cannot receive a push yet, and subscribing before it is active produces a
  // subscription whose first notifications go nowhere.
  await navigator.serviceWorker.ready;

  const subscription = await registration.pushManager.subscribe({
    // Required by Chrome, and the right value regardless: a subscription that
    // may deliver silently is one the browser can revoke for abuse.
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(applicationServerKey)
  });

  const payload = subscription.toJSON();
  const response = await fetch("/api/v1/push/subscriptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    // The tenant and the session both ride the admin cookies —
    // `resolveAuthInputs` falls back to them, which is why no page script here
    // sends `x-awcms-tenant-id` by hand.
    credentials: "same-origin",
    // The browser's own shape, forwarded unchanged. The endpoint accepts
    // exactly `PushSubscription.toJSON()` plus a transport discriminator, so
    // there is nothing here to transcribe and therefore nothing to transcribe
    // wrongly.
    body: JSON.stringify({ transport: "web_push", ...payload })
  });

  if (!response.ok) {
    // The local subscription is undone: leaving it in place would mean the
    // browser believes it is subscribed while the server has no row, and the
    // user would see "enabled" here and never receive anything.
    await subscription.unsubscribe();

    const problem = await response.json().catch(() => null);

    return {
      ok: false,
      reason:
        problem?.error?.message ??
        "The server refused this device registration."
    };
  }

  const body = await response.json();

  return {
    ok: true,
    endpointMasked: body?.data?.subscription?.endpointMasked ?? ""
  };
}

/**
 * Revokes on BOTH sides — the server row and the browser's own subscription.
 *
 * The order matters and it is the safe one: the server is told first, so a
 * failure leaves a browser subscription for a row that is already revoked
 * (harmless, and re-registering repairs it). The reverse order would leave a
 * live server row for a subscription the browser has discarded — a queue that
 * fills with messages the push service will reject one at a time.
 */
export async function disablePushOnThisDevice(
  subscriptionId: string
): Promise<{ ok: boolean; reason?: string }> {
  const response = await fetch(
    `/api/v1/push/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { method: "DELETE", credentials: "same-origin" }
  );

  if (!response.ok) {
    const problem = await response.json().catch(() => null);

    return {
      ok: false,
      reason: problem?.error?.message ?? "The device could not be revoked."
    };
  }

  if (isPushSupported()) {
    const registration = await navigator.serviceWorker.getRegistration(
      PUSH_SERVICE_WORKER_PATH
    );
    const subscription = await registration?.pushManager.getSubscription();

    await subscription?.unsubscribe();
  }

  return { ok: true };
}
