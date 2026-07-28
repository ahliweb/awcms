import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  AD_TARGET_TYPES,
  type AdTargetType
} from "../src/modules/blog-content/domain/ad-placement-policy";
import {
  classifyLegacyAdImage,
  mapLegacyPlacementToTarget
} from "../src/modules/blog-content/domain/legacy-ad-ingest";
import { buildNewsMediaObjectKey } from "../src/modules/media-library/domain/media-object-key";

/**
 * ADR-0044 §4 Fase 2, step two. This decides whether a live advertisement
 * survives the migration, so it is tested as a total function: every input
 * lands in a named bucket, and no bucket is silence.
 */
const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT_ID = "22222222-2222-2222-2222-222222222222";
const PUBLIC_BASE = "https://media.example.test";

function keyFor(tenantId: string): string {
  return buildNewsMediaObjectKey({
    tenantId,
    mimeType: "image/jpeg",
    now: new Date("2026-03-15T00:00:00.000Z"),
    uuid: "33333333-3333-3333-3333-333333333333"
  });
}

describe("classifyLegacyAdImage — what may migrate", () => {
  test("a public URL of this tenant's own media object is ingestable", () => {
    const objectKey = keyFor(TENANT_ID);

    const result = classifyLegacyAdImage({
      tenantId: TENANT_ID,
      imageUrl: `${PUBLIC_BASE}/${objectKey}`,
      publicBaseUrl: PUBLIC_BASE
    });

    expect(result).toEqual({ kind: "ingestable", objectKey });
  });

  test("the object key it derives is the one the media module would build", () => {
    // Pinned to `buildNewsMediaObjectKey` rather than to a hand-written string.
    // `legacy-ad-ingest.ts` re-implements the key shape to stay dependency-free,
    // and a drift between the two would send every ad to residue with no error
    // anywhere — the migration would simply "find nothing".
    const objectKey = keyFor(TENANT_ID);
    const result = classifyLegacyAdImage({
      tenantId: TENANT_ID,
      imageUrl: `${PUBLIC_BASE}/${objectKey}`,
      publicBaseUrl: PUBLIC_BASE
    });

    expect(result.kind).toBe("ingestable");
    if (result.kind !== "ingestable") return;
    expect(result.objectKey).toBe(objectKey);
  });

  test("a base URL with a trailing slash resolves the same key", () => {
    const objectKey = keyFor(TENANT_ID);

    expect(
      classifyLegacyAdImage({
        tenantId: TENANT_ID,
        imageUrl: `${PUBLIC_BASE}/${objectKey}`,
        publicBaseUrl: `${PUBLIC_BASE}/`
      })
    ).toEqual({ kind: "ingestable", objectKey });
  });

  test("a base URL with a path prefix is honoured", () => {
    const objectKey = keyFor(TENANT_ID);

    expect(
      classifyLegacyAdImage({
        tenantId: TENANT_ID,
        imageUrl: `${PUBLIC_BASE}/cdn/${objectKey}`,
        publicBaseUrl: `${PUBLIC_BASE}/cdn`
      })
    ).toEqual({ kind: "ingestable", objectKey });
  });
});

