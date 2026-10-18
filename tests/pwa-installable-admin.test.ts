/**
 * Installable admin / iOS Home Screen web app (Issue #1105).
 *
 * Pure -- no database, no network, no browser. Real-device installability is
 * UAT (docs/awcms/push-notifications.md) and is deliberately NOT claimed here.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import {
  ADMIN_SCOPE,
  APPLE_TOUCH_ICON_PATH,
  PWA_ICONS,
  WEB_APP_MANIFEST_PATH,
  buildWebAppManifest,
  resolvePwaIdentity
} from "../src/lib/pwa/web-app-manifest";
import {
  classifyPushGuidance,
  detectPushEnvironment
} from "../src/lib/ui/push-install-guidance";
import { PUSH_SERVICE_WORKER_PATH } from "../src/lib/ui/push-subscription-client";
import { PUBLIC_ASSET_AUDIENCE } from "../scripts/client-asset-budget";
import { GET } from "../src/pages/manifest.webmanifest";

const LAYOUT = "src/layouts/AdminLayout.astro";
const PAGE = "src/pages/admin/push-notifications.astro";

async function pngSize(
  file: string
): Promise<{ width: number; height: number; signatureOk: boolean }> {
  const bytes = new Uint8Array(await readFile(file));
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  return {
    signatureOk: signature.every((byte, index) => bytes[index] === byte),
    width: view.getUint32(16),
    height: view.getUint32(20)
  };
}

describe("web app manifest contract", () => {
  const manifest = buildWebAppManifest(resolvePwaIdentity({}));

  test("identity, scope and start_url are the admin prefix and stable", () => {
    expect(manifest.id).toBe("/admin/");
    expect(manifest.start_url).toBe("/admin/");
    expect(manifest.scope).toBe(ADMIN_SCOPE);
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
    expect(manifest.display).toBe("standalone");
  });

  test("identity never depends on branding configuration", () => {
    const branded = buildWebAppManifest(
      resolvePwaIdentity({ PWA_APP_NAME: "Acme Back Office" })
    );

    expect(branded.name).toBe("Acme Back Office");
    expect(branded.id).toBe(manifest.id);
    expect(branded.scope).toBe(manifest.scope);
  });

  test("invalid branding falls back instead of throwing", () => {
    const identity = resolvePwaIdentity({
      PWA_APP_NAME: "   ",
      PWA_THEME_COLOR: "url(javascript:alert(1))",
      PWA_BACKGROUND_COLOR: "red"
    });

    expect(identity.name).toBe("AWCMS Admin");
    expect(identity.themeColor).toBe("#2563eb");
    expect(identity.backgroundColor).toBe("#ffffff");
    expect(resolvePwaIdentity({ PWA_APP_NAME: "a\nb\u0000c" }).name).toBe(
      "abc"
    );
  });

  test("declares no service worker (push-sw.js scope is untouched)", () => {
    expect(JSON.stringify(manifest)).not.toContain("serviceworker");
    expect(JSON.stringify(manifest)).not.toContain("push-sw");
  });

  test("every declared icon exists, is a PNG, and has the declared size", async () => {
    expect(PWA_ICONS.some((icon) => icon.sizes === "192x192")).toBe(true);
    expect(
      PWA_ICONS.some(
        (icon) => icon.sizes === "512x512" && icon.purpose === "any"
      )
    ).toBe(true);
    expect(PWA_ICONS.some((icon) => icon.purpose === "maskable")).toBe(true);

    for (const icon of manifest.icons) {
      expect(icon.src.startsWith("/")).toBe(true);
      const [w, h] = icon.sizes.split("x").map(Number);
      const actual = await pngSize(`public${icon.src}`);

      expect(actual.signatureOk).toBe(true);
      expect([actual.width, actual.height]).toEqual([w!, h!]);
    }

    const apple = await pngSize(`public${APPLE_TOUCH_ICON_PATH}`);
    expect([apple.width, apple.height]).toEqual([180, 180]);
  });

  test("icons are self-hosted and declared in the client asset budget", () => {
    for (const icon of [
      ...PWA_ICONS.map((i) => i.src),
      APPLE_TOUCH_ICON_PATH
    ]) {
      expect(icon.startsWith("http")).toBe(false);
      expect(PUBLIC_ASSET_AUDIENCE[icon.slice(1)]).toBe("app");
    }
  });

  test("the route serves the manifest JSON, revalidatable and never immutable", async () => {
    const response = await (
      GET as unknown as () => Response | Promise<Response>
    )();
    const cache = response.headers.get("cache-control") ?? "";

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/manifest+json"
    );
    expect(cache).not.toContain("immutable");
    expect(cache).toContain("max-age=");
    expect((await response.json()).id).toBe("/admin/");
  });
});

describe("shared admin layout head", () => {
  test("links manifest, apple-touch-icon and iOS web-app metas", async () => {
    const source = await readFile(LAYOUT, "utf8");

    expect(source).toContain('rel="manifest" href={WEB_APP_MANIFEST_PATH}');
    expect(source).toContain(
      'rel="apple-touch-icon" href={APPLE_TOUCH_ICON_PATH}'
    );
    expect(source).toContain('name="apple-mobile-web-app-capable"');
    expect(source).toContain('name="apple-mobile-web-app-title"');
    expect(WEB_APP_MANIFEST_PATH).toBe("/manifest.webmanifest");
  });

  test("only the shared layout references the manifest (no per-page links)", async () => {
    const { Glob } = await import("bun");
    const offenders: string[] = [];

    for await (const file of new Glob("src/pages/**/*.astro").scan(".")) {
      const text = await readFile(file, "utf8");
      if (/rel="manifest"|manifest\.webmanifest/.test(text))
        offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});

