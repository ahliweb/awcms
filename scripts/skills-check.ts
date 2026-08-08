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
  // `awcms-performance` used to live here. It was the entry that proved the
  // list's shape is wrong: its reason named COMMANDS while the exemption also
  // covered PATHS, so the skill could say "these commands do not exist" in its
  // banner and "use the suite that already exists in `src/lib/performance/`"
  // sixty lines later, and the gate had no opinion. It now marks that one
  // passage with `<!-- aspirational:mulai -->` and is gated everywhere else.
  // Any skill here that is only PARTLY aspirational belongs in that shape too.
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

/**
 * Reference targets `scripts/README.md` §Ditunda declares as legitimately
 * absent, which that section **explicitly permits** skills to name:
 *
 * > Nama-nama ini boleh disebut sebagai **target** di `docs/awcms/` dan
 * > `.claude/skills/` … tetapi tidak boleh muncul sebagai `bun run <target>` di
 * > berkas **current-state**.
 *
 * So rule 4 below is deliberately NARROW: it does not re-litigate that policy,
 * it only catches targets that are neither real nor deferred — pure ghosts.
 *
 * Kept here as an explicit list rather than parsed out of the README (the
 * section mixes full names, `performance:*` wildcards and `:pot:check`
 * shorthand, and a parser for that would fail in the quiet direction). A test
 * binds every entry back to the README so the two cannot drift.
 */
const DEFERRED_TARGET_PREFIXES: readonly string[] = [
  "config:docs:check",
  "database:capacity:check",
  "i18n:",
  "modules:sync",
  "performance:",
  "production:preflight",
  "resilience:dr-drill"
];

export type SkillProblem = { skill: string; message: string };

/** True when a `bun run` target is real, or declared deferred by `scripts/README.md` §Ditunda. */
export function isKnownRunTarget(
  target: string,
  packageScripts: ReadonlySet<string>,
  deferred: readonly string[] = DEFERRED_TARGET_PREFIXES
): boolean {
  if (packageScripts.has(target)) {
    return true;
  }

  return deferred.some((entry) =>
    entry.endsWith(":") ? target.startsWith(entry) : target === entry
  );
}

/** Extract every `bun run <target>` a skill tells its reader to run. */
export function extractCitedRunTargets(source: string): string[] {
  return [
    ...new Set(
      [...source.matchAll(/bun run ([a-z0-9:_-]+)/g)].map((match) => match[1]!)
    )
  ];
}

/**
 * Rule 4 — a skill must not tell its reader to run a command that neither
 * exists nor is a declared deferred target.
 *
 * This is the same defect `check:docs` was widened to catch in source comments:
 * six comments under `src/modules/module-management/` told readers to run
 * `modules:sync`, a command that never existed here (the real mechanism is
 * `POST /api/v1/modules/sync`). That was fixed in `src/` — and the skill for
 * that same module still said it, because skills were outside every gate.
 */
export function checkCitedRunTargets(
  skill: string,
  citedTargets: readonly string[],
  packageScripts: ReadonlySet<string>,
  skillIsAspirational: boolean
): SkillProblem[] {
  if (skillIsAspirational) {
    return [];
  }

  return citedTargets
    .filter((target) => !isKnownRunTarget(target, packageScripts))
    .map((target) => ({
      skill,
      message:
        `tells the reader to run \`bun run ${target}\`, which is not in package.json and is not ` +
        "listed as a deferred target in `scripts/README.md` §Ditunda. Name the real mechanism, or " +
        "write the placeholder so it cannot be mistaken for a command."
    }));
}

/** A skill directory's subject module key: `awcms-blog-content` → `blog_content`. */
export function subjectModuleKey(skillName: string): string {
  return skillName.replace(/^awcms-/, "").replace(/-/g, "_");
}