describe("classifyLegacyAdImage — what becomes residue", () => {
  function residueReasonFor(imageUrl: string, tenantId = TENANT_ID): string {
    const result = classifyLegacyAdImage({
      tenantId,
      imageUrl,
      publicBaseUrl: PUBLIC_BASE
    });

    expect(result.kind).toBe("residue");
    return result.kind === "residue" ? result.reason : "NOT_RESIDUE";
  }

  test("a remote image is residue, never fetched", () => {
    expect(residueReasonFor("https://cdn.advertiser.example/banner.jpg")).toBe(
      "remote_image"
    );
  });

  test("a look-alike host is residue — the check is origin, not string prefix", () => {
    // `https://media.example.test.evil.com/...` starts with the base URL as a
    // STRING. A prefix comparison would treat an attacker-controlled host as
    // this deployment's own media origin and hand it a managed placement.
    expect(
      residueReasonFor(
        `https://media.example.test.evil.com/${keyFor(TENANT_ID)}`
      )
    ).toBe("remote_image");
  });

  test("the same path on http instead of https is residue", () => {
    expect(
      residueReasonFor(`http://media.example.test/${keyFor(TENANT_ID)}`)
    ).toBe("remote_image");
  });

  test("a path outside the configured base prefix is residue", () => {
    const objectKey = keyFor(TENANT_ID);
    const result = classifyLegacyAdImage({
      tenantId: TENANT_ID,
      imageUrl: `${PUBLIC_BASE}/elsewhere/${objectKey}`,
      publicBaseUrl: `${PUBLIC_BASE}/cdn`
    });

    expect(result).toEqual({
      kind: "residue",
      reason: "remote_image",
      detail: `${PUBLIC_BASE}/elsewhere/${objectKey}`
    });
  });

  test("ANOTHER tenant's object key is residue — the cross-tenant case", () => {
    // The single most damaging thing this classifier could get wrong: a URL
    // that is genuinely on this deployment's media host, but whose key belongs
    // to a different tenant. Accepting it would publish one tenant's media
    // under another tenant's advertising.
    expect(residueReasonFor(`${PUBLIC_BASE}/${keyFor(OTHER_TENANT_ID)}`)).toBe(
      "foreign_object_key"
    );
  });

  test("a hand-edited path under the media host is residue", () => {
    expect(residueReasonFor(`${PUBLIC_BASE}/uploads/banner.jpg`)).toBe(
      "foreign_object_key"
    );
  });

  test("a path-traversal attempt does not escape the tenant prefix", () => {
    expect(
      residueReasonFor(
        `${PUBLIC_BASE}/news-media/${TENANT_ID}/../../${keyFor(OTHER_TENANT_ID)}`
      )
    ).toBe("foreign_object_key");
  });

  test("a relative or malformed URL is residue", () => {
    expect(residueReasonFor("/uploads/banner.jpg")).toBe("malformed_url");
    expect(residueReasonFor("not a url at all")).toBe("malformed_url");
    expect(residueReasonFor("")).toBe("malformed_url");
  });

  test("an unset media base makes every ad residue, loudly and losslessly", () => {
    const result = classifyLegacyAdImage({
      tenantId: TENANT_ID,
      imageUrl: `${PUBLIC_BASE}/${keyFor(TENANT_ID)}`,
      publicBaseUrl: ""
    });

    expect(result).toEqual({
      kind: "residue",
      reason: "remote_image",
      detail: `${PUBLIC_BASE}/${keyFor(TENANT_ID)}`
    });
  });
});

describe("mapLegacyPlacementToTarget", () => {
  test("the legacy and surviving vocabularies are the same four values", () => {
    // PR #301 chose `AD_TARGET_TYPES` to match the retired system's
    // `placement_type` exactly, which is what makes this mapping an identity
    // and the drop of `awcms_blog_ads` lossless. If either side drifts, this
    // fails here rather than in production as ads that map to a target the
    // render query never matches.
    for (const placementType of ["global", "widget", "post", "page"]) {
      expect(AD_TARGET_TYPES).toContain(placementType as AdTargetType);

      const mapping = mapLegacyPlacementToTarget({
        placementType,
        targetId:
          placementType === "global"
            ? null
            : "44444444-4444-4444-4444-444444444444"
      });

      expect(mapping.kind).toBe("mapped");
      if (mapping.kind !== "mapped") continue;
      expect(mapping.target.targetType).toBe(placementType as AdTargetType);
    }
  });

  test("a global row's stray target id is discarded, not carried", () => {
    // The legacy schema left `target_id` nullable and enforced "forbidden for
    // global" in application code only, so a stray id is a shape that table
    // genuinely permits. Carrying it would trip migration 078's pairing CHECK
    // and fail the whole tenant's ingest on one bad row.
    const mapping = mapLegacyPlacementToTarget({
      placementType: "global",
      targetId: "44444444-4444-4444-4444-444444444444"
    });

    expect(mapping).toEqual({
      kind: "mapped",
      target: { targetType: "global", targetId: null }
    });
  });

  test("a scoped row with no target is residue, not a silent global", () => {
    for (const placementType of ["widget", "post", "page"]) {
      const mapping = mapLegacyPlacementToTarget({
        placementType,
        targetId: null
      });

      expect(mapping.kind).toBe("residue");
      if (mapping.kind !== "residue") continue;
      expect(mapping.reason).toBe("scoped_placement_without_target");
    }
  });

  test("an unrecognised placement type is reported by name", () => {
    const mapping = mapLegacyPlacementToTarget({
      placementType: "category",
      targetId: "44444444-4444-4444-4444-444444444444"
    });

    expect(mapping).toEqual({
      kind: "residue",
      reason: "unknown_placement_type",
      detail: "category"
    });
  });
});

