/**
 * An ADR that admits a module must not read as though the module exists.
 *
 * ## The hazard, in the roadmap's own words
 *
 * `docs/awcms/absorb-awcms-mini-backbone-roadmap.md` §1 puts it plainly: someone
 * reading `docs/adr/` "will conclude `organization_structure` can be called. It
 * cannot." Five ADRs here are `Accepted` for modules with **no code in this
 * repository** — 0016, 0017, 0018, 0019, 0021. `Accepted` is a decision status,
 * not a delivery status, but nothing in the documents said so, and the
 * distinction is invisible to anyone arriving at one of them cold.
 *
 * That is not hypothetical drift. ADR-0020 asserted `reference_data` is
 * `status: "active"` in the registry and cited a merged PR number — true of
 * `awcms-mini`, where the text came from, and false here.
 *
 * ## Why a test rather than a convention
 *
 * The two facts that must agree live in different places and move independently:
 * an ADR is prose edited by hand, and `listModules()` is code. Nothing connects
 * them, so they drift silently and in the dangerous direction — the document
 * over-claims while the registry quietly stays empty.
 *
 * This binds them. Either the admitted module is in the registry, or the ADR
 * carries `NOT_IMPLEMENTED_MARKER` near the top. Landing the module makes the
 * marker wrong and the test says so; writing a new admission ADR without either
 * fails immediately.
 *
 * No database, no network — it runs in `quality` on every PR.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

/**
 * The phrase an admission ADR must carry while its module has no code. Chosen to
 * be unmissable in the rendered document rather than a tidy machine token: the
 * reader it protects is a human skimming for "can I use this".
 */
const NOT_IMPLEMENTED_MARKER = "BELUM DIIMPLEMENTASIKAN DI REPO INI";

/** `# ADR-00NN — Admission of \`module_key\` as …` */
const ADMISSION_TITLE = /Admission of `([a-z_]+)`/;

async function readAdrs(): Promise<{ name: string; body: string }[]> {
  const dir = path.resolve(process.cwd(), "docs/adr");
  const names = (await readdir(dir))
    .filter((name) => /^\d{4}-.*\.md$/.test(name))
    .sort();

  return Promise.all(
    names.map(async (name) => ({
      name,
      body: await readFile(path.join(dir, name), "utf8")
    }))
  );
}

describe("admission ADRs agree with the module registry", () => {
  test("every admitted module is either registered or marked unimplemented", async () => {
    const registered = new Set(listModules().map((module) => module.key));
    const adrs = await readAdrs();
    const offenders: string[] = [];
    let admissions = 0;

    for (const adr of adrs) {
      const match = adr.body.split("\n")[0]?.match(ADMISSION_TITLE);

      if (!match?.[1]) {
        continue;
      }

      admissions += 1;

      const moduleKey = match[1];
      const isRegistered = registered.has(moduleKey);
      const isMarked = adr.body.includes(NOT_IMPLEMENTED_MARKER);

      if (isRegistered && isMarked) {
        offenders.push(
          `${adr.name}: "${moduleKey}" IS registered but still carries the ` +
            `"${NOT_IMPLEMENTED_MARKER}" marker — remove it.`
        );
        continue;
      }

      if (!isRegistered && !isMarked) {
        offenders.push(
          `${adr.name}: admits "${moduleKey}", which is NOT in listModules(). ` +
            `An Accepted ADR with no code reads as a usable module. Add the ` +
            `"${NOT_IMPLEMENTED_MARKER}" marker, or land the module.`
        );
      }
    }

    expect(admissions).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  test("no ADR claims an absent module is active in the registry", async () => {
    // ADR-0020 asserted `reference_data` was `status: "active"` in the registry
    // and cited a merged PR. True of awcms-mini, where the sentence came from;
    // false here. Prose copied between family repos is the likely source of the
    // next instance too, so the claim is asserted against, not just corrected.
    const registered = new Set(listModules().map((module) => module.key));
    const adrs = await readAdrs();
    const offenders: string[] = [];

    for (const adr of adrs) {
      for (const line of adr.body.split("\n")) {
        if (!line.includes('status: "active"')) {
          continue;
        }

        for (const key of line.matchAll(/`([a-z_]{3,})`/g)) {
          const candidate = key[1]!;

          if (
            candidate.includes("_") &&
            !registered.has(candidate) &&
            !line.includes("awcms-mini") &&
            !line.includes("awcms-micro")
          ) {
            offenders.push(
              `${adr.name}: claims "${candidate}" is status: "active" in the ` +
                `registry, but it is not in listModules().`
            );
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