/**
 * Passages a skill marks as ASPIRATIONAL — target specs, historical layouts,
 * and family surfaces this repo does not ship.
 *
 * ```md
 * <!-- aspirational:mulai -->
 * …paths and commands here are exempt from rules 1 and 4…
 * <!-- aspirational:selesai -->
 * ```
 *
 * ## Why a block and not (only) a per-skill list
 *
 * `ASPIRATIONAL_SKILLS` exempts a skill **entirely**, and the assessment of
 * 4 August 2026 (§9.6) showed what that costs. `awcms-performance` is listed
 * with the reason "names deferred performance tooling" — a reason about
 * COMMANDS — and the exemption silently covered PATHS too. The result lived in
 * one file: a banner saying "these commands do not exist here", and sixty lines
 * below it, "use the suite that already exists in `src/lib/performance/`", a
 * directory that does not exist. A skill that contradicts itself is worse than
 * one that is merely wrong, because the reader picks whichever sentence matches
 * the task in front of them — and skills are FOLLOWED (ADR-0062's premise).
 *
 * The block scopes the exemption to the passage that earns it and leaves the
 * rest of the body gated. It is the same marker technique `repo-inventory.md`
 * uses here and `<!-- permukaan:dipanggil:mulai -->` uses in `awcms-astro`.
 *
 * It also gives a correction somewhere to live. The gate cannot tell "this path
 * exists" from "this path does NOT exist, and saying so is the point" — so
 * before this block existed, writing an honest correction that named a missing
 * file turned the gate RED for being right, and the only escape was exempting
 * the whole skill. That pressure is what produced the blanket list.
 */
const ASPIRATIONAL_BLOCK =
  /<!--\s*aspirational:mulai\s*-->[\s\S]*?<!--\s*aspirational:selesai\s*-->/g;

/** Body with every marked aspirational passage removed. Rules 1 and 4 read this. */
export function stripAspirationalBlocks(source: string): string {
  return source.replace(ASPIRATIONAL_BLOCK, "");
}

/**
 * Extract the backtick-quoted `src/…` paths a skill cites.
 *
 * Only backticked paths count: prose mentions a directory in passing all the
 * time, and treating those as claims would make the gate noisy enough to be
 * disabled. Globs and bare directory prefixes are skipped for the same reason.
 *
 * ## Whitespace inside the backticks is normalised first, and that is not tidying
 *
 * Prettier wraps long markdown lines, and it will happily break INSIDE a code
 * span:
 *
 * ```md
 * … didorong oleh `src/lib/config/
 * registry.ts`'s field `deprecated`.
 * ```
 *
 * Matching the raw text meant such a path was invisible to this gate. So rule 1
 * was really "a cited path that HAPPENS TO FIT ON ONE LINE must exist", and
 * that difference was written down nowhere. Three such paths existed when this
 * was found; one of them — `src/lib/config/registry.ts` in
 * `awcms-production-preflight`, a skill NOT on the exemption list — named a
 * file that has never existed in this repo, and passed purely because of where
 * the line happened to wrap.
 */
export function extractCitedSourcePaths(source: string): string[] {
  const joined = source.replace(
    /`(src\/[^`]*?)`/g,
    (_match, path: string) => `\`${path.replace(/\s+/g, "")}\``
  );

  return [
    ...new Set(
      [...joined.matchAll(/`(src\/[A-Za-z0-9_./[\]-]+?)`/g)]
        .map((match) => match[1]!)
        .filter((cited) => !cited.includes("*") && !cited.endsWith("/"))
    )
  ];
}

