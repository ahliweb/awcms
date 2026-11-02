#!/usr/bin/env bun
/**
 * ui-single-flight-audit.ts — `bun run ui:single-flight:audit[ --write|--check]`
 * (Issue #1224).
 *
 * Scans every client script under `src/pages/**`, `src/components/**` and
 * `src/lib/ui/**` for form / mutation entry points and renders the audit table
 * that lives in `docs/awcms/ui-single-flight-audit.md` (+ `.id.md`).
 *
 *   bun run ui:single-flight:audit            # print the English block
 *   bun run ui:single-flight:audit --write    # rewrite the block in both docs
 *   bun run ui:single-flight:audit --check    # exit 1 if either doc is stale
 *
 * The check is also run by `tests/single-flight-source-contract.test.ts`, which
 * is what puts it in `bun run check`; this script is the command a maintainer
 * runs after adding a form.
 */
import {
  auditRows,
  checkDocs,
  renderBlock,
  writeDocs
} from "./lib/single-flight-audit";

const flag = process.argv[2];

if (flag === "--write") {
  writeDocs();
  console.log("ui:single-flight:audit OK — wrote both audit docs.");
} else if (flag === "--check") {
  const problems = checkDocs();

  if (problems.length > 0) {
    console.error("ui:single-flight:audit FAILED");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log("ui:single-flight:audit OK — both audit docs are current.");
} else {
  console.log(renderBlock(auditRows(), "en"));
}