/**
 * Migration 079 carries three properties that only exist in its text, and each
 * one fails silently if it is wrong: a non-partial unique index would reject
 * ordinary editorial work, a missing `NULLS NOT DISTINCT` would let a re-run
 * duplicate every global ad, and a grant the job needs but does not have turns
 * an operator's migration window into a permission-denied stack trace.
 */
describe("migration 079 — ingest provenance and grants", () => {
  const MIGRATION = readFileSync(
    "sql/079_awcms_legacy_ad_ingest_provenance.sql",
    "utf8"
  );

  test("the provenance column is added", () => {
    expect(MIGRATION).toContain(
      "ADD COLUMN IF NOT EXISTS source_legacy_ad_id uuid"
    );
  });

  test("the unique index is PARTIAL, or it would reject hand-created rows", () => {
    // Every placement written by an editor has a NULL `source_legacy_ad_id`.
    // Without the partial predicate, `NULLS NOT DISTINCT` makes two
    // hand-created global placements in one tenant collide with each other —
    // the constraint would start rejecting ordinary work with a unique
    // violation that names a column no editor has ever heard of.
    expect(MIGRATION).toContain("WHERE source_legacy_ad_id IS NOT NULL");
  });

  test("NULLS NOT DISTINCT, or a re-run duplicates every global ad", () => {
    // An ingested `global` row has a NULL `target_id`. Under the default
    // NULLS-DISTINCT semantics two such rows never conflict, so
    // `ON CONFLICT DO NOTHING` never fires and the second run inserts the
    // whole set again.
    expect(MIGRATION).toContain("NULLS NOT DISTINCT");
  });

  test("the worker gets exactly the verbs the job uses, and no more", () => {
    for (const grant of [
      "GRANT SELECT ON awcms_blog_ads TO awcms_worker;",
      "GRANT SELECT ON awcms_blog_ad_placements TO awcms_worker;",
      "GRANT SELECT, INSERT ON awcms_news_portal_ad_placements TO awcms_worker;"
    ]) {
      expect(MIGRATION).toContain(grant);
    }

    // The job reads the legacy tables and reports; retiring them is a human's
    // decision after reading the residue, not a side effect of the job that
    // produced it.
    expect(MIGRATION).not.toContain("DELETE ON awcms_blog_ads");
    expect(MIGRATION).not.toContain("UPDATE ON awcms_blog_ads");

    // And the job may add successor rows, never rewrite one.
    expect(MIGRATION).not.toContain(
      "UPDATE ON awcms_news_portal_ad_placements"
    );
  });

  test("no grant on the media registry — the job looks up, it does not register", () => {
    // The design decision this whole step turns on. Granting INSERT here would
    // let a migration script mint a `verified` registry row for bytes it never
    // fetched, sniffed, or size-capped — the exact assertion the upload
    // pipeline exists to make. An unregistered image is residue instead.
    expect(MIGRATION).not.toContain(
      "ON awcms_news_media_objects TO awcms_worker"
    );
  });

  test("moves no data and drops no table", () => {
    const statements = MIGRATION.split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .toUpperCase();

    for (const forbidden of [
      "INSERT INTO",
      "DELETE FROM",
      "DROP TABLE",
      "UPDATE "
    ]) {
      expect(statements).not.toContain(forbidden);
    }
  });
});
