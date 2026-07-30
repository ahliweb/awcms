/**
 * Provenance gate for the vendored dataset (ADR-0046 §6/§7).
 *
 * `data/idn-admin-regions/manifest.json` and `checksums.sha256` are the record
 * an operator points at when asked where this data came from. A record nothing
 * verifies is not a record — it is a claim that stays convincing long after it
 * stops being true. So this test recomputes every checksum from the bytes on
 * disk, and asserts that each file's recorded decree number really appears in
 * that file's own header.
 *
 * Concretely, it fails when: a vendored file is edited, truncated, or swapped;
 * the manifest and `checksums.sha256` disagree; a file is vendored without being
 * recorded; or someone copies a decree reference from a sibling file (the exact
 * mistake awcms-mini shipped — one blanket decree for four files that cite two
 * different ones).
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import {
  IDN_ADMIN_REGIONS_DUMP_DECREE_REFERENCE,
  IDN_ADMIN_REGIONS_DUMP_PATH,
  IDN_ADMIN_REGIONS_SOURCE_LICENSE,
  IDN_ADMIN_REGIONS_SOURCE_REPOSITORY
} from "../src/modules/idn-admin-regions/domain/source-provenance";

const ROOT = process.cwd();
const DATA_DIR = "data/idn-admin-regions";
const VENDOR_DIR = `${DATA_DIR}/upstream/cahyadsn-wilayah`;

type ManifestFile = {
  path: string;
  sha256: string;
  bytes: number;
  role: string;
  decreeReference?: string | null;
  importedBy?: string | null;
};

type Manifest = {
  upstream: { repository: string; commit: string; license: string };
  officialReferenceCaveat: string;
  files: ManifestFile[];
};

async function loadManifest(): Promise<Manifest> {
  const raw = await readFile(
    path.join(ROOT, DATA_DIR, "manifest.json"),
    "utf8"
  );
  return JSON.parse(raw) as Manifest;
}

describe("idn_admin_regions vendored dataset provenance", () => {
  test("every manifest entry matches the real bytes on disk", async () => {
    const manifest = await loadManifest();

    expect(manifest.files.length).toBeGreaterThanOrEqual(5);

    for (const entry of manifest.files) {
      const bytes = await readFile(path.join(ROOT, DATA_DIR, entry.path));
      const digest = createHash("sha256").update(bytes).digest("hex");

      expect(`${entry.path}:${digest}`).toBe(`${entry.path}:${entry.sha256}`);
      expect(`${entry.path}:${bytes.byteLength}`).toBe(
        `${entry.path}:${entry.bytes}`
      );
    }
  });

  test("checksums.sha256 agrees with the manifest, file for file", async () => {
    const manifest = await loadManifest();
    const raw = await readFile(
      path.join(ROOT, VENDOR_DIR, "checksums.sha256"),
      "utf8"
    );

    const recorded = new Map(
      raw
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => {
          const [digest, file] = line.trim().split(/\s+/);
          return [file ?? "", digest ?? ""];
        })
    );

    for (const entry of manifest.files) {
      const relative = entry.path.replace("upstream/cahyadsn-wilayah/", "");
      expect(recorded.get(relative)).toBe(entry.sha256);
    }

    expect(recorded.size).toBe(manifest.files.length);
  });

  // The decree number is the fact an auditor asks about. It is recorded per
  // file because upstream's own files disagree with each other — copying one
  // sibling's number across all of them is precisely the drift this catches.
  test("each recorded decree reference appears in that file's own header", async () => {
    const manifest = await loadManifest();

    for (const entry of manifest.files) {
      if (!entry.decreeReference) continue;

      const text = await readFile(
        path.join(ROOT, DATA_DIR, entry.path),
        "utf8"
      );
      const header = text.slice(0, 2000).replace(/\r/g, "");

      expect(`${entry.path} -> ${header.includes(entry.decreeReference)}`).toBe(
        `${entry.path} -> true`
      );
    }
  });

  test("the code constants match the manifest they describe", async () => {
    const manifest = await loadManifest();

    expect(manifest.upstream.repository).toBe(
      IDN_ADMIN_REGIONS_SOURCE_REPOSITORY
    );
    expect(manifest.upstream.license).toBe(IDN_ADMIN_REGIONS_SOURCE_LICENSE);

    const imported = manifest.files.find(
      (entry) => `${DATA_DIR}/${entry.path}` === IDN_ADMIN_REGIONS_DUMP_PATH
    );

    expect(imported).toBeDefined();
    expect(imported?.decreeReference).toBe(
      IDN_ADMIN_REGIONS_DUMP_DECREE_REFERENCE
    );
    // Exactly one vendored file is read by code; the rest are companions from
    // the same commit. If that ever changes, it must change deliberately here.
    expect(
      manifest.files.filter((entry) => entry.importedBy === "idn_admin_regions")
    ).toHaveLength(1);
  });

  test("the official-reference caveat is present and says what it must", async () => {
    const manifest = await loadManifest();

    expect(manifest.officialReferenceCaveat).toContain("not an official");
    expect(manifest.officialReferenceCaveat).toContain("Kemendagri");
  });
});
