import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

import { mediaLibraryModule } from "../src/modules/media-library/module";
import { blogContentModule } from "../src/modules/blog-content/module";
import { newsPortalModule } from "../src/modules/news-portal/module";
import { CAPABILITY_CONTRACT_VERSIONS } from "../src/modules/_shared/capability-contract-versions";

/**
 * ADR-0036 inverted media ownership: `media_library` provides the media
 * capability, and `news_portal` — which used to provide it only because the
 * registry was born inside it — is now just another consumer.
 *
 * These tests pin the parts a typecheck cannot see. A capability name is a
 * string and an import is a path, so nothing but an assertion stops either
 * drifting back. The one that matters most is `media-library-port-adapter.ts`
 * never importing `news_portal`: that single edge is what the whole extraction
 * exists to remove, and re-adding it would compile perfectly.
 *
 * This file also serves as the capability-contract-version RETIREMENT test:
 * `news_media` must be gone and `media_library` must be present.
 */
describe("media capability ownership (ADR-0036)", () => {
  test("media_library provides `media_library`; news_portal provides nothing", () => {
    expect(mediaLibraryModule.capabilities?.provides).toEqual([
      "media_library"
    ]);
    expect(newsPortalModule.capabilities?.provides ?? []).toEqual([]);
  });

  test("RETIREMENT: `news_media` is gone from the version registry, `media_library` is present, and nobody declares news_media", () => {
    expect(CAPABILITY_CONTRACT_VERSIONS.news_media).toBeUndefined();
    expect(CAPABILITY_CONTRACT_VERSIONS.media_library).toBe("1.0.0");

    for (const module of [
      mediaLibraryModule,
      blogContentModule,
      newsPortalModule
    ]) {
      expect(module.capabilities?.provides ?? []).not.toContain("news_media");
      for (const consumed of module.capabilities?.consumes ?? []) {
        expect(consumed.capability).not.toBe("news_media");
      }
    }
  });

  test("every declared consumer of `media_library` names media_library as the provider — never news_portal", () => {
    for (const module of [blogContentModule, newsPortalModule]) {
      const entry = (module.capabilities?.consumes ?? []).find(
        (c) => c.capability === "media_library"
      );

      expect(entry).toBeDefined();
      expect(entry?.providedBy).toBe("media_library");
    }
  });

  test("every capability media_library declares is registered in CAPABILITY_CONTRACT_VERSIONS", () => {
    for (const provided of mediaLibraryModule.capabilities?.provides ?? []) {
      expect(CAPABILITY_CONTRACT_VERSIONS[provided]).toBeDefined();
    }
  });

  test("the media_library port adapter never imports news_portal/blog_content — the ADR-0013 §1 inversion this extraction removes", () => {
    const adapter = readFileSync(
      "src/modules/media-library/application/media-library-port-adapter.ts",
      "utf8"
    );

    const imports = [
      ...adapter.matchAll(/^import[\s\S]*?from "([^"]+)";$/gm)
    ].map((match) => match[1] as string);

    expect(imports.length).toBeGreaterThan(0);

    for (const specifier of imports) {
      expect(specifier).not.toContain("news-portal");
      expect(specifier).not.toContain("blog-content");
    }
  });

  test("the deleted news_media port and its adapters stay deleted", () => {
    for (const path of [
      "src/modules/_shared/ports/news-media-port.ts",
      "src/modules/news-portal/application/news-media-port-adapter.ts",
      "src/modules/blog-content/application/news-media-port-noop-adapter.ts"
    ]) {
      expect(existsSync(path)).toBe(false);
    }
  });
});
