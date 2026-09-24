/**
 * Executes deploy/backup/manifest.sh for real (not a mock of it) — the
 * authenticated-manifest half of Issue #812 / ADR-0123 that needs no
 * PostgreSQL and no `age`, so it runs unconditionally in every `bun test`
 * (including CI, where `age` is not installed).
 *
 * The `age`-encryption + full backup/restore round trip is exercised
 * manually against a real disposable PostgreSQL 18.4 container as part of
 * this PR's own verification (see the PR description / final report) — it
 * is NOT re-asserted here as an automated test, because neither `age` nor a
 * version-matched `pg_dump`/`pg_restore` is guaranteed present in the
 * environment `bun test` runs in (see deploy/backup/README.md — those
 * scripts are designed to run inside a `postgres:18.4`-based image, not the
 * application's own test runner). What IS asserted here, for real, every
 * run: manifest generation, successful verification, and — the actual
 * security property ADR-0123 exists for — that verification REFUSES a
 * tampered artifact or a tampered manifest BEFORE the caller would ever act
 * on it, and that a wrong/missing HMAC key is refused the same way.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const MANIFEST_SCRIPT = path.join(
  import.meta.dir,
  "..",
  "deploy",
  "backup",
  "manifest.sh"
);

let dir: string;

function run(args: string[]) {
  const result = Bun.spawnSync(["bash", MANIFEST_SCRIPT, ...args], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe"
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString("utf8"),
    stderr: result.stderr.toString("utf8")
  };
}

function writeArtifact(name: string, content: string): string {
  const p = path.join(dir, name);
  writeFileSync(p, content);
  return p;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "awcms-manifest-test-"));
  writeFileSync(path.join(dir, "hmac.key"), crypto.randomUUID());
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("deploy/backup/manifest.sh (ADR-0123)", () => {
  test("generate then verify: passes, and prints no HMAC key value", () => {
    writeArtifact("artifact.bin", "hello world backup artifact\n");

    const gen = run([
      "generate",
      "--artifact=artifact.bin",
      "--hmac-key-file=hmac.key",
      "--out=manifest.json",
      "--source-db=awcms_test",
      "--pg-dump-version=pg_dump (PostgreSQL) 18.4"
    ]);
    expect(gen.exitCode).toBe(0);

    const manifest = readFileSync(path.join(dir, "manifest.json"), "utf8");
    expect(manifest).toContain('"source_database": "awcms_test"');

    const keyValue = readFileSync(path.join(dir, "hmac.key"), "utf8");
    expect(gen.stdout).not.toContain(keyValue);
    expect(gen.stderr).not.toContain(keyValue);

    const verify = run([
      "verify",
      "--manifest=manifest.json",
      "--hmac-key-file=hmac.key",
      "--artifact=artifact.bin"
    ]);
    expect(verify.exitCode).toBe(0);
    expect(verify.stdout).toContain("SOURCE_DATABASE=awcms_test");
    expect(verify.stderr).not.toContain(keyValue);
  });

  test("TAMPER: a modified artifact fails verification before the caller could act on it", () => {
    writeArtifact("artifact.bin", "original content\n");
    run([
      "generate",
      "--artifact=artifact.bin",
      "--hmac-key-file=hmac.key",
      "--out=manifest.json"
    ]);

    // Replace the artifact with different (still well-formed) bytes.
    writeArtifact("artifact.bin", "REPLACED content — same length class\n");

    const verify = run([
      "verify",
      "--manifest=manifest.json",
      "--hmac-key-file=hmac.key",
      "--artifact=artifact.bin"
    ]);
    expect(verify.exitCode).not.toBe(0);
    expect(verify.stderr).toContain("TAMPER DETECTED");
    expect(verify.stderr).toContain("does not match the sha256 digest");
  });

  test("TAMPER: a modified manifest field fails its own HMAC before the caller reads any field from it", () => {
    writeArtifact("artifact.bin", "original content\n");
    run([
      "generate",
      "--artifact=artifact.bin",
      "--hmac-key-file=hmac.key",
      "--out=manifest.json",
      "--source-db=real_db"
    ]);

    const manifestPath = path.join(dir, "manifest.json");
    const tampered = readFileSync(manifestPath, "utf8").replace(
      "real_db",
      "attacker_controlled_db"
    );
    writeFileSync(manifestPath, tampered);

    const verify = run([
      "verify",
      "--manifest=manifest.json",
      "--hmac-key-file=hmac.key",
      "--artifact=artifact.bin"
    ]);
    expect(verify.exitCode).not.toBe(0);
    expect(verify.stderr).toContain("TAMPER DETECTED: manifest HMAC");
    // The forged field must never reach the caller's stdout as if trusted.
    expect(verify.stdout).not.toContain("attacker_controlled_db");
  });

  test("wrong HMAC key fails closed, same as tampering", () => {
    writeArtifact("artifact.bin", "content\n");
    run([
      "generate",
      "--artifact=artifact.bin",
      "--hmac-key-file=hmac.key",
      "--out=manifest.json"
    ]);
    writeFileSync(path.join(dir, "wrong.key"), "a completely different key");

    const verify = run([
      "verify",
      "--manifest=manifest.json",
      "--hmac-key-file=wrong.key",
      "--artifact=artifact.bin"
    ]);
    expect(verify.exitCode).not.toBe(0);
    expect(verify.stderr).toContain("TAMPER DETECTED: manifest HMAC");
  });

  test("verifying without a .hmac sidecar refuses rather than trusting an unauthenticated manifest", () => {
    writeArtifact("artifact.bin", "content\n");
    run([
      "generate",
      "--artifact=artifact.bin",
      "--hmac-key-file=hmac.key",
      "--out=manifest.json"
    ]);
    rmSync(path.join(dir, "manifest.json.hmac"));

    const verify = run([
      "verify",
      "--manifest=manifest.json",
      "--hmac-key-file=hmac.key",
      "--artifact=artifact.bin"
    ]);
    expect(verify.exitCode).not.toBe(0);
    expect(verify.stderr).toContain("not authenticated");
  });
});
