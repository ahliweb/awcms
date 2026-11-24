/**
 * Pinned contract fixtures pack: manifest and hygiene (Issue #1394, ADR-0167).
 *
 * The committed pack must pass; every rule has a negative case, so a scanner
 * that stopped looking turns a test red.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  PACK_PATH,
  PACK_VERSION,
  computeContentSha256,
  type FixturePack
} from "../scripts/api-contract-fixtures";
import {
  scanPackHygiene,
  verifyManifest
} from "../scripts/lib/contract-fixture-pack-hygiene";
import { BUNDLED_PATH } from "../scripts/openapi-bundle";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

async function committed() {
  const text = await readFile(path.resolve(PACK_PATH), "utf8");
  const bundle = await readFile(path.resolve(BUNDLED_PATH), "utf8");
  return {
    text,
    pack: JSON.parse(text) as FixturePack,
    bundleSha: sha(bundle)
  };
}

/** A minimal pack carrying one planted string at `operations.x`. */
function planted(value: string): unknown {
  return { packVersion: PACK_VERSION, operations: { x: { note: value } } };
}

function rulesFor(value: string): string[] {
  return scanPackHygiene(planted(value)).map((f) => f.rule);
}

describe("the committed pack", () => {
  test("has a complete manifest that agrees with the content and the bundle", async () => {
    const { pack, bundleSha } = await committed();
    expect(
      verifyManifest(pack, { sha256: bundleSha, version: pack.contractVersion })
    ).toEqual([]);
    expect(Object.keys(pack).slice(0, 4)).toEqual([
      "packVersion",
      "contractVersion",
      "contractSha256",
      "contentSha256"
    ]);
  });

  test("the documented consumer snippet verifies it", async () => {
    const { text } = await committed();
    const { contentSha256, ...rest } = JSON.parse(text);
    expect(sha(`${JSON.stringify(rest, null, 2)}\n`)).toBe(contentSha256);
  });

  test("holds no secret, personal datum or foreign repository name", async () => {
    const { pack } = await committed();
    expect(scanPackHygiene(pack)).toEqual([]);
  });
});

describe("manifest verification (negative)", () => {
  test("a tampered value breaks contentSha256", async () => {
    const { pack, bundleSha } = await committed();
    const tampered = structuredClone(pack);
    tampered.summary.operations += 1;
    const problems = verifyManifest(tampered, {
      sha256: bundleSha,
      version: pack.contractVersion
    });
    expect(problems.join()).toContain("contentSha256 does not match");
  });

  test("a stale bundle hash, a wrong version and a wrong format are each reported", async () => {
    const { pack, bundleSha } = await committed();
    expect(
      verifyManifest(pack, {
        sha256: "0".repeat(64),
        version: pack.contractVersion
      }).join()
    ).toContain("contractSha256 does not match");
    expect(
      verifyManifest(pack, { sha256: bundleSha, version: "9.9.9" }).join()
    ).toContain("contractVersion");
    const old = { ...pack, packVersion: 1 };
    expect(
      verifyManifest(old, {
        sha256: bundleSha,
        version: pack.contractVersion
      }).join()
    ).toContain("packVersion");
  });

  test("a missing manifest field is reported", async () => {
    const { pack, bundleSha } = await committed();
    const { contentSha256: _drop, ...without } = pack;
    expect(
      verifyManifest(without, {
        sha256: bundleSha,
        version: pack.contractVersion
      }).join()
    ).toContain("contentSha256 is missing");
    expect(computeContentSha256(pack)).toBe(pack.contentSha256);
  });
});

describe("hygiene scanner (negative cases)", () => {
  test.each([
    [
      "a JWT",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij",
      "secret-jwt"
    ],
    ["a PEM key", "-----BEGIN PRIVATE KEY-----\nMIIE", "secret-pem"],
    [
      "an AWS key id inside prose",
      "key is AKIAABCDEFGHIJKLMNOP ok",
      "secret-aws-key-id"
    ],
    [
      "a bearer value inside prose",
      "send Bearer abcdefgh12345678 here",
      "secret-auth-header"
    ],
    [
      "a DSN with credentials",
      "postgres://user:hunter2@db.internal/app",
      "secret-dsn-credentials"
    ],
    [
      "a GitHub token",
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "secret-github-token"
    ],
    ["a live payment key", "sk_live_abcdefghij1234567890", "secret-live-key"],
    [
      "a real e-mail domain",
      "mail someone@gmail.com now",
      "pii-real-email-domain"
    ],
    ["a NIK-shaped number", "id 6201012345678901 end", "pii-nik-shape"],
    ["an NPWP shape", "npwp 01.234.567.8-901.000", "pii-npwp-shape"],
    [
      "an Indonesian mobile number",
      "call +6281234567890",
      "pii-id-mobile-number"
    ],
    [
      "a non-family repository URL",
      "see https://github.com/someone/private-app",
      "foreign-repository-name"
    ],
    [
      "an archived family-stem repository",
      "ported from awcms-mini",
      "foreign-repository-name"
    ],
    [
      "an org-prefixed foreign repository",
      "ahliweb/other-product",
      "foreign-repository-name"
    ]
  ])("%s is refused", (_label, value, rule) => {
    expect(rulesFor(value)).toContain(rule);
  });

  test("anchored secret-shaped values are found by path, not value", () => {
    const findings = scanPackHygiene({
      operations: { y: { token: "AKIAABCDEFGHIJKLMNOP" } }
    });
    expect(findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(findings)).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(findings.some((f) => f.path === "operations.y.token")).toBe(true);
  });

  test.each([
    "user@example.test",
    "00000000-0000-4000-8000-000000000000",
    "2026-01-01T00:00:00Z",
    "see https://github.com/ahliweb/awcms/issues/1",
    "see ahliweb/awcms-astro",
    "example"
  ])("synthetic or family value %s passes", (value) => {
    expect(rulesFor(value)).toEqual([]);
  });
});
