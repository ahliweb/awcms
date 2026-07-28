/**
 * Structural guard for Issue #632's acceptance criterion "Preset does not
 * enable local filesystem uploads for news images." There is deliberately
 * no `NEWS_MEDIA_LOCAL_FALLBACK_ENABLED`-style flag to check at runtime
 * (see `news-portal-preset-readiness.ts`'s header comment) — this mode has
 * structurally no local-fallback code path to disable.
 *
 * Issue #634 added the first real upload code (presigned upload session
 * create/finalize/cancel) — its route handlers live under
 * `src/pages/api/v1/media/news-images/` (Astro's file-based routing
 * requires routes to live outside `src/modules/`), so this test scans the
 * route tree too. Its job is to keep failing loudly the moment any PR
 * introduces a local-disk write for media bytes anywhere in these trees.
 *
 * ADR-0044 retired the `news_portal` module. The scanned module directory
 * moved to the two modules that now actually touch media: `media_library`
 * (which owns the registry, the R2 client, and the upload sessions since
 * ADR-0036) and `blog_content` (which absorbed the FK-holding ad placements
 * and already owned the media reference gate). That is a WIDENING, not a
 * relocation — the guarantee is about media bytes, not about a module name,
 * and scanning only the retired module's former files would have quietly
 * stopped covering the code that does the uploading.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const MEDIA_OWNING_MODULE_DIRS = [
  path.join(import.meta.dir, "../src/modules/media-library"),
  path.join(import.meta.dir, "../src/modules/blog-content")
];

const NEWS_MEDIA_ROUTES_DIR = path.join(
  import.meta.dir,
  "../src/pages/api/v1/media/news-images"
);

const FORBIDDEN_PATTERNS = [
  /Bun\.write\s*\(/,
  /fs\.writeFile/,
  /writeFileSync/,
  /LOCAL_STORAGE_PATH/,
  /FILE_STORAGE_DRIVER/,
  /LOCAL_FILE_UPLOADS_ENABLED/,
  /LOCAL_MEDIA_STORAGE_ENABLED/
];

function listTsFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...listTsFiles(fullPath));
    } else if (entry.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

function findOffenders(rootDir: string, files: string[]): string[] {
  const offenders: string[] = [];

  for (const file of files) {
    const content = readFileSync(file, "utf-8");

    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(content)) {
        offenders.push(`${path.relative(rootDir, file)} matches ${pattern}`);
      }
    }
  }

  return offenders;
}

describe("media modules — no local filesystem fallback for media bytes", () => {
  test("no source file under the media-owning modules writes bytes to local disk or references a local-upload flag", () => {
    for (const dir of MEDIA_OWNING_MODULE_DIRS) {
      const files = listTsFiles(dir);
      expect(files.length).toBeGreaterThan(0);

      expect(findOffenders(dir, files)).toEqual([]);
    }
  });

  test("no source file under src/pages/api/v1/media/news-images (Issue #634's upload-session routes) writes bytes to local disk or references a local-upload flag", () => {
    const files = listTsFiles(NEWS_MEDIA_ROUTES_DIR);
    expect(files.length).toBeGreaterThan(0);

    expect(findOffenders(NEWS_MEDIA_ROUTES_DIR, files)).toEqual([]);
  });
});
