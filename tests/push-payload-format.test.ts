/**
 * Declarative Web Push payload (Issue #1106, ADR-0074): the producer builder in
 * both formats, `navigate` validation against hostile inputs, the config switch
 * (default legacy), and the service worker's dual reader — loaded as the real
 * file against a fake `self`, so the contract under test is the shipped script.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  buildDeclarativePayload,
  buildPushNavigateUrl,
  buildPushPayload,
  resolvePushPayloadFormat,
  resolvePushPublicOrigin
} from "../src/modules/push-delivery/domain/push-payload-format";
import {
  validatePushTargetPath,
  PUSH_TARGET_PATH_MAX_CHARS
} from "../src/modules/push-delivery/domain/push-target-path";
import {
  base64UrlEncode,
  encryptWebPushPayload
} from "../src/modules/push-delivery/domain/web-push-encryption";
import { buildWebPushPayload } from "../src/modules/push-delivery/infrastructure/web-push-provider";
import { resolvePushProvider } from "../src/modules/push-delivery/infrastructure/push-provider-resolver";

const ORIGIN = "https://app.example.com";
const message = {
  title: "Order paid",
  body: "Order 42 was paid.",
  targetPath: "/admin/orders/42?tab=1",
  data: { category: "orders" }
};

describe("config switch", () => {
  test("defaults to legacy; unknown values fail closed to legacy", () => {
    expect(resolvePushPayloadFormat({})).toBe("legacy");
    expect(resolvePushPayloadFormat({ PUSH_PAYLOAD_FORMAT: "" })).toBe(
      "legacy"
    );
    expect(resolvePushPayloadFormat({ PUSH_PAYLOAD_FORMAT: "bogus" })).toBe(
      "legacy"
    );
    expect(
      resolvePushPayloadFormat({ PUSH_PAYLOAD_FORMAT: " declarative " })
    ).toBe("declarative");
  });

  test("public origin must be https without credentials", () => {
    expect(resolvePushPublicOrigin("https://app.example.com/x?y")).toBe(ORIGIN);
    expect(resolvePushPublicOrigin("http://localhost:4321")).toBeNull();
    expect(resolvePushPublicOrigin("https://u:p@app.example.com")).toBeNull();
    expect(resolvePushPublicOrigin("not a url")).toBeNull();
    expect(resolvePushPublicOrigin(undefined)).toBeNull();
  });

  test("the resolved provider carries the switch (legacy by default)", () => {
    // Resolution must not throw for either value; behaviour is covered below.
    const env = {
      PUSH_PROVIDER: "web_push",
      APP_URL: ORIGIN
    } as NodeJS.ProcessEnv;

    expect(resolvePushProvider(env).supportedTransports).toContain("web_push");
    expect(
      resolvePushProvider({ ...env, PUSH_PAYLOAD_FORMAT: "declarative" })
        .supportedTransports
    ).toContain("web_push");
  });
});

describe("producer payload", () => {
  test("legacy is byte-for-byte the pre-#1106 shape", () => {
    expect(JSON.parse(buildWebPushPayload(message))).toEqual({
      title: "Order paid",
      body: "Order 42 was paid.",
      targetPath: "/admin/orders/42?tab=1",
      data: { category: "orders" }
    });
    expect(
      buildPushPayload(message, { format: "legacy", publicOrigin: ORIGIN })
    ).toBe(buildWebPushPayload(message));
  });

  test("declarative follows the WebKit shape with an absolute navigate", () => {
    const parsed = JSON.parse(
      buildPushPayload(message, {
        format: "declarative",
        publicOrigin: ORIGIN
      })
    );

    expect(parsed).toEqual({
      web_push: 8030,
      notification: {
        title: "Order paid",
        body: "Order 42 was paid.",
        navigate: `${ORIGIN}/admin/orders/42?tab=1`,
        silent: false,
        tag: "orders",
        data: { category: "orders" }
      }
    });
  });

  test("declarative without an https origin drops to legacy", () => {
    const out = buildPushPayload(message, {
      format: "declarative",
      publicOrigin: null
    });

    expect(JSON.parse(out).web_push).toBeUndefined();
    expect(JSON.parse(out).targetPath).toBe("/admin/orders/42?tab=1");
  });

  test("empty title or oversize payload drops to legacy, never half-declarative", () => {
    expect(
      buildDeclarativePayload({ ...message, title: "   " }, ORIGIN)
    ).toBeNull();
    expect(
      buildDeclarativePayload(
        {
          title: "😀".repeat(120),
          body: "😀".repeat(240),
          targetPath: `/admin/${"a".repeat(500)}`
        },
        ORIGIN
      )
    ).toBeNull();
  });

  test("long title and body are truncated to the approved size", () => {
    const parsed = JSON.parse(
      buildDeclarativePayload(
        { title: "t".repeat(500), body: "b".repeat(900) },
        ORIGIN
      ) as string
    );

    expect(Array.from(parsed.notification.title).length).toBe(120);
    expect(Array.from(parsed.notification.body).length).toBe(240);
    expect(parsed.notification.tag).toBeUndefined();
  });

  test("no body and no targetPath still yields a valid payload at the admin root", () => {
    const parsed = JSON.parse(
      buildDeclarativePayload({ title: "Hi", body: "" }, ORIGIN) as string
    );

    expect(parsed.notification.body).toBeUndefined();
    expect(parsed.notification.navigate).toBe(`${ORIGIN}/admin`);
  });
});

describe("navigate validation (hostile inputs)", () => {
  const hostile = [
    "https://evil.test/x",
    "http://evil.test/x",
    "//evil.test/x",
    "/\\evil.test",
    "/.//evil.test",
    "/a/..//evil.test",
    "\\\\evil.test",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>1</script>",
    "vbscript:x",
    "file:///etc/passwd",
    "blob:https://app.example.com/x",
    "admin/no-leading-slash",
    "/a b",
    "/\u0000x",
    "/<script>",
    "",
    "   "
  ];

  for (const input of hostile) {
    test(`rejects ${JSON.stringify(input)} and falls back to the admin root`, () => {
      const result = buildPushNavigateUrl(ORIGIN, input);

      if (input === "") {
        expect(result).toEqual({ ok: true, url: `${ORIGIN}/admin` });
      } else {
        expect(result.ok).toBe(false);
      }

      const parsed = JSON.parse(
        buildDeclarativePayload(
          { title: "t", body: "b", targetPath: input },
          ORIGIN
        ) as string
      );

      expect(parsed.notification.navigate).toBe(`${ORIGIN}/admin`);
    });
  }

  test("rejects a non-https or missing origin", () => {
    expect(buildPushNavigateUrl(null, "/admin").ok).toBe(false);
  });

  test("accepts a same-origin path and keeps the query and hash", () => {
    expect(buildPushNavigateUrl(ORIGIN, "/admin/x?y=1#z")).toEqual({
      ok: true,
      url: `${ORIGIN}/admin/x?y=1#z`
    });
  });
});

// ---------------------------------------------------------------------------
// Service worker dual reader — the shipped file, against a fake `self`.
// ---------------------------------------------------------------------------

type Listener = (event: unknown) => void;

function loadServiceWorker() {
  const listeners: Record<string, Listener> = {};
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  let windows: Array<Record<string, unknown>> = [];

  const fakeSelf = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Listener) => {
      listeners[type] = fn;
    },
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });

        return Promise.resolve();
      }
    },
    clients: {
      matchAll: () => Promise.resolve(windows),
      openWindow: (url: string) => {
        opened.push(url);

        return Promise.resolve();
      }
    }
  };

  const source = readFileSync("public/push-sw.js", "utf8");

  new Function("self", source)(fakeSelf);

  async function push(data: unknown) {
    const waits: Promise<unknown>[] = [];
    let calls = 0;

    listeners.push!({
      data:
        data === undefined
          ? null
          : {
              json: () => {
                calls += 1;

                if (typeof data === "string") return JSON.parse(data);

                return data;
              }
            },
      waitUntil: (p: Promise<unknown>) => waits.push(p)
    });
    await Promise.all(waits);

    return { waits: waits.length, calls };
  }

  async function click(url: unknown) {
    const waits: Promise<unknown>[] = [];

    listeners.notificationclick!({
      notification: {
        close: () => {},
        data: url === undefined ? null : { url }
      },
      waitUntil: (p: Promise<unknown>) => waits.push(p)
    });
    await Promise.all(waits);
  }

  return {
    shown,
    opened,
    navigated,
    push,
    click,
    setWindows: (w: Array<Record<string, unknown>>) => {
      windows = w;
    }
  };
}

describe("service worker dual reader", () => {
  test("legacy payload renders title/body/target", async () => {
    const sw = loadServiceWorker();
    const { waits } = await sw.push({
      title: "Legacy",
      body: "Body",
      targetPath: "/admin/a",
      data: { category: "c" }
    });

    expect(waits).toBe(1);
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0]?.title).toBe("Legacy");
    expect(sw.shown[0]?.options).toEqual({
      body: "Body",
      data: { url: `${ORIGIN}/admin/a` },
      tag: "c"
    });
  });

  test("declarative payload renders the same notification, exactly once", async () => {
    const sw = loadServiceWorker();
    const { waits } = await sw.push({
      web_push: 8030,
      notification: {
        title: "Decl",
        body: "Body",
        navigate: `${ORIGIN}/admin/b`,
        silent: false,
        tag: "t"
      }
    });

    expect(waits).toBe(1);
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0]?.title).toBe("Decl");
    expect(sw.shown[0]?.options).toEqual({
      body: "Body",
      data: { url: `${ORIGIN}/admin/b` },
      tag: "t"
    });
  });

  test("declarative tag falls back to data.category", async () => {
    const sw = loadServiceWorker();

    await sw.push({
      web_push: 8030,
      notification: {
        title: "D",
        navigate: `${ORIGIN}/admin`,
        data: { category: "orders" }
      }
    });
    expect(sw.shown[0]?.options.tag).toBe("orders");
  });

  test("hostile navigate / targetPath never leave the origin", async () => {
    const hostile = [
      "https://evil.test/x",
      "//evil.test/x",
      "javascript:alert(1)",
      "data:text/html,x",
      "/\\evil.test",
      42,
      null,
      {}
    ];

    for (const value of hostile) {
      const sw = loadServiceWorker();

      await sw.push({
        web_push: 8030,
        notification: { title: "t", navigate: value }
      });
      await sw.push({ title: "t", body: "b", targetPath: value });

      for (const entry of sw.shown) {
        expect((entry.options.data as { url: string }).url).toBe(
          `${ORIGIN}/admin`
        );
      }
    }
  });

  test("malformed, empty and non-object payloads show one fallback notification", async () => {
    const inputs: unknown[] = [
      undefined,
      "not json{",
      "[]",
      "null",
      "42",
      { web_push: 8030 },
      { web_push: 8030, notification: "x" },
      { web_push: 1, notification: { title: "ignored" } }
    ];

    for (const input of inputs) {
      const sw = loadServiceWorker();
      const { waits } = await sw.push(input);

      expect(waits).toBe(1);
      expect(sw.shown).toHaveLength(1);
      expect(typeof sw.shown[0]?.title).toBe("string");
      expect(sw.shown[0]?.title).not.toBe("");
    }
  });

  test("a push with a non-8030 marker is read as legacy, not declarative", async () => {
    const sw = loadServiceWorker();

    await sw.push({ web_push: 1, notification: { title: "x" }, title: "L" });
    expect(sw.shown[0]?.title).toBe("L");
  });

  test("click opens only a validated same-origin URL", async () => {
    const sw = loadServiceWorker();

    await sw.click(`${ORIGIN}/admin/ok`);
    await sw.click("https://evil.test/");
    await sw.click("javascript:alert(1)");
    await sw.click("//evil.test");
    await sw.click(undefined);

    expect(sw.opened).toEqual([
      `${ORIGIN}/admin/ok`,
      `${ORIGIN}/admin`,
      `${ORIGIN}/admin`,
      `${ORIGIN}/admin`,
      `${ORIGIN}/admin`
    ]);
  });

  test("click navigates an existing window to the validated URL only", async () => {
    const sw = loadServiceWorker();
    const navigated: string[] = [];

    sw.setWindows([
      {
        url: `${ORIGIN}/admin/old`,
        navigate: (u: string) => navigated.push(u),
        focus: () => Promise.resolve()
      }
    ]);
    await sw.click("https://evil.test/");

    expect(navigated).toEqual([`${ORIGIN}/admin`]);
    expect(sw.opened).toEqual([]);
  });
});

describe("size and field bounds (security audit of #1106)", () => {
  async function keys() {
    const pair = (await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"]
    )) as CryptoKeyPair;
    const raw = new Uint8Array(
      await crypto.subtle.exportKey("raw", pair.publicKey)
    );

    return {
      p256dh: base64UrlEncode(raw),
      authSecret: base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)))
    };
  }

  test("emoji title/body and a long path always encrypt, in both formats", async () => {
    const huge = {
      title: "😀".repeat(200),
      body: "😀".repeat(500),
      targetPath: `/admin/${"a".repeat(1500)}`,
      data: { category: "c".repeat(3000), other: "x".repeat(3000) }
    };
    const k = await keys();

    for (const format of ["legacy", "declarative"] as const) {
      const out = buildPushPayload(huge, {
        format,
        publicOrigin: ORIGIN
      });
      const parsed = JSON.parse(out);

      await expect(encryptWebPushPayload(out, k)).resolves.toBeInstanceOf(
        Uint8Array
      );
      expect(Array.from(parsed.title ?? parsed.notification.title).length).toBe(
        120
      );
    }
  });

  test("legacy with an oversize data object sheds data before it sheds the message", () => {
    const out = JSON.parse(
      buildWebPushPayload({
        title: "t",
        body: "b",
        targetPath: "/admin/x",
        data: { category: "x".repeat(5000) }
      })
    );

    expect(out.data).toBeUndefined();
    expect(out.targetPath).toBe("/admin/x");
  });

  test("targetPath over the cap is rejected; at the cap it is accepted", () => {
    const at = "/" + "a".repeat(PUSH_TARGET_PATH_MAX_CHARS - 1);

    expect(validatePushTargetPath(at).valid).toBe(true);
    expect(validatePushTargetPath(at + "a").valid).toBe(false);
  });

  test("normalising paths that become protocol-relative are rejected", () => {
    expect(validatePushTargetPath("/.//evil.test").valid).toBe(false);
    expect(validatePushTargetPath("/a/..//evil.test").valid).toBe(false);
  });

  test("an over-long category is not used as a declarative tag", () => {
    const parsed = JSON.parse(
      buildDeclarativePayload(
        { title: "t", body: "b", data: { category: "c".repeat(65) } },
        ORIGIN
      ) as string
    );

    expect(parsed.notification.tag).toBeUndefined();
  });

  test("the worker caps the tag", async () => {
    const sw = loadServiceWorker();

    await sw.push({ title: "t", data: { category: "c".repeat(200) } });
    expect((sw.shown[0]?.options.tag as string).length).toBe(64);
  });

  test("the format switch is trimmed and case-insensitive at runtime", () => {
    expect(
      resolvePushPayloadFormat({ PUSH_PAYLOAD_FORMAT: " Declarative " })
    ).toBe("declarative");
    expect(
      resolvePushPayloadFormat({ PUSH_PAYLOAD_FORMAT: "DECLARATIVE" })
    ).toBe("declarative");
  });

  test("config:validate treats the switch the same way", async () => {
    const { validateEnv } = await import("../scripts/validate-env");
    const base = {
      APP_ENV: "development",
      APP_URL: "http://localhost:4321",
      DATABASE_URL: "postgres://a@localhost/db",
      PUSH_ENABLED: "true",
      PUSH_PROVIDER: "web_push"
    };
    const run = (format: string) =>
      validateEnv({ ...base, PUSH_PAYLOAD_FORMAT: format }).filter(
        (p: string) => p.includes("PUSH_PAYLOAD_FORMAT")
      );

    // Padded/upper-case value is valid AND still triggers the https rule.
    expect(run(" DECLARATIVE ")).toHaveLength(1);
    expect(run(" DECLARATIVE ")[0]).toContain("https");
    expect(run("bogus")).toHaveLength(1);
    expect(run("legacy")).toHaveLength(0);
  });

  test("a client with an unparsable URL is skipped, and a rejected navigate is contained", async () => {
    const sw = loadServiceWorker();
    const opened: string[] = [];

    sw.setWindows([
      { url: "not a url", focus: () => Promise.resolve() },
      { url: `${ORIGIN}.evil.test/`, focus: () => Promise.resolve() },
      {
        url: `${ORIGIN}/admin/x`,
        navigate: () => Promise.reject(new Error("boom")),
        focus: () => Promise.reject(new Error("boom"))
      }
    ]);
    await sw.click(`${ORIGIN}/admin/ok`);
    expect(opened).toEqual([]);
    expect(sw.opened).toEqual([]);
  });
});
