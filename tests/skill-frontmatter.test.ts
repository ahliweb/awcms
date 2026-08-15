/**
 * Every skill file must still open with its YAML frontmatter, at byte zero.
 *
 * This exists because of a near-miss during the ADR-0097 translation. The
 * bilingual banner (`🇬🇧 English (source) · …`) is written by
 * `scripts/docs-i18n-stamp.mjs`, which inserts it as the first line of the file.
 * For the 198 plain documents that is right. For the 55 `SKILL.md` files it is
 * not: they open with `---\nname: …\n---`, the loader requires that block to be
 * the FIRST bytes, and a banner pushed above it does not fail loudly — the
 * frontmatter silently stops being frontmatter, and every skill loses the
 * `name`/`description` that decide when an agent picks it up. A repo full of
 * skills nobody selects looks exactly like a repo whose skills were never
 * needed.
 *
 * So this asserts the invariant on the artefact rather than the helper: whatever
 * tool writes these files next, a skill that stops being loadable fails here.
 * Mirrors (`SKILL.id.md`) are held to the same rule — they are not loaded, but a
 * mirror whose frontmatter drifted is a mirror that stopped mirroring.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SKILLS_ROOT = join(import.meta.dirname, "..", ".claude", "skills");

/** Every `SKILL.md` / `SKILL.id.md` under `.claude/skills/`, repo-relative. */
function listSkillFiles(): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(SKILLS_ROOT)) {
    const dir = join(SKILLS_ROOT, entry);
    if (!statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir)) {
      if (name === "SKILL.md" || name === "SKILL.id.md") {
        files.push(`.claude/skills/${entry}/${name}`);
      }
    }
  }
  return files.sort();
}

const skillFiles = listSkillFiles();

describe("skill frontmatter survives the bilingual banner", () => {
  test("there are skills to check at all", () => {
    // Guards against the whole suite passing vacuously if the enumeration
    // breaks — a green test over zero files is the failure this file exists to
    // prevent, one level up.
    expect(skillFiles.length).toBeGreaterThan(50);
  });

  test.each(skillFiles)("%s opens with YAML frontmatter", (file) => {
    const content = readFileSync(join(import.meta.dirname, "..", file), "utf8");

    expect(content.startsWith("---\n")).toBe(true);

    const end = content.indexOf("\n---\n", "---\n".length - 1);
    expect(end).toBeGreaterThan(0);

    const block = content.slice("---\n".length, end + 1);
    expect(block).toMatch(/^name:\s*\S+/m);
    expect(block).toMatch(/^description:\s*\S+/m);

    // The banner belongs after the block, never inside or above it.
    expect(block).not.toMatch(/🇬🇧|🇮🇩/u);
  });

  test.each(skillFiles)("%s declares a name matching its directory", (file) => {
    const content = readFileSync(join(import.meta.dirname, "..", file), "utf8");
    const declared = /^name:\s*(\S+)/m.exec(content)?.[1];
    const directory = file.split("/").at(-2);
    expect(declared).toBe(directory);
  });
});