describe("push service worker is unchanged", () => {
  test("registered at the fixed path with no scope override", async () => {
    const client = await readFile(
      "src/lib/ui/push-subscription-client.ts",
      "utf8"
    );

    expect(PUSH_SERVICE_WORKER_PATH).toBe("/push-sw.js");
    expect(client).toContain("register(\n    PUSH_SERVICE_WORKER_PATH\n  )");
    expect(client).not.toMatch(/scope\s*:/);
  });

  test("the manifest scope does not claim the worker's path", () => {
    // The worker lives at the origin root and keeps its default scope; the
    // manifest scope is a separate, narrower concept and must not name it.
    expect(PUSH_SERVICE_WORKER_PATH.startsWith(ADMIN_SCOPE)).toBe(false);
  });
});

describe("push install guidance", () => {
  const iphoneTab = {
    navigator: {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
      maxTouchPoints: 5
    },
    matchMedia: () => ({ matches: false })
  };

  test("iOS browser tab (no PushManager) -> install guidance", () => {
    expect(classifyPushGuidance(detectPushEnvironment(iphoneTab))).toBe(
      "ios-install"
    );
  });

  test("iPadOS reporting a Mac UA is still recognised as iOS", () => {
    const ipad = {
      navigator: {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        platform: "MacIntel",
        maxTouchPoints: 5
      },
      matchMedia: () => ({ matches: false })
    };

    expect(classifyPushGuidance(detectPushEnvironment(ipad))).toBe(
      "ios-install"
    );
  });

  test("a desktop Mac without touch is not iOS", () => {
    const mac = {
      navigator: {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        platform: "MacIntel",
        maxTouchPoints: 0
      }
    };

    expect(classifyPushGuidance(detectPushEnvironment(mac))).toBe(
      "unsupported"
    );
  });

  test("installed iOS app without push API -> update the OS", () => {
    const env = detectPushEnvironment({
      ...iphoneTab,
      navigator: { ...iphoneTab.navigator, standalone: true }
    });

    expect(env.standalone).toBe(true);
    expect(classifyPushGuidance(env)).toBe("ios-update");
  });

  test("standalone is detected from the display-mode media query too", () => {
    const env = detectPushEnvironment({
      ...iphoneTab,
      matchMedia: (query: string) => ({
        matches: query === "(display-mode: standalone)"
      })
    });

    expect(env.standalone).toBe(true);
  });

  test("installed iOS app with the push API -> ready, then denied", () => {
    const base = {
      ...iphoneTab,
      navigator: {
        ...iphoneTab.navigator,
        standalone: true,
        serviceWorker: {}
      },
      PushManager: function PushManager() {}
    };

    expect(
      classifyPushGuidance(
        detectPushEnvironment({
          ...base,
          Notification: { permission: "default" }
        })
      )
    ).toBe("ready");
    expect(
      classifyPushGuidance(
        detectPushEnvironment({
          ...base,
          Notification: { permission: "denied" }
        })
      )
    ).toBe("denied");
  });

  test("desktop Chrome with push is ready (flow unchanged)", () => {
    const chrome = detectPushEnvironment({
      navigator: {
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0",
        platform: "Linux x86_64",
        maxTouchPoints: 0,
        serviceWorker: {}
      },
      PushManager: function PushManager() {},
      Notification: { permission: "default" }
    });

    expect(classifyPushGuidance(chrome)).toBe("ready");
  });
});

