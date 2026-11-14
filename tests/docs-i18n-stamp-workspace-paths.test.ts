/**
 * docs-i18n-stamp must behave the same when this tree is embedded as a
 * subdirectory of a larger git repository (a monorepo or subtree embedder).
 *
 * `git status --porcelain` reports paths relative to the repository TOP while
 * `git ls-files` and `git show HEAD:./path` are relative to the working
 * directory. Before the prefix was reconciled, a mirror edited in such a
 * checkout was never recognised as touched, and a whitespace-only reflow of the
 * source was judged against a `HEAD:` path that does not exist.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..");
const tempDirs: string[] = [];

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  }
}

function stamp(app: string): { code: number; stderr: string } {
  const result = Bun.spawnSync(
    ["bun", join(app, "scripts", "docs-i18n-stamp.mjs")],
    { cwd: app }
  );
  return { code: result.exitCode, stderr: result.stderr.toString() };
}

/** A throwaway git repo with the stamp tool copied under `subdir` ("" = top). */
function fixture(subdir: string): { app: string } {
  const top = mkdtempSync(join(tmpdir(), "awcms-stamp-"));
  tempDirs.push(top);
  const app = subdir ? join(top, subdir) : top;
  mkdirSync(join(app, "scripts", "lib"), { recursive: true });
  mkdirSync(join(app, "docs"), { recursive: true });
  cpSync(
    join(REPO, "scripts", "docs-i18n-stamp.mjs"),
    join(app, "scripts", "docs-i18n-stamp.mjs")
  );
  cpSync(
    join(REPO, "scripts", "lib", "docs-i18n-checks.mjs"),
    join(app, "scripts", "lib", "docs-i18n-checks.mjs")
  );
  writeFileSync(join(app, "docs", "guide.md"), "# Guide\n\nHello world.\n");
  writeFileSync(join(app, "docs", "guide.id.md"), "# Panduan\n\nHalo dunia.\n");
  git(top, "init", "-q");
  git(top, "config", "user.email", "t@example.test");
  git(top, "config", "user.name", "t");
  git(top, "config", "commit.gpgsign", "false");
  const first = stamp(app); // untracked pair: allowed, writes banners + marker
  if (first.code !== 0) throw new Error(first.stderr);
  git(top, "add", "-A");
  git(top, "commit", "-q", "-m", "init");
  return { app };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe.each([
  ["repository top", ""],
  ["workspace subdirectory", "apps/cms"]
])("docs-i18n-stamp at the %s", (_label, subdir) => {
  test("re-stamps a mirror that was edited alongside a changed source", () => {
    const { app } = fixture(subdir);
    writeFileSync(join(app, "docs", "guide.md"), "# Guide\n\nHello there.\n");
    const mirror = join(app, "docs", "guide.id.md");
    writeFileSync(
      mirror,
      readFileSync(mirror, "utf8").replace("Halo dunia", "Halo di sana")
    );

    const result = stamp(app);

    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
  });

  test("re-stamps an untouched mirror after a whitespace-only reflow", () => {
    const { app } = fixture(subdir);
    const source = join(app, "docs", "guide.md");
    writeFileSync(
      source,
      readFileSync(source, "utf8").replace("Hello world.", "Hello\nworld.")
    );

    const result = stamp(app);

    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
  });

  test("still refuses an untouched mirror after a real source change", () => {
    const { app } = fixture(subdir);
    writeFileSync(join(app, "docs", "guide.md"), "# Guide\n\nHello there.\n");

    const result = stamp(app);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("docs/guide.id.md");
  });
});
