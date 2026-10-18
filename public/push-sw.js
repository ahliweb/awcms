/**
 * Push service worker (Issue #466, ADR-0074).
 *
 * Served same-origin from `/push-sw.js`, so its scope is `/` with no
 * `Service-Worker-Allowed` header needed, and `worker-src` falls through to
 * this app's `default-src 'self'` — no CSP change, which is half the reason
 * ADR-0074 chose Web Push over the FCM Web SDK.
 *
 * Vanilla and dependency-free; not bundled by Astro, for three reasons:
 *
 *   1. a registration is keyed by script URL, so a content-hashed name would
 *      change on every build and orphan every subscription the previous build
 *      made;
 *   2. the path has to be stable for `PUSH_SERVICE_WORKER_PATH` to name it;
 *   3. `dist/client/_astro/**` is served `Cache-Control: public,
 *      max-age=31536000, immutable`, while this file is served `public,
 *      max-age=0`. A service worker under `immutable` is one a browser is
 *      entitled to keep for a year without revalidating — a bug fix here would
 *      reach nobody, and the only symptom would be old behaviour.
 *
 * The cost is that it is never minified: `public/` is copied verbatim, so
 * comments here count against the client asset budget.
 *
 * ## Payload shapes (dual reader, Issue #1106)
 *
 *   legacy       { title, body, targetPath?, data? }
 *   declarative  { web_push: 8030, notification: { title, body?, navigate,
 *                  silent: false, tag?, data? } }
 *
 * Exactly one `showNotification` per event, so one banner (a browser that
 * renders the declarative shape natively never wakes this worker). The producer
 * emits declarative only while PUSH_PAYLOAD_FORMAT=declarative; this worker
 * reads both always, so rollback is a producer flip. The click target is never
 * trusted: it must resolve to http(s) on THIS origin. Runbook:
 * docs/awcms/push-notifications.md.
 *
 * ## Why a payload-less push still shows something
 *
 * Browsers require a visible notification for every push and answer a silent
 * one with their own "updated in the background" banner, then revoke the
 * permission. The fallback is mandatory rather than polite.
 */
"use strict";

var FALLBACK_TITLE = "New notification";
var FALLBACK_BODY = "Open the admin area to see what changed.";
var ADMIN_ROOT = self.location.origin + "/admin";

/**
 * Resolve the click destination against THIS origin, refusing anything else.
 * A second wall behind `push-target-path.ts`, and the one that navigates.
 * `new URL()` makes `//evil.example/x` decidable: it resolves cross-origin.
 */
function resolveSameOriginUrl(targetPath) {
  if (typeof targetPath !== "string" || targetPath === "") return ADMIN_ROOT;

  try {
    var url = new URL(targetPath, self.location.origin);

    // Scheme checked explicitly; `javascript:`/`data:` must not rely on the
    // opaque-origin comparison alone.
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return ADMIN_ROOT;
    }

    return url.origin === self.location.origin ? url.href : ADMIN_ROOT;
  } catch (error) {
    return ADMIN_ROOT;
  }
}

function sameOrigin(href) {
  try {
    return new URL(href).origin === self.location.origin;
  } catch (error) {
    return false;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value, fallback) {
  return typeof value === "string" && value !== "" ? value : fallback || "";
}

/** Either shape -> `{ title, body, url, tag }`. Never throws; `url` is same-origin. */
function normalizePayload(raw) {
  var source = {};
  var target;

  if (isRecord(raw) && raw.web_push === 8030 && isRecord(raw.notification)) {
    source = raw.notification;
    target = source.navigate;
  } else if (isRecord(raw)) {
    source = raw;
    target = raw.targetPath;
  }

  return {
    title: text(source.title, FALLBACK_TITLE),
    body: text(source.body, FALLBACK_BODY),
    url: resolveSameOriginUrl(target),
    tag: text(source.tag, isRecord(source.data) ? source.data.category : null)
      .slice(0, 64)
  };
}

function readPayload(event) {
  if (!event.data) return null;

  try {
    return event.data.json();
  } catch (error) {
    // Not JSON or not decryptable: render the fallback, keep the permission.
    return null;
  }
}

self.addEventListener("push", function (event) {
  var normalized = normalizePayload(readPayload(event));
  var options = { body: normalized.body, data: { url: normalized.url } };

  // Coalesce per tag/category only when the payload names one: a constant
  // fallback tag would collapse unrelated notifications into the last one.
  if (normalized.tag) options.tag = normalized.tag;

  // No `icon` from the payload: it would leak the recipient's IP when fetched.

  // `waitUntil` is not optional (the worker may be killed before
  // `showNotification` resolves), and one call per event is one banner.
  event.waitUntil(
    self.registration.showNotification(normalized.title, options)
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  // Re-validated at click time: this is the code that navigates.
  var target = resolveSameOriginUrl(
    event.notification.data && event.notification.data.url
  );

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (windowClients) {
        // Focus a tab already on this origin rather than opening a second one.
        for (var i = 0; i < windowClients.length; i += 1) {
          var client = windowClients[i];

          if (sameOrigin(client.url) && "focus" in client) {
            if ("navigate" in client) {
              Promise.resolve(client.navigate(target)).catch(function () {});
            }

            return Promise.resolve(client.focus()).catch(function () {});
          }
        }

        return self.clients.openWindow(target);
      })
  );
});
