/**
 * The one recursive file walk, and the one repo root, that `scripts/` shares.
 *
 * ## Why this file exists
 *
 * Nine scripts had written their own recursive descent by the time this was
 * extracted, and two of them — `repo-inventory.ts` and
 * `project-state-inventory.ts` — carried the SAME function, byte for byte,
 * under the same name. The rest differed in ways nobody chose deliberately:
 *
 *   - `site-origin-check.ts` skipped every dot-entry; `logging-lint-check.ts`
 *     descended into them.
 *   - `logging-lint-check.ts` and `edge-cache-surfaces-check.ts` returned `[]`
 *     for a missing directory; `astro-script-typecheck.ts` threw.
 *   - `i18n-catalog-check.ts` skipped `node_modules` and `catalogs`;
 *     `repo-inventory.ts` skipped nothing.
 *
 * Those differences are the dangerous kind. A gate that silently walks a
 * smaller tree than its author believed is GREEN for the wrong reason — it
 * reports no violations because it never looked, and this repo has already
 * shipped that shape of defect (`check:docs` was blind to newly added
 * documents). A shared walk makes the scanned set an explicit argument
 * instead of an accident of whichever copy was pasted.
 *
 * ## Why there are no convenient defaults
 *
 * Every option below defaults to the most literal behaviour: descend
 * everything, keep every regular file, absolute paths, throw if the directory
 * is absent. That is deliberate. A default of, say, "skip dot-entries" would
 * have QUIETLY narrowed the four call sites that did not skip them, and the
 * narrowing would have shown up as gates going green — the one failure mode
 * that never asks to be investigated. Each caller states the tree it means to
 * walk, and a reader can see it at the call site.
 *
 * Pure and synchronous. The three callers that were `async` never awaited
 * anything but `readdir` itself; scripts here are short-lived processes where
 * a blocking directory read costs nothing worth an `await`.
 */
import { readdirSync } from "node:fs";
import path from "node:path";

/** The repository root, resolved from this file's own location. */
export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

export type ListFilesOptions = {
  /**
   * Keep only files whose name ends with one of these. Matched with
   * `endsWith`, so both `".ts"` and `".test.ts"` are valid entries.
   * Omitted (or empty) keeps every regular file.
   */
  extensions?: readonly string[];

  /**
   * Drop files whose name ends with one of these, applied AFTER `extensions`.
   * `logging-lint-check.ts` wants `.ts` but not `.test.ts`, and expressing
   * that as a second list keeps both halves readable.
   */
  excludeSuffixes?: readonly string[];

  /** Directory names never descended into, at any depth. */
  skipDirectories?: readonly string[];

  /**
   * Skip every entry — file or directory — whose name starts with `.`.
   * Note this also drops dot-FILES, which is what the one caller using it
   * (`site-origin-check.ts`) has always done.
   */
  skipDotEntries?: boolean;

  /**
   * Return `[]` instead of throwing when a directory cannot be read.
   * Only for callers whose scan root is genuinely optional — a root that is
   * supposed to exist should throw, because "no files found" and "the path
   * moved" must not look the same to a gate.
   */
  tolerateMissing?: boolean;

  /**
   * Return paths relative to this directory instead of absolute ones.
   * Gates that print `file:line` want repo-relative output.
   */
  relativeTo?: string;
};

/**
 * Every regular file under `dir`, depth-first, filtered by `options`.
 *
 * Paths are absolute unless `relativeTo` is given. Ordering follows
 * `readdirSync`, which is the order the replaced implementations produced.
 */
export function listFilesRecursive(
  dir: string,
  options: ListFilesOptions = {}
): string[] {
  const {
    extensions,
    excludeSuffixes,
    skipDirectories,
    skipDotEntries = false,
    tolerateMissing = false,
    relativeTo
  } = options;

  const skipDirectorySet = new Set(skipDirectories ?? []);
  const found: string[] = [];

  const walk = (current: string): void => {
    let entries;

    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      if (tolerateMissing) return;
      throw error;
    }

    for (const entry of entries) {
      if (skipDotEntries && entry.name.startsWith(".")) continue;

      const absolute = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (skipDirectorySet.has(entry.name)) continue;
        walk(absolute);
        continue;
      }

      // Not `!entry.isDirectory()`: a socket or device node is not a file a
      // gate can read, and letting one through would surface as an unreadable
      // path far from here.
      if (!entry.isFile()) continue;

      if (
        extensions &&
        extensions.length > 0 &&
        !extensions.some((extension) => entry.name.endsWith(extension))
      ) {
        continue;
      }

      if (excludeSuffixes?.some((suffix) => entry.name.endsWith(suffix))) {
        continue;
      }

      found.push(relativeTo ? path.relative(relativeTo, absolute) : absolute);
    }
  };

  walk(dir);

  return found;
}
