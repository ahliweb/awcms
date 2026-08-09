/**
 * Push service worker (Issue #466, ADR-0074).
 *
 * Served same-origin from `/push-sw.js`, so its scope is `/` with no
 * `Service-Worker-Allowed` header needed, and `worker-src` falls through to
 * this app's `default-src 'self'` — no CSP change, which is half the reason
 * ADR-0074 chose Web Push over the FCM Web SDK.
 *
 * Vanilla and dependency-free, like `public/js/news-share.js`. It is not
 * bundled by Astro, for three reasons — the third only visible by fetching it
 * from the built server:
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
 * The cost is that it is never minified: `public/` is copied verbatim. 5,515 B,
 * most of it these comments. ADR-0074 records the number next to the 91,333 B
 * SDK it replaces.
 *
 * ## Payload shape
 *
 * `{ title, body, targetPath?, data? }` — exactly what
 * `web-push-provider.ts` encrypts. It is decrypted by the browser before this
 * code sees it, so it arrives already authenticated as having come from a
 * server holding the VAPID private key.
 *
 * ## Why a payload-less push still shows something
 *
 * Some push services deliver a "tickle" with no body, and a decryption failure
 * leaves `event.data` unusable. Showing nothing in that case is not the safe
 * default it looks like: browsers require a user-visible notification for every
 * push and answer a silent one with their own "This site has been updated in
 * the background" — or, after repeated offences, by revoking the permission.
 * The fallback is therefore mandatory rather than polite.
 */
"use strict";

/** What a payload-less or undecryptable push shows. Deliberately vague — there is nothing honest to say about content that never arrived. */
var FALLBACK_TITLE = "New notification";
var FALLBACK_BODY = "Open the admin area to see what changed.";

/**
 * Resolve the click destination against THIS origin, refusing anything that
 * lands elsewhere.
 *
 * The server already validates `targetPath` before the row is written
 * (`push-target-path.ts`), so this is a second wall, not the only one. It is
 * cheap and it is in the right place: this is the code that performs the
 * navigation, and a notification carrying this site's own name and icon is the
 * most convincing open-redirect vehicle there is.
 *
 * `new URL(path, origin)` is what makes it decidable: a protocol-relative
 * `//evil.example/x` resolves to a different origin and is caught by the
 * comparison, where a string test for a leading `/` would pass it.
 */
function resolveSameOriginUrl(targetPath) {
  if (typeof targetPath !== "string" || targetPath === "") {
    return self.location.origin + "/admin";
  }

  try {
    var url = new URL(targetPath, self.location.origin);

    return url.origin === self.location.origin
      ? url.href
      : self.location.origin + "/admin";
  } catch (error) {
    return self.location.origin + "/admin";
  }
}

function readPayload(event) {
  if (!event.data) return null;

  try {
    return event.data.json();
  } catch (error) {
    // Not JSON, or not decryptable. Either way there is no content to render,
    // and the fallback is what keeps the permission alive.
    return null;
  }
}

self.addEventListener("push", function (event) {
  var payload = readPayload(event) || {};
  var title =
    typeof payload.title === "string" && payload.title !== ""
      ? payload.title
      : FALLBACK_TITLE;
  var body =
    typeof payload.body === "string" && payload.body !== ""
      ? payload.body
      : FALLBACK_BODY;

  var options = {
    body: body,
    data: { url: resolveSameOriginUrl(payload.targetPath) }
  };

  // Coalesces per category so a burst of ten does not become ten banners. Set
  // only when the payload names one: an absent tag means "do not coalesce",
  // while a constant fallback tag would mean "coalesce with everything", and
  // ten unrelated notifications would collapse into the last one.
  if (payload.data && typeof payload.data.category === "string") {
    options.tag = payload.data.category;
  }

  // No `icon`. There is no own-origin icon asset in this application to point
  // at, and taking one from the payload is refused rather than deferred: the
  // notification would fetch it at display time, handing whoever chose the URL
  // the recipient's IP address and the fact that they are online.

  // `waitUntil` is not optional: without it the browser may terminate this
  // worker before `showNotification` resolves, which reads as "the push never
  // arrived" and is untraceable from the server, where the send succeeded.
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  var target =
    (event.notification.data && event.notification.data.url) ||
    self.location.origin + "/admin";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (windowClients) {
        // Focus a tab that is already here rather than opening a second one.
        // Matching on origin, not on the full URL: a user with the admin area
        // open on a different page wants that window brought forward and
        // navigated, not a duplicate of the whole application.
        for (var i = 0; i < windowClients.length; i += 1) {
          var client = windowClients[i];

          if (
            client.url.indexOf(self.location.origin) === 0 &&
            "focus" in client
          ) {
            if ("navigate" in client) client.navigate(target);

            return client.focus();
          }
        }

        return self.clients.openWindow(target);
      })
  );
});
