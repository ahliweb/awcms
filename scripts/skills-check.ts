/**
 * skills-check.ts — `bun run skills:check`.
 *
 * Holds `.claude/skills/*​/SKILL.md` to the code it describes. Pure: no database,
 * no network, no git.
 *
 * ## Why this gate exists, and why it is not just "docs but stricter"
 *
 * `docs/awcms/` and `.claude/skills/` were deliberately left OUTSIDE `check:docs`
 * because both carried adaptation notes from `awcms-mini` that legitimately named
 * tooling this repo does not have. [ADR-0055](../docs/adr/0055-development-confined-to-awcms-and-awcms-astro.md)
 * removed that justification for skills: mini/micro are archives, capabilities
 * are BUILT here, and a skill that reads as a porting instruction is no longer
 * merely out of date — it points work at a repo that does not move.
 *
 * The cost of leaving it ungated was measurable when this gate was written:
 * **eleven consecutive ADRs (0051–0061) landed with zero skill referencing any of
 * them**, four skills for LIVE modules pointed at `src/lib/<module>/…` paths whose
 * files actually live at `src/modules/<module>/presentation/…`, and several
 * announced admin screens as un-ported months after those screens shipped.
 *
 * That direction of decay is the dangerous one. A stale doc makes a reader
 * pause; a stale skill is *followed*. "This module is not in this repo" ages into
 * a confident falsehood, and the agent reading it builds the thing that already
 * exists — or ports it from an archive.
 *
 * ## The rules, and why each is decidable
 *
 * Prose cannot be gated, so nothing here reads intent. Each rule keys off the
 * module registry, which is the same authority `modules:*:check` uses.
 *
 * 1. **A live module's skill describes live code.** If `awcms-<x>`'s subject
 *    module is in `listModules()`, every `src/…` path it cites must exist. There
 *    is no exception list for this rule on purpose: a skill for shipped code has
 *    no reason to name a file that is not there, and the four `src/lib/<module>/`
 *    misdirections above are exactly what it catches.
 * 2. **Every cited ADR exists.** `ADR-0042` must resolve to `docs/adr/0042-*.md`.
 *    A reference to an ADR nobody wrote is a citation that cannot be checked by
 *    the reader either.
 * 3. **A skill for code that does not exist must say so, in a reasoned entry.**
 *    Target-spec and historical skills are legitimate — `awcms-social-publishing`
 *    describes a module worth building, `awcms-news-portal` records one that was
 *    merged away. They may cite paths that do not exist, but only from
 *    `ASPIRATIONAL_SKILLS` below, where each entry states which it is and why.
 *    The list is the artifact: an unlisted skill that cites missing paths fails,
 *    so the next one cannot quietly join them.
 *
 * Rule 3's list is deliberately per-SKILL rather than per-PATH. A path list would
 * grow with every edit to a target spec and stop being read; a skill list changes
 * only when a skill changes character, which is exactly when someone should look.
 */
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { listModules } from "../src/modules";

const SKILLS_ROOT = ".claude/skills";
const ADR_ROOT = "docs/adr";

/**
 * Skills that describe code this repo does not have, with the reason. Rule 3.
 *
 * `target-spec` — a capability worth building; the paths say where it would go.
 * `historical` — code that existed and was removed or merged; the paths are a
 * record of where it was, kept because the reasoning is still cited.
 * `cross-cutting` — no single subject module, and names surfaces from elsewhere
 * in the family.
 */
const ASPIRATIONAL_SKILLS: Readonly<Record<string, string>> = {
  "awcms-social-publishing":
    "target-spec: the module is not built here; `blog_content` injects a no-op adapter at its call sites and swapping in a real one is a composition-root change.",
  "awcms-document-infrastructure":
    "target-spec: not built here; the paths describe where the module would live.",
  "awcms-integration-hub":
    "target-spec: not built here; the paths describe where the module would live.",
  "awcms-wizard-form":
    "target-spec: no reusable wizard component library exists here (`src/components/ui` is absent); the paths are the shape a build would take.",
  "awcms-news-portal":
    "historical: ADR-0044 merged `news_portal` into `blog_content` and deleted the module; the paths record the pre-merge layout its still-cited rules came from.",
  "awcms-erp-extension-readiness":
    "historical: ADR-0034 deleted the derived-application pathway along with the `_shared` ERP readiness contracts these paths name.",
  "awcms-legacy-migration":
    "historical: legacy data migration is descoped from this repo; the skill exists to record where the concept belongs instead.",
  "awcms-i18n":
    "target-spec: this base has no i18n seam (`src/lib/i18n/` is absent); the paths describe the shape a build would take.",
  "awcms-ui-screen":
    "cross-cutting: names design-system surfaces including the `src/components/ui` library this base has not built.",
  "awcms-ux-review":
    "cross-cutting: names design-system surfaces including the `src/components/ui` library this base has not built.",
  "awcms-performance":
    "cross-cutting: names deferred performance tooling listed under `scripts/README.md` §Ditunda.",
  "awcms-codeql-triage":
    "historical: cites `src/modules/application-registry.ts`, deleted by ADR-0034, as the site of a real triaged finding.",
  "awcms-new-module":
    "cross-cutting: enumerates modules NOT in the registry, so naming absent paths is the point of the passage.",
  "awcms-idempotency":
    "cross-cutting: illustrates the pattern with modules from across the family, including ones not built here.",
  "awcms-integration":
    "cross-cutting: names integration surfaces across the family, including modules not built here.",
  "awcms-auth-online-hardening":
    "cross-cutting: a design-context skill spanning several epics; some named surfaces are deliberately not built here.",
  "awcms-port-from-mini":
    "historical: ADR-0055 retired the mini-first pathway; the skill is kept as the record of how ports were done."
};