/**
 * Rule 5 — every backticked `/admin/...` URL must resolve to a page that exists.
 *
 * Rules 1 and 3 govern SOURCE paths, and that left the claim readers act on most
 * ungoverned: a skill does not usually say "`src/pages/admin/site-search.astro`
 * exists", it says "the screen is `/admin/search`". Four such claims shipped,
 * and each fails in a direction that costs work:
 *
 * - `awcms-site-search` listed `/admin/search` under "Yang BELUM ada (jangan
 *   klaim ada)" while `src/pages/admin/site-search.astro` had shipped — wrong
 *   about existence AND about the URL, so a reader is sent to build a screen
 *   that is there, at an address that is not.
 * - `awcms-blog-content` claimed `/admin/blog/widgets` and `/admin/blog/ads`
 *   "sudah ada sejak #543". `src/pages/admin/blog/` has never existed; widgets
 *   live at `/admin/blog-presentation?section=widgets`, and ads have no screen
 *   at all.
 * - `blog_content`'s README carried a 14-line map of `/admin/blog/*` URLs of
 *   which exactly one resolves.
 *
 * ## The corpus includes module READMEs, and that is the point
 *
 * `src/modules/<name>/README.md` is MORE authoritative than a skill for anyone
 * touching the module, and it is not gated the way descriptors are — the same
 * asymmetry `tests/module-absence-claims.test.ts` had to close for absence
 * claims. Restricting this rule to `.claude/skills` would gate the derivative
 * and leave the source.
 *
 * ## What it does not do
 *
 * Paths carrying `...`, `*`, or a `{param}`/`[param]` segment are skipped: those
 * are patterns, not addresses. Query strings and fragments are trimmed —
 * `/admin/blog-presentation?section=widgets` is a real address whose page is
 * `blog-presentation.astro`. Text inside `<!-- historis:mulai -->` fences is
 * exempt, the same convention `tests/url-vocabulary-split.test.ts` uses, because
 * a paragraph explaining that `/admin/workflows` never existed has to be able to
 * name it.
 */
