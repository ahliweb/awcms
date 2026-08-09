/**
 * `/admin/push-notifications` and the service worker it registers (Issue #466).
 *
 * Sibling of `admin-domain-events-page-contract.test.ts`. Two things are
 * specific to this screen:
 *
 * - **Half of it is behind no permission at all.** "Notifications on this
 *   device" is self-service — the subject is the person looking at it — while
 *   the queue below needs `diagnostics.read`. A test that assumed one gate for
 *   the whole page would push somebody to invent a `subscriptions.read`
 *   permission, which is the latent-authz trap ADR-0058 §E recorded.
 * - **The service worker cannot be a bundled asset.** A registration is keyed
 *   by script URL, so a content-hashed name would change every build and orphan
 *   every subscription the previous build made. It therefore lives in `public/`
 *   at a fixed path, and that path is asserted to agree in three places.
 *
 * Pure — no database, no network, no browser.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { pushDeliveryModule } from "../src/modules/push-delivery/module";
import { SIDEBAR_LABELS } from "../src/modules/module-management/domain/sidebar-menu";
import {
  PUSH_SERVICE_WORKER_PATH,
  urlBase64ToUint8Array
} from "../src/lib/ui/push-subscription-client";
import { NOT_YET_SCREENED } from "../scripts/admin-screen-coverage-ledger";

const PAGE = "src/pages/admin/push-notifications.astro";
const SERVICE_WORKER = "public/push-sw.js";
const CLIENT = "src/lib/ui/push-subscription-client.ts";

type Triple = `${string}.${string}.${string}`;

function guardTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();
  const pattern =
    /moduleKey:\s*"([a-z_]+)",\s*activityCode:\s*"([a-z_]+)",\s*action:\s*"([a-z_]+)"/g;

  for (const match of source.matchAll(pattern)) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

describe("the screen drives every permission the module declares", () => {
  test("all three appear as guards on the page", async () => {
    // The module's whole permission set, driven from one console. A permission
    // that no screen reaches is the shape `admin:screen-coverage:check` exists
    // to surface, and this is the assertion that keeps it at zero here rather
    // than in a ledger.
    const source = await readFile(PAGE, "utf8");
    const guards = guardTriplesFrom(source);

    for (const permission of pushDeliveryModule.permissions ?? []) {
      expect(
        guards.has(
          `push_delivery.${permission.activityCode}.${permission.action}` as Triple
        )
      ).toBe(true);
    }
  });

  test("none of them is on the ledger any more", () => {
    // The ledger may only SHRINK: leaving a line here after building the screen
    // turns `admin:screen-coverage:check` red, which is what keeps its count
    // honest. These three were added when the endpoints landed and removed when
    // this page did.
    for (const key of NOT_YET_SCREENED) {
      expect(key.startsWith("push_delivery.")).toBe(false);
    }
  });

  test("the entry decision is the diagnostics read, not the self-service half", async () => {
    const source = await readFile(PAGE, "utf8");
    const authorizeBlock = source.slice(
      source.indexOf("loadAdminScreen({"),
      source.indexOf("load: async")
    );

    expect(authorizeBlock).toContain('activityCode: "diagnostics"');
    expect(authorizeBlock).toContain('action: "read"');
    // A page entering on nothing would be visible to every user in the tenant,
    // and so would its sidebar entry.
    expect(authorizeBlock).toContain("authorize:");
  });
});

describe("the module became active by acquiring a screen, not by assertion", () => {
  test("status is active and navigation points at this page", () => {
    expect(pushDeliveryModule.status).toBe("active");

    const nav = pushDeliveryModule.navigation ?? [];

    expect(nav).toHaveLength(1);
    expect(nav[0]!.path).toBe("/admin/push-notifications");
    expect(nav[0]!.requiredPermission).toBe("push_delivery.diagnostics.read");
  });

  test("its label resolves rather than rendering the raw key", () => {
    // A key with no resolver is how `admin.layout.nav_blog` sat in the registry
    // pointing at a missing page.
    expect(SIDEBAR_LABELS[pushDeliveryModule.navigation![0]!.labelKey]).toBe(
      "Push notifications"
    );
  });

  test("no active module is left without an admin screen — including this one", () => {
    // The same assertion `admin-media-page-contract.test.ts` makes, restated
    // here because this module is the one that just moved across the line.
    const withoutScreen = listModules()
      .filter((module) => module.status === "active")
      .filter((module) => (module.navigation ?? []).length === 0)
      .map((module) => module.key);

    expect(withoutScreen).toEqual([]);
  });
});

describe("the service worker is at a fixed path, and three places agree on it", () => {
  test("the client constant, the file on disk, and the page all say /push-sw.js", async () => {
    expect(PUSH_SERVICE_WORKER_PATH).toBe("/push-sw.js");
    // Present as a real file in `public/`, not a bundled asset: a
    // content-hashed name changes every build and orphans every registration
    // made by the previous one.
    expect((await readFile(SERVICE_WORKER, "utf8")).length).toBeGreaterThan(0);

    const client = await readFile(CLIENT, "utf8");

    expect(client).toContain('PUSH_SERVICE_WORKER_PATH = "/push-sw.js"');
    expect(client).toContain(
      "navigator.serviceWorker.register(\n    PUSH_SERVICE_WORKER_PATH\n  )"
    );
  });
});

describe("the service worker cannot be turned into an open redirect", () => {
  test("the click target is resolved against this origin and compared", async () => {
    // Second wall, not the only one — `push-target-path.ts` validates before
    // the row is written. It earns its place because THIS is the code that
    // performs the navigation, and a notification carrying the site's own name
    // is the most convincing redirect vehicle there is.
    const source = await readFile(SERVICE_WORKER, "utf8");

    expect(source).toContain("new URL(targetPath, self.location.origin)");
    expect(source).toContain("url.origin === self.location.origin");
  });

  test("it never takes an icon from the payload", async () => {
    // An icon URL from the message would be fetched at display time, handing
    // whoever chose it the recipient's IP address and the fact that they are
    // online.
    const source = await readFile(SERVICE_WORKER, "utf8");
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !/^\s*(?:\/\/|\*)/.test(line))
      .join("\n");

    expect(code).not.toContain("icon");
  });

  test("a payload-less push still shows a notification", async () => {
    // Not politeness: browsers require a user-visible notification for every
    // push and answer a silent one with their own "site updated in the
    // background" — and, repeated, by revoking the permission.
    const source = await readFile(SERVICE_WORKER, "utf8");

    expect(source).toContain("FALLBACK_TITLE");
    expect(source).toContain("var payload = readPayload(event) || {};");
  });

  test("both handlers wrap their async work in waitUntil", async () => {
    // Without it the browser may terminate the worker before
    // `showNotification` resolves — which reads as "the push never arrived" and
    // is invisible from the server, where the send succeeded.
    const source = await readFile(SERVICE_WORKER, "utf8");

    expect(source.match(/event\.waitUntil\(/g)?.length).toBe(2);
  });
});

describe("the VAPID key conversion handles the base64url alphabet", () => {
  test("a key containing - and _ survives the round trip", () => {
    // `atob` rejects the base64url alphabet outright, so a key with either
    // character throws `InvalidCharacterError` at subscribe time — and roughly
    // three quarters of real keys contain one. A key without them works, which
    // is exactly how this ships green and fails for most deployments.
    const bytes = new Uint8Array(65);

    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 7 + 251) % 256;

    const base64Url = Buffer.from(bytes).toString("base64url");

    expect(base64Url).toMatch(/[-_]/);
    expect([...urlBase64ToUint8Array(base64Url)]).toEqual([...bytes]);
  });

  test("it produces the 65 bytes PushManager.subscribe expects", () => {
    const key = Buffer.alloc(65, 3).toString("base64url");

    expect(urlBase64ToUint8Array(key).byteLength).toBe(65);
  });
});
