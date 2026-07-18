/**
 * Read-only freshness gate for `docs/awcms/api-reference.md` (Issue #182,
 * epic #177).
 *
 * `scripts/api-docs-generate.ts` (`bun run api:docs:generate`) regenerates the
 * reference doc from the bundled OpenAPI/AsyncAPI contracts — but it's a
 * MUTATION (it rewrites the file), so it can't be part of `bun run check`
 * directly. This script is the read-only twin: it regenerates the Markdown in
 * memory and diffs it against the COMMITTED file, failing loudly if a contract
 * change landed without regenerating and committing the reference doc.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  API_REFERENCE_PATH,
  buildApiReferenceMarkdown
} from "./api-docs-generate";

export async function runApiDocsCheck(
  rootDir = process.cwd()
): Promise<string[]> {
  const committedPath = path.join(rootDir, API_REFERENCE_PATH);

  let committed: string;
  try {
    committed = await readFile(committedPath, "utf8");
  } catch {
    return [
      `${API_REFERENCE_PATH} is missing — run \`bun run api:docs:generate\` and commit the result.`
    ];
  }

  const fresh = await buildApiReferenceMarkdown(rootDir);

  if (fresh === committed) return [];

  return [
    `${API_REFERENCE_PATH} does not match deterministic generation from the bundled OpenAPI/AsyncAPI contracts — run \`bun run api:docs:generate\` and commit the result (a contract change likely landed without regenerating the reference doc).`
  ];
}

if (import.meta.main) {
  const problems = await runApiDocsCheck();

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(problem);
    }
    console.error(`\napi:docs:check GAGAL — ${problems.length} temuan.`);
    process.exitCode = 1;
  } else {
    console.log(
      "api:docs:check OK — docs/awcms/api-reference.md matches deterministic generation from the bundled contracts."
    );
  }
}
