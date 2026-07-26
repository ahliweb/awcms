/**
 * No document or skill may claim a REGISTERED module is missing.
 *
 * ## What this caught
 *
 * Three live skills asserted that modules sitting in `listModules()` were not
 * in this base:
 *
 * - `awcms-data-lifecycle`: "`form_drafts`/`newsletter`/`comments` DITUNDA
 *   (modul belum di-port)". Both are ported; both are `delegated` adopters.
 *   The same skill claimed 2 adopters where there are 10 descriptors across 7
 *   modules — an agent following it would skip the legal-hold guard on tables
 *   that require it.
 * - `awcms-theming`: "`media_library` di-drop — belum ada di base".
 * - `awcms-wizard-form`: "modul `form_drafts` belum di-port".
 *
 * The theming one had a twin in the CODE (`src/lib/theming/theme-media.ts`),
 * which is how it stayed invisible: the seam returns an empty asset map and
 * its header explained that the media module does not exist. It does. Theme
 * logos silently never render, and the file said that was correct.
 *
 * ## Why a test
 *
 * These claims are load-bearing in a specific way: an agent reading a skill
 * that says a module is absent will not look for it, will not call it, and
 * will happily re-port or stub around something that already works. The drift
 * direction is always the same — prose freezes at the moment it was written
 * while the registry grows — so the claims rot silently and only in the
 * direction that causes wasted or duplicated work.
 *
 * Deliberately narrow. It does NOT try to validate every statement about a
 * module; it matches the specific Indonesian phrasings this repo uses for "not
 * ported / does not exist here" within a short window after a module key, and
 * lets a line off when it is visibly a correction or a historical note. A
 * broad "does this doc describe the module accurately" check is not
 * mechanizable; this one is, and it is the one that misled.
 *
 * No database, no network — runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

/**
 * Absence phrasings actually used in this repo, applied within 60 characters
 * after a module key so an unrelated "belum ada" later in a long paragraph is
 * not attributed to it.
 */
const ABSENCE = "(belum di-?port|belum ada|tidak ada di base)";

/**
 * Files whose absence claims are legitimately frozen in time. Detected by
 * marker rather than by filename so the list cannot go stale:
 *
 * - generated snapshots (`agent-memory.md` comes from `memory:docs:sync`;
 *   hand-editing it is explicitly wrong and would be overwritten);
 * - documents already marked DEPRECATED, retained precisely as a record of
 *   what was true when they were written.
 */
const FROZEN = /\*\*File ini di-generate\.\*\*|⚠️ DEPRECATED/;

/**
 * A line is exonerated when it carries a correction marker (`SUDAH`, `kini`,
 * `Versi sebelumnya`, `no longer`) or scopes the claim to something other than
 * the module itself (`komponen`/`pustaka` — a component library can be absent
 * while its module is present).
 *
 * `awcms-mini`/`awcms-micro` were in the first draft, on the theory that they
 * scope a claim to a sibling repo. They do not reliably: the theming skill's
 * "engine generik `data_lifecycle` tidak ada di base ini; GRANT worker
 * awcms-micro sengaja di-drop" mentions the sibling for an unrelated reason and
 * was waved through — a false statement about THIS repo, hidden by a word that
 * happened to appear later in the sentence. Removing them cost exactly one
 * false positive across the whole corpus, which was fixed by rewording rather
 * than by widening the exemption.
 */
const EXONERATING = /SUDAH|kini |komponen|pustaka|Versi sebelumnya|no longer/i;

/**
 * `dot: true` is REQUIRED, not stylistic. `Bun.Glob.scan()` skips
 * dot-directories by default, so `.claude/skills/*` silently matched ZERO
 * files — the first version of this gate scanned only `docs/` while appearing
 * to cover skills, and passed against a deliberately planted violation. The
 * count assertion in the test body exists so that failure mode is loud rather
 * than silent if the option is ever dropped.
 */
async function targetFiles(): Promise<string[]> {
  const files: string[] = [];

  for (const pattern of [".claude/skills/*/SKILL.md", "docs/awcms/*.md"]) {
    for await (const file of new Bun.Glob(pattern).scan({
      cwd: process.cwd(),
      dot: true
    })) {
      files.push(file);
    }
  }

  return files.sort();
}

describe("docs and skills do not deny registered modules", () => {
  test("no absence claim names a module that is in listModules()", async () => {
    const registered = listModules().map((module) => module.key);
    const files = await targetFiles();
    const offenders: string[] = [];

    // Guard the fixture: an empty registry or a half-empty file list would
    // pass vacuously. Both corpora are asserted SEPARATELY because the real
    // failure was one of them silently resolving to zero (see targetFiles()).
    expect(registered.length).toBeGreaterThan(0);
    expect(
      files.filter((f) => f.startsWith(".claude/")).length
    ).toBeGreaterThan(20);
    expect(files.filter((f) => f.startsWith("docs/")).length).toBeGreaterThan(
      20
    );

    for (const file of files) {
      const body = await readFile(file, "utf8");

      if (FROZEN.test(body.slice(0, 2000))) {
        continue;
      }

      for (const [index, line] of body.split("\n").entries()) {
        if (EXONERATING.test(line)) {
          continue;
        }

        for (const key of registered) {
          if (new RegExp(`\\b${key}\\b[^.]{0,60}?${ABSENCE}`).test(line)) {
            offenders.push(
              `${file}:${index + 1}: claims "${key}" is absent, but it IS in ` +
                `listModules(). Fix the claim, or add a correction note.`
            );
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the theming media seam does not deny media_library either", async () => {
    // The code twin of the skill claim above. Kept as its own assertion so the
    // failure message points at the seam rather than at prose: the day someone
    // wires the adapter, this is the file they touch.
    const seam = await readFile("src/lib/theming/theme-media.ts", "utf8");

    expect(listModules().some((module) => module.key === "media_library")).toBe(
      true
    );
    expect(seam).not.toMatch(
      /media_library.{0,80}is NOT part of the awcms base/s
    );
    expect(seam).toMatch(/`media_library` now EXISTS|now EXISTS/);
  });
});
