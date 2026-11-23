/**
 * Deployment product identity (Issue #1352). Pure: no database, no network.
 */
import { readdir, readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import packageJson from "../package.json";
import {
  cleanSameOriginPath,
  resolveProductIdentity
} from "../src/lib/product-identity";
import {
  buildWebAppManifest,
  resolvePwaIdentity
} from "../src/lib/pwa/web-app-manifest";

describe("defaults reproduce the previous output", () => {
  test("no configuration = the strings the templates used to hard-code", () => {
    expect(resolveProductIdentity({})).toEqual({
      productName: "AWCMS",
      wordmark: "AWCMS",
      mark: "A",
      version: packageJson.version,
      frontDoorPath: null,
      icons: {
        icon192: null,
        icon512: null,
        iconMaskable512: null,
        appleTouch: null
      }
    });
  });

  test("the default manifest is byte-identical to the pre-#1352 one", () => {
    expect(buildWebAppManifest(resolvePwaIdentity({}))).toEqual({
      id: "/admin/",
      name: "AWCMS Admin",
      short_name: "AWCMS",
      start_url: "/admin/",
      scope: "/admin/",
      display: "standalone",
      theme_color: "#2563eb",
      background_color: "#ffffff",
      icons: [
        {
          src: "/icons/icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any"
        },
        {
          src: "/icons/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any"
        },
        {
          src: "/icons/icon-maskable-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable"
        }
      ]
    });
  });

  test("empty or invalid values fall back instead of throwing", () => {
    const identity = resolveProductIdentity({
      PRODUCT_NAME: "<script>alert(1)</script>",
      PRODUCT_WORDMARK: "   ",
      PRODUCT_VERSION: "not a version!",
      PRODUCT_FRONT_DOOR_PATH: "https://evil.example/"
    });

    expect(identity.productName).toBe("AWCMS");
    expect(identity.wordmark).toBe("AWCMS");
    expect(identity.version).toBe(packageJson.version);
    expect(identity.frontDoorPath).toBeNull();
  });
});

describe("a configured identity", () => {
  const env = {
    PRODUCT_NAME: "Acme Suite",
    PRODUCT_VERSION: "2026.11-rc.1",
    PRODUCT_FRONT_DOOR_PATH: "/admin",
    PWA_ICON_192_PATH: "/brand/i-192.png",
    PWA_ICON_512_PATH: "/brand/i-512.png",
    PWA_ICON_MASKABLE_512_PATH: "/brand/i-m.png",
    PWA_APPLE_TOUCH_ICON_PATH: "/brand/touch.png"
  };

  test("name, wordmark, mark, version and front door follow the config", () => {
    const identity = resolveProductIdentity(env);

    expect(identity.productName).toBe("Acme Suite");
    expect(identity.wordmark).toBe("Acme Suite");
    expect(identity.mark).toBe("A");
    expect(identity.version).toBe("2026.11-rc.1");
    expect(identity.frontDoorPath).toBe("/admin");
  });

  test("an explicit wordmark wins and sets the mark letter", () => {
    const identity = resolveProductIdentity({
      PRODUCT_NAME: "Acme Suite",
      PRODUCT_WORDMARK: "zeta"
    });

    expect(identity.wordmark).toBe("zeta");
    expect(identity.mark).toBe("Z");
  });

  test("the manifest name and icons follow; the id and scope do not", () => {
    const manifest = buildWebAppManifest(resolvePwaIdentity(env));

    expect(manifest.name).toBe("Acme Suite Admin");
    expect(manifest.short_name).toBe("Acme Suite");
    expect(manifest.icons.map((icon) => icon.src)).toEqual([
      "/brand/i-192.png",
      "/brand/i-512.png",
      "/brand/i-m.png"
    ]);
    // Installed-app identity must never depend on configuration.
    expect(manifest.id).toBe("/admin/");
    expect(manifest.scope).toBe("/admin/");
  });

  test("PWA_APP_NAME is more specific than PRODUCT_NAME", () => {
    const manifest = buildWebAppManifest(
      resolvePwaIdentity({ ...env, PWA_APP_NAME: "Acme Console" })
    );

    expect(manifest.name).toBe("Acme Console");
  });

  test("the configured version never reaches the compatibility version", async () => {
    // Display only: module compatibility reads package.json, not this resolver.
    const offenders: string[] = [];

    for (const dir of ["src/modules", "src/lib/semver"]) {
      for (const file of await listFiles(dir)) {
        if ((await readFile(file, "utf8")).includes("product-identity")) {
          offenders.push(file);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("validation", () => {
  test.each([
    "https://evil.example/x",
    "//evil.example/x",
    "javascript:alert(1)",
    "/a/../b",
    "/a\\b",
    "/a?x=1",
    "/a#frag",
    "relative/path",
    "/with space",
    "/" + "a".repeat(250)
  ])("rejects %s as a path", (bad) => {
    expect(cleanSameOriginPath(bad)).toBeNull();
  });

  test("accepts a plain same-origin path", () => {
    expect(cleanSameOriginPath("/brand/icon-192.png")).toBe(
      "/brand/icon-192.png"
    );
  });

  test("the front door never points at / (it would loop)", () => {
    expect(
      resolveProductIdentity({ PRODUCT_FRONT_DOOR_PATH: "/" }).frontDoorPath
    ).toBeNull();
  });

  test.each(['A"B', "A<B", "A&B", "A'B", "A`B"])(
    "rejects markup characters in a name: %s",
    (bad) => {
      expect(resolveProductIdentity({ PRODUCT_NAME: bad }).productName).toBe(
        "AWCMS"
      );
    }
  );

  test("strips control and bidi characters and caps the length", () => {
    const identity = resolveProductIdentity({
      PRODUCT_NAME: `Ac‮me\u0000${"x".repeat(100)}`
    });

    expect(identity.productName).not.toMatch(/[‮\u0000]/);
    expect(Array.from(identity.productName).length).toBe(60);
  });
});

describe("the surfaces read the resolver instead of hard-coding the name", () => {
  async function authPages(): Promise<string[]> {
    const pages: string[] = [];

    for (const entry of await readdir("src/pages")) {
      if (!entry.endsWith(".astro")) {
        continue;
      }

      const source = await readFile(`src/pages/${entry}`, "utf8");

      if (
        source.includes("styles/auth.css") ||
        source.includes("AuthBrandPanel")
      ) {
        pages.push(entry);
      }
    }

    return pages;
  }

  test("every auth page uses the resolver, not a literal wordmark", async () => {
    const pages = await authPages();

    // The five known auth pages, so an emptied scan cannot pass vacuously.
    expect(pages.sort()).toEqual(
      [
        "accept-invitation.astro",
        "forgot-password.astro",
        "login.astro",
        "register.astro",
        "reset-password.astro"
      ].sort()
    );

    for (const page of pages) {
      const source = await readFile(`src/pages/${page}`, "utf8");

      expect(source, page).toContain("resolveProductIdentity");
      expect(source, page).not.toMatch(/<span class="auth-wordmark">AWCMS</);
      expect(source, page).not.toMatch(/·\s*AWCMS\s*(<|\n)/);
    }
  });

  test("the shell, panel and front door use the resolver", async () => {
    for (const file of [
      "src/layouts/AdminLayout.astro",
      "src/components/AuthBrandPanel.astro",
      "src/pages/index.astro"
    ]) {
      const source = await readFile(file, "utf8");

      expect(source, file).toContain("resolveProductIdentity");
    }

    const shell = await readFile("src/layouts/AdminLayout.astro", "utf8");

    expect(shell).not.toContain("<title>{title} · AWCMS</title>");
    expect(shell).not.toContain('from "../../package.json"');
  });

  test("the front door redirect is temporary (302), never 301", async () => {
    const source = await readFile("src/pages/index.astro", "utf8");

    expect(source).toContain("Astro.response.status = 302");
    expect(source).toContain('headers.set("location", identity.frontDoorPath)');
    expect(source).not.toMatch(/status = 301/);
  });
});

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;

    if (entry.isDirectory()) {
      out.push(...(await listFiles(path)));
    } else if (/\.(ts|astro)$/.test(entry.name)) {
      out.push(path);
    }
  }

  return out;
}