describe("guidance markup (accessibility + i18n)", () => {
  test("variants are translated, hidden by default, inside a live region", async () => {
    const source = await readFile(PAGE, "utf8");

    expect(source).toContain('id="push-live" aria-live="polite"');
    // Exactly ONE live region: nested ones double-announce.
    expect(source.match(/aria-live=/g)?.length).toBe(1);
    expect(source).toContain('<div id="push-guidance">');
    for (const state of [
      "ios-install",
      "ios-update",
      "unsupported",
      "denied"
    ]) {
      expect(source).toMatch(new RegExp(`data-guidance="${state}"\\s+hidden`));
    }
    // Ordered, keyboard-readable steps rather than a paragraph.
    expect(source).toMatch(/<ol>[\s\S]*<li>[\s\S]*<\/ol>/);
    expect(source).toContain("Add to Home Screen");
    expect(source).toContain('id="push-offline-note"');
  });

  test("permission is only requested from the click handler", async () => {
    const source = await readFile(PAGE, "utf8");
    const client = await readFile(
      "src/lib/ui/push-subscription-client.ts",
      "utf8"
    );

    expect(source).not.toMatch(/Notification\.requestPermission/);
    expect(source).toContain('enableButton?.addEventListener("click"');
    expect(
      client.match(/await Notification\.requestPermission\(\)/g)?.length
    ).toBe(1);
  });

  test("every guidance string has an Indonesian translation", async () => {
    const en = await readFile("locales/en.po", "utf8");
    const id = await readFile("locales/id.po", "utf8");

    for (const msgid of [
      "Notifications on iPhone and iPad need the installed app.",
      "Open this page in Safari and tap Share, then Add to Home Screen, then Add.",
      "Close the tab and open AWCMS from the new Home Screen icon, then sign in."
    ]) {
      expect(en).toContain(`msgid "${msgid}"`);
      expect(id).toMatch(
        new RegExp(
          `msgid "${msgid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\nmsgstr "[^"]+"`
        )
      );
    }
  });
});