export type SkillProblem = { skill: string; message: string };

/** A skill directory's subject module key: `awcms-blog-content` → `blog_content`. */
export function subjectModuleKey(skillName: string): string {
  return skillName.replace(/^awcms-/, "").replace(/-/g, "_");
}

/**
 * Extract the backtick-quoted `src/…` paths a skill cites.
 *
 * Only backticked paths count: prose mentions a directory in passing all the
 * time, and treating those as claims would make the gate noisy enough to be
 * disabled. Globs and bare directory prefixes are skipped for the same reason.
 */
export function extractCitedSourcePaths(source: string): string[] {
  return [
    ...new Set(
      [...source.matchAll(/`(src\/[A-Za-z0-9_./[\]-]+?)`/g)]
        .map((match) => match[1]!)
        .filter((cited) => !cited.includes("*") && !cited.endsWith("/"))
    )
  ];
}

/** Extract every `ADR-NNNN` reference. */
export function extractCitedAdrNumbers(source: string): string[] {
  return [
    ...new Set([...source.matchAll(/ADR-(\d{4})/g)].map((match) => match[1]!))
  ];
}

/** Rule 1 + rule 3, given a resolver for "does this path exist". */
export function checkCitedPaths(
  skill: string,
  citedPaths: readonly string[],
  moduleIsLive: boolean,
  pathExists: (candidate: string) => boolean
): SkillProblem[] {
  const missing = citedPaths.filter((cited) => !pathExists(cited));

  if (missing.length === 0) {
    return [];
  }

  if (moduleIsLive) {
    return missing.map((cited) => ({
      skill,
      message:
        `cites \`${cited}\`, which does not exist — and \`${subjectModuleKey(skill)}\` IS in the module ` +
        `registry, so this skill describes shipped code. Point it at the real path or delete the claim.`
    }));
  }

  if (!(skill in ASPIRATIONAL_SKILLS)) {
    return [
      {
        skill,
        message:
          `cites ${missing.length} path(s) that do not exist (e.g. \`${missing[0]}\`) and is not listed in ` +
          `ASPIRATIONAL_SKILLS. If it describes code worth building or code that was removed, add it there ` +
          `with the reason; otherwise fix the paths.`
      }
    ];
  }

  return [];
}

/** Rule 2. */
export function checkCitedAdrs(
  skill: string,
  citedAdrs: readonly string[],
  knownAdrNumbers: ReadonlySet<string>
): SkillProblem[] {
  return citedAdrs
    .filter((number) => !knownAdrNumbers.has(number))
    .map((number) => ({
      skill,
      message: `cites ADR-${number}, which has no file in \`${ADR_ROOT}/\`.`
    }));
}

async function main(): Promise<void> {
  const liveModuleKeys = new Set(listModules().map((module) => module.key));
  const adrNumbers = new Set(
    (await readdir(ADR_ROOT))
      .map((file) => /^(\d{4})-/.exec(file)?.[1])
      .filter((number): number is string => Boolean(number))
  );

  const problems: SkillProblem[] = [];
  const skillDirs = (await readdir(SKILLS_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const skill of skillDirs) {
    const file = path.join(SKILLS_ROOT, skill, "SKILL.md");

    if (!existsSync(file)) {
      problems.push({ skill, message: "has no SKILL.md." });
      continue;
    }

    const source = await readFile(file, "utf8");
    const moduleIsLive = liveModuleKeys.has(subjectModuleKey(skill));

    problems.push(
      ...checkCitedPaths(
        skill,
        extractCitedSourcePaths(source),
        moduleIsLive,
        existsSync
      ),
      ...checkCitedAdrs(skill, extractCitedAdrNumbers(source), adrNumbers)
    );
  }

  // A listed exception that no longer needs one is itself a stale claim — the
  // same reasoning ADR-0058 applies to unenforced-permission exceptions. Two
  // ways an entry goes dead, and the second is the one that will actually
  // happen: a module gets BUILT, rule 1 starts governing its skill, and the
  // entry silently stops meaning anything while still reading as a decision.
  for (const skill of Object.keys(ASPIRATIONAL_SKILLS)) {
    if (!skillDirs.includes(skill)) {
      problems.push({
        skill,
        message:
          "is listed in ASPIRATIONAL_SKILLS but has no skill directory — remove the entry."
      });
      continue;
    }

    if (liveModuleKeys.has(subjectModuleKey(skill))) {
      problems.push({
        skill,
        message:
          `is listed in ASPIRATIONAL_SKILLS, but \`${subjectModuleKey(skill)}\` is in the module registry, ` +
          "so rule 1 governs it and the entry can never apply — remove it."
      });
    }
  }

  if (problems.length > 0) {
    console.error("skills:check FAILED");

    for (const problem of problems) {
      console.error(`  - ${problem.skill} ${problem.message}`);
    }

    process.exitCode = 1;
    return;
  }

  console.log(
    `skills:check OK — ${skillDirs.length} skills, ` +
      `${Object.keys(ASPIRATIONAL_SKILLS).length} declared aspirational/historical, ` +
      `every cited src path and ADR resolves.`
  );
}

if (import.meta.main) {
  await main();
}