export function extractCitedAdminPaths(source: string): string[] {
  const joined = source.replace(
    /`(\/admin\/[^`]*?)`/g,
    (_match, cited: string) => `\`${cited.replace(/\s+/g, "")}\``
  );

  return [
    ...new Set(
      [
        ...joined.matchAll(/`(\/admin[A-Za-z0-9_./?=&#-]*)`/g),
        // Line-initial too, because that is where route MAPS live — and the
        // worst instance of this defect was one: `blog_content`'s README opened
        // a fenced block titled as its admin routes and listed fourteen
        // `/admin/blog/*` addresses, of which exactly one resolved. Backticked
        // citations alone would have read that block and found nothing to
        // check.
        ...joined.matchAll(/^\s*(\/admin[A-Za-z0-9_./?=&#-]*)/gm)
      ]
        .map((match) => match[1]!.split(/[?#]/)[0]!)
        .map((cited) => cited.replace(/\/+$/, ""))
        .filter(
          (cited) =>
            cited.length > 0 &&
            !cited.includes("...") &&
            !cited.includes("*") &&
            !/[{}[\]<>]/.test(cited)
        )
    )
  ];
}

/** Does a cited `/admin/...` URL have a page behind it? */
export function adminPageExists(
  cited: string,
  fileExists: (candidate: string) => boolean
): boolean {
  const base = `src/pages${cited}`;

  return fileExists(`${base}.astro`) || fileExists(`${base}/index.astro`);
}

export function checkCitedAdminPaths(
  skill: string,
  citedPaths: readonly string[],
  fileExists: (candidate: string) => boolean
): SkillProblem[] {
  const missing = citedPaths.filter(
    (cited) => !adminPageExists(cited, fileExists)
  );

  if (missing.length === 0) {
    return [];
  }

  return [
    {
      skill,
      message:
        `names admin screens that do not exist: ${missing.join(", ")}. ` +
        "Point at the page that ships (check `src/pages/admin/`), or — if the " +
        "text is deliberately recording a screen that never existed — fence it " +
        "with `<!-- historis:mulai -->` … `<!-- historis:selesai -->`."
    }
  ];
}

const HISTORICAL_OPEN = "<!-- historis:mulai -->";
const HISTORICAL_CLOSE = "<!-- historis:selesai -->";

/** Blank out fenced historical passages, preserving line count. */
export function stripHistoricalBlocks(source: string): string {
  const parts: string[] = [];
  let cursor = 0;

  for (;;) {
    const open = source.indexOf(HISTORICAL_OPEN, cursor);
    if (open === -1) {
      parts.push(source.slice(cursor));
      break;
    }

    parts.push(source.slice(cursor, open));
    const close = source.indexOf(HISTORICAL_CLOSE, open);

    if (close === -1) {
      // An unclosed fence must not exempt the rest of the file.
      parts.push(source.slice(open + HISTORICAL_OPEN.length));
      break;
    }

    parts.push(source.slice(open, close).replace(/[^\n]/g, ""));
    cursor = close + HISTORICAL_CLOSE.length;
  }

  return parts.join("");
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

/**
 * Every `src/modules/<name>/README.md` that exists. Asserted non-empty by the
 * caller: a glob that resolves to nothing would make rule 5's wider half pass
 * vacuously, which is the failure mode `tests/module-absence-claims.test.ts`
 * records from its own first draft.
 */
export async function moduleReadmePaths(): Promise<string[]> {
  const files: string[] = [];

  for await (const file of new Bun.Glob("src/modules/*/README.md").scan({
    cwd: process.cwd()
  })) {
    files.push(file);
  }

  return files.sort();
}

async function main(): Promise<void> {
  const liveModuleKeys = new Set(listModules().map((module) => module.key));
  const packageScripts = new Set(
    Object.keys(
      (
        JSON.parse(await readFile("package.json", "utf8")) as {
          scripts?: Record<string, string>;
        }
      ).scripts ?? {}
    )
  );
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

    // Rules 1 and 4 read the body with marked aspirational passages removed;
    // rule 2 reads the WHOLE body on purpose. An ADR citation is checkable no
    // matter which passage it sits in — a target spec that cites ADR-9999 is
    // still pointing its reader at a decision nobody can read.
    const gated = stripAspirationalBlocks(source);

    problems.push(
      ...checkCitedPaths(
        skill,
        extractCitedSourcePaths(gated),
        moduleIsLive,
        existsSync
      ),
      ...checkCitedAdrs(skill, extractCitedAdrNumbers(source), adrNumbers),
      ...checkCitedRunTargets(
        skill,
        extractCitedRunTargets(gated),
        packageScripts,
        skill in ASPIRATIONAL_SKILLS
      )
    );

    // Rule 5. Aspirational skills are exempt for the same reason rule 1 exempts
    // them: their subject does not exist, so neither do its screens.
    if (!(skill in ASPIRATIONAL_SKILLS)) {
      problems.push(
        ...checkCitedAdminPaths(
          skill,
          extractCitedAdminPaths(stripHistoricalBlocks(gated)),
          existsSync
        )
      );
    }
  }

  // Rule 5 over module READMEs. Same rule, wider corpus — and the wider half is
  // the authoritative one: a README is what a person reads before touching the
  // module, while a skill is what an agent follows.
  const moduleReadmes = await moduleReadmePaths();

  // A corpus that resolved to nothing would make rule 5’s wider half pass
  // vacuously — the failure mode this repo has already shipped once.
  if (moduleReadmes.length === 0) {
    problems.push({
      skill: "src/modules",
      message:
        "no module README matched the rule 5 corpus glob — the check would pass vacuously."
    });
  }

  for (const moduleReadme of moduleReadmes) {
    // Both fences apply, and they mean different things: `aspirational` marks a
    // TARGET spec (a design for screens that would be built), `historis` marks a
    // record of what was once believed. `blog_content`'s README carries the
    // first — a labelled `(spesifikasi mini)` route tree — and the labels were
    // prose until now, readable by people and invisible to this gate.
    const source = stripHistoricalBlocks(
      stripAspirationalBlocks(await readFile(moduleReadme, "utf8"))
    );

    problems.push(
      ...checkCitedAdminPaths(
        moduleReadme,
        extractCitedAdminPaths(source),
        existsSync
      )
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
      `${moduleReadmes.length} module READMEs, ` +
      `every cited src path, ADR, \`bun run\` target and \`/admin/…\` screen resolves.`
  );
}

if (import.meta.main) {
  await main();
}