describe("branding text sanitising (Issue #1105 audit)", () => {
  test("bidi override, zero-width and C1 controls are stripped", () => {
    expect(resolvePwaIdentity({ PWA_APP_NAME: "Ac‮me" }).name).toBe("Acme");
    expect(resolvePwaIdentity({ PWA_APP_NAME: "A​c‍m﻿e" }).name).toBe("Acme");
    expect(resolvePwaIdentity({ PWA_APP_NAME: "Ac\u0085me" }).name).toBe(
      "Acme"
    );
    // Only invisible characters -> fallback, not an empty name.
    expect(resolvePwaIdentity({ PWA_APP_NAME: "‮​" }).name).toBe("AWCMS Admin");
  });

  test("truncation is by code point and never splits a surrogate pair", () => {
    // short_name max is 12 code points; 11 ASCII + one astral = 12 code points
    // but 13 UTF-16 units, so a unit-based slice(0, 12) would split the pair.
    const short = resolvePwaIdentity({
      PWA_APP_SHORT_NAME: "a".repeat(11) + "\u{1F600}" + "zzz"
    }).shortName;

    expect(Array.from(short).length).toBe(12);
    expect(short.endsWith("\u{1F600}")).toBe(true);
    expect(short).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);

    const cut = resolvePwaIdentity({
      PWA_APP_SHORT_NAME: "a".repeat(12) + "\u{1F600}"
    }).shortName;
    expect(cut).toBe("a".repeat(12));
  });
});

describe("manifest route response (Issue #1105 audit)", () => {
  type Handler = (context: {
    request: Request;
  }) => Promise<Response> | Response;
  const call = (host: string) =>
    (GET as unknown as Handler)({
      request: new Request(`https://${host}/manifest.webmanifest`, {
        headers: { host }
      })
    });

  test("is byte-identical whatever the Host header is", async () => {
    const a = await call("tenant-a.example.test");
    const b = await call("evil.example.test:8443");

    expect(await a.text()).toBe(await b.text());
    expect([...a.headers.entries()]).toEqual([...b.headers.entries()]);
  });

  test("content type, nosniff and cache headers", async () => {
    const response = await call("localhost");

    expect(response.headers.get("content-type")).toStartWith(
      "application/manifest+json"
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("route does no tenant or locale resolution", async () => {
    const source = (
      await readFile("src/pages/manifest.webmanifest.ts", "utf8")
    ).replace(/\/\*[\s\S]*?\*\//g, "");

    expect(source).not.toMatch(/locals|tenant|locale|request\.headers|Host/i);
    expect(source).not.toContain("serveDiscovery");
  });
});

describe("controls guarded by gates (mutation-proofed)", () => {
  test("the route is registered as a platform route", async () => {
    const proc = Bun.spawn(["bun", "scripts/validate-module-routes.ts"], {
      stdout: "pipe",
      stderr: "pipe"
    });

    expect(await proc.exited).toBe(0);
    expect(
      await readFile("scripts/validate-module-routes.ts", "utf8")
    ).toContain('route: "/manifest.webmanifest"');
  });

  test("the layout head carries no inline script other than theme-init", async () => {
    const source = await readFile(LAYOUT, "utf8");
    const head = source.slice(
      source.indexOf("<head>"),
      source.indexOf("</head>")
    );
    const scripts =
      head.match(/<script\b[\s\S]*?(?:\/>|<\/script[^>]*>)/gi) ?? [];

    expect(scripts.length).toBe(1);
    expect(scripts[0]).toContain("THEME_INIT_SCRIPT_BODY");
  });

  test("colour validation rejects non-hex values", () => {
    for (const bad of ["red", "#12", "#GGGGGG", "#2563eb;x", "rgb(0,0,0)"]) {
      expect(resolvePwaIdentity({ PWA_THEME_COLOR: bad }).themeColor).toBe(
        "#2563eb"
      );
    }
    expect(resolvePwaIdentity({ PWA_THEME_COLOR: "#abc" }).themeColor).toBe(
      "#abc"
    );
  });
});

describe("install guidance does not read as an access refusal", () => {
  // tests/e2e/admin-screens-render.e2e.ts treats any `[id$="-denied"]` as the
  // screen refusing its viewer. The page's one legitimate refusal hook is the
  // permission gate; guidance about the browser's notification permission
  // must not borrow that suffix, or an owner looks refused.
  test("only the screen's own gate carries a -denied id", async () => {
    const source = await readFile(
      "src/pages/admin/push-notifications.astro",
      "utf8"
    );
    const ids = [...source.matchAll(/\bid="([^"]*-denied)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["push-notifications-denied"]);
  });
});
