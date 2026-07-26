/**
 * A `.generated` file must have something that generates it AND something that
 * checks it.
 *
 * ## Why this is a class of defect, not one incident
 *
 * `docs/awcms/work-class-registry.generated.json` sat in this repo with neither.
 * It was copied from awcms-mini and listed 284 of that repo's routes — mostly
 * ghosts — while its own `_disclaimer` claimed to describe "96 real routes" in a
 * repo that had 221. Both layers had rotted: the data, and the warning that was
 * supposed to stop a reader trusting the data.
 *
 * The suffix is what makes it dangerous. `.generated` is a claim — *derived from
 * code, do not hand-edit* — so such a file is trusted MORE than ordinary prose,
 * which is exactly backwards when nothing derives it. `docs/awcms/README.md` and
 * `database-capacity-runbook.md` both cited it, and the runbook is what an
 * operator reads when sizing the connection pool.
 *
 * The contrast is in the same directory: `module-composition-inventory.json` has
 * a generate/check pair and has stayed accurate the whole time. The pair is the
 * only difference between the two files.
 *
 * Pure — no database, no network.
 */
import { describe, expect, test } from "bun:test";

import packageJson from "../package.json";

const SCRIPTS = packageJson.scripts as Record<string, string>;

/**
 * A `<name>:generate` / `<name>:check` pair for each artifact, keyed by the file
 * the pair owns. Discovery below asserts this covers every `.generated.*` file
 * on disk, so the map cannot fall behind a newly added artifact.
 */
const ARTIFACT_TOOLING: Readonly<
  Record<string, { generate: string; check: string }>
> = {
  "docs/awcms/work-class-registry.generated.json": {
    generate: "db:work-class:generate",
    check: "db:work-class:check"
  }
};

async function generatedArtifacts(): Promise<string[]> {
  const files: string[] = [];

  for await (const file of new Bun.Glob(
    "{docs,openapi,asyncapi,config}/**/*.generated.*"
  ).scan({
    cwd: process.cwd(),
    dot: true
  })) {
    files.push(file);
  }

  return files.sort();
}

describe("every .generated artifact is really generated", () => {
  test("each one has a generate script and a check script", async () => {
    const artifacts = await generatedArtifacts();

    // Guard the fixture: a glob that matched nothing would pass vacuously,
    // which is the same shape of silent-zero bug this repo has shipped before.
    expect(artifacts.length).toBeGreaterThan(0);

    const problems: string[] = [];

    for (const artifact of artifacts) {
      const tooling = ARTIFACT_TOOLING[artifact];

      if (!tooling) {
        problems.push(
          `${artifact} is named ".generated" but ARTIFACT_TOOLING names no ` +
            "generate/check pair for it. A .generated file with nothing behind " +
            "it reads as authoritative while being unverifiable — either wire a " +
            "pair, or drop the suffix."
        );
        continue;
      }

      for (const [role, script] of Object.entries(tooling)) {
        if (!(script in SCRIPTS)) {
          problems.push(
            `${artifact}: ${role} script "${script}" is not in package.json.`
          );
        }
      }
    }

    expect(problems.sort()).toEqual([]);
  });

  test("the tooling map has no entry for an artifact that no longer exists", async () => {
    // Same shrink-only discipline as the tenant-route ledger: a map that can
    // hold stale rows stops describing the repo and starts excusing it.
    const artifacts = new Set(await generatedArtifacts());
    const stale = Object.keys(ARTIFACT_TOOLING).filter(
      (artifact) => !artifacts.has(artifact)
    );

    expect(stale.sort()).toEqual([]);
  });

  test("every check script named here is actually in the `check` chain", async () => {
    // A check that exists but never runs is the same defect one step removed.
    const chain = SCRIPTS.check ?? "";
    const missing = Object.values(ARTIFACT_TOOLING)
      .map((tooling) => tooling.check)
      .filter((script) => !chain.includes(`bun run ${script}`));

    expect(missing.sort()).toEqual([]);
  });
});
