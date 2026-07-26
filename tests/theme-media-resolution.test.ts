/**
 * Theme asset slots resolve through `MediaLibraryPort`, and unresolvable slots
 * degrade instead of failing.
 *
 * ## What this covers that nothing did
 *
 * `resolveThemeAssetUrls` returned `{}` unconditionally and had no test — there
 * was nothing to assert. The empty return was written when `media_library` did
 * not exist, and survived the module landing because the file's own header
 * explained the no-op as intentional. Nothing compared that explanation to the
 * registry, so a tenant's uploaded logo silently never rendered.
 *
 * The omission path is the one that actually matters in production. A theme is
 * public-facing: a stale, deleted, or cross-tenant asset id must drop the slot
 * and fall back, never throw, or a bad id takes down the page. The port already
 * guarantees "unsafe ids are absent from the map, never thrown"; these tests
 * pin that this function relies on exactly that and adds no second, driftable
 * validation of its own.
 *
 * A fake port, not a database: the behaviour under test is the mapping from
 * `assetRefs` to slot-keyed URLs and what happens when a lookup misses. Both
 * are pure given the port's contract, and the real port has its own DB-backed
 * tests.
 */
import { describe, expect, test } from "bun:test";

import type {
  MediaLibraryPort,
  ResolvedMediaReferenceDTO
} from "../src/modules/_shared/ports/media-library-port";
import type { ThemeConfig } from "../src/modules/theming/domain/theme-config";
import { resolveThemeAssetUrls } from "../src/lib/theming/theme-media";

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TX = {} as Bun.SQL;

function reference(publicUrl: string, altText: string | null = null) {
  return {
    publicUrl,
    altText,
    mimeType: "image/png",
    width: null,
    height: null,
    sizeBytes: null
  } satisfies ResolvedMediaReferenceDTO;
}

/**
 * Resolves only the ids it was given, and records every call so the
 * de-duplication and skip-the-round-trip behaviours can be asserted rather than
 * assumed from the output (identical output, different number of queries).
 */
function fakePort(known: Record<string, ResolvedMediaReferenceDTO>) {
  const calls: (readonly string[])[] = [];

  const port: MediaLibraryPort = {
    async isManagedMediaEnforcementActiveForTenant() {
      return false;
    },
    async isMediaReferenceSafe(_tx, _tenantId, mediaObjectId) {
      return mediaObjectId in known;
    },
    async resolveMediaReferences(_tx, _tenantId, mediaObjectIds) {
      calls.push(mediaObjectIds);
      return new Map(
        mediaObjectIds
          .filter((id) => id in known)
          .map((id) => [id, known[id]!] as const)
      );
    }
  };

  return { port, calls };
}

function config(assetRefs: Record<string, string>): ThemeConfig {
  return {
    tokenOverrides: {},
    slotSelections: {},
    assetRefs,
    sectionOrder: [],
    navPlacement: "top"
  } as unknown as ThemeConfig;
}

describe("theme asset resolution goes through media_library", () => {
  test("a slot pointing at a safe object resolves to its public URL and alt text", async () => {
    const { port } = fakePort({
      "media-logo": reference("https://cdn.example/logo.png", "AhliWeb")
    });

    const assets = await resolveThemeAssetUrls(
      TX,
      TENANT,
      config({ logo: "media-logo" }),
      port
    );

    expect(assets).toEqual({
      logo: { url: "https://cdn.example/logo.png", altText: "AhliWeb" }
    });
  });

  test("an unresolvable id omits its slot instead of throwing", async () => {
    // The port returns nothing for unsafe/cross-tenant/deleted ids. A public
    // theme page must degrade, not 500, so this is the load-bearing case.
    const { port } = fakePort({
      "media-logo": reference("https://cdn.example/logo.png")
    });

    const assets = await resolveThemeAssetUrls(
      TX,
      TENANT,
      config({ logo: "media-logo", favicon: "media-deleted" }),
      port
    );

    expect(Object.keys(assets)).toEqual(["logo"]);
    expect(assets.favicon).toBeUndefined();
  });

  test("two slots sharing one object ask the port once for that id", async () => {
    const { port, calls } = fakePort({
      "media-logo": reference("https://cdn.example/logo.png", "shared")
    });

    const assets = await resolveThemeAssetUrls(
      TX,
      TENANT,
      config({ logo: "media-logo", favicon: "media-logo" }),
      port
    );

    expect(calls).toEqual([["media-logo"]]);
    expect(assets.logo).toEqual(assets.favicon!);
  });

  test("no asset refs means no port call at all", async () => {
    // Every public page render passes through here; the common case must not
    // cost a query. Asserted on the call log because the output is `{}` either
    // way — the thing being tested is invisible in the return value.
    const { port, calls } = fakePort({});

    expect(await resolveThemeAssetUrls(TX, TENANT, config({}), port)).toEqual(
      {}
    );
    expect(calls).toEqual([]);
  });

  test("empty-string and non-string ids are dropped before the port sees them", async () => {
    const { port, calls } = fakePort({});

    const assets = await resolveThemeAssetUrls(
      TX,
      TENANT,
      config({ logo: "", favicon: null as unknown as string }),
      port
    );

    expect(assets).toEqual({});
    expect(calls).toEqual([]);
  });
});
