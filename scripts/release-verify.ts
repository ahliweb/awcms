#!/usr/bin/env bun
/**
 * release-verify.ts — `bun run release:verify` (docs/awcms/release-process.md
 * §`validate` job, real release only, NOT rehearsal).
 *
 * Menjalankan `checkTagMatchesPackageVersion`, `checkChangelogHasSection`,
 * `checkNoPendingChangesets` (logika murni di
 * `scripts/lib/release-verify-checks.ts`) terhadap state repo saat ini,
 * sebelum `build`/`sign-attest-publish` job `release.yml` berjalan.
 *
 * Tag yang diverifikasi: `RELEASE_VERIFY_TAG` env var (diset
 * `release.yml` dari `github.ref_name` saat trigger tag push) — fallback
 * `git describe --tags --exact-match HEAD` untuk pemakaian lokal manual.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  parseVersionFromTag,
  checkTagMatchesPackageVersion,
  checkChangelogHasSection,
  checkNoPendingChangesets
} from "./lib/release-verify-checks";

const ROOT = resolve(import.meta.dirname, "..");

function resolveTag(): string {
  const fromEnv = process.env.RELEASE_VERIFY_TAG?.trim();
  if (fromEnv) return fromEnv;

  try {
    return execFileSync(
      "git",
      ["describe", "--tags", "--exact-match", "HEAD"],
      { cwd: ROOT, encoding: "utf8" }
    ).trim();
  } catch {
    throw new Error(
      "Tidak bisa menentukan tag rilis: RELEASE_VERIFY_TAG tidak diset dan HEAD tidak persis di sebuah tag (git describe --exact-match gagal)."
    );
  }
}

if (import.meta.main) {
  const problems: string[] = [];

  let tag: string;
  try {
    tag = resolveTag();
  } catch (error) {
    console.error(`release:verify GAGAL — ${(error as Error).message}`);
    process.exit(1);
  }

  const tagVersion = parseVersionFromTag(tag);
  if (!tagVersion) {
    console.error(
      `release:verify GAGAL — tag "${tag}" tidak cocok pola vX.Y.Z.`
    );
    process.exit(1);
  }

  const packageJson = JSON.parse(
    readFileSync(resolve(ROOT, "package.json"), "utf8")
  ) as { version: string };

  const tagProblem = checkTagMatchesPackageVersion(
    tagVersion,
    packageJson.version
  );
  if (tagProblem) problems.push(tagProblem.message);

  const changelogContent = readFileSync(resolve(ROOT, "CHANGELOG.md"), "utf8");
  const changelogProblem = checkChangelogHasSection(
    changelogContent,
    tagVersion
  );
  if (changelogProblem) problems.push(changelogProblem.message);

  const changesetFiles = readdirSync(resolve(ROOT, ".changeset")).filter(
    (name) => name !== "config.json"
  );
  const pendingProblem = checkNoPendingChangesets(changesetFiles);
  if (pendingProblem) problems.push(pendingProblem.message);

  if (problems.length > 0) {
    console.error(`release:verify GAGAL — ${problems.length} temuan:`);
    for (const message of problems) console.error(`  - ${message}`);
    process.exit(1);
  }

  console.log(
    `release:verify OK — tag ${tag} cocok package.json (${packageJson.version}), CHANGELOG.md punya section, tidak ada changeset pending.`
  );
}
