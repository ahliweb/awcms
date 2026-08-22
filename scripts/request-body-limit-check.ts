#!/usr/bin/env bun
/**
 * `bun run api:body-limit:check` — no route reads a request body without a
 * ceiling. Finding A4 of the 17 August 2026 audit round.
 *
 * ## What went wrong, and why nothing noticed
 *
 * `request.json()`, `request.text()` and `request.formData()` all read the
 * WHOLE body before they return anything, with no bound. Twenty-five route
 * files called one of them directly.
 *
 * Twenty-four of those were behind a resolved session, so the exposure was a
 * caller spending its own authenticated quota. **One was not.**
 * `data-lifecycle/dry-run.ts` calls `resolveAuthInputs`, which checks that a
 * tenant header and a token are PRESENT — it resolves neither — and then reads
 * the body. Two arbitrary strings were enough to reach it.
 *
 * `checkContentLengthCeiling` in the middleware could not help, and the reason
 * is worth stating rather than assuming: it returns `true` when the header is
 * ABSENT. A chunked request declares no `Content-Length`, so the one case that
 * needs a ceiling is the one case that pre-check waves through. It is
 * defence-in-depth against an honestly-declared oversized body, which is not
 * the threat.
 *
 * ## Why a gate rather than a review note
 *
 * The conversion is 25 files today and 26 the next time somebody writes a POST.
 * `readJsonBody` has existed since Issue #466 and was used by some routes and
 * not others, which is the state a convention reaches when nothing enforces it:
 * correct wherever somebody remembered.
 *
 * ## Honest limits
 *
 * Lexical, and deliberately narrow:
 *
 * - it looks only under `src/pages/api/`. The reader helpers themselves live in
 *   `src/lib/security/request-body-limit.ts` and must call the raw APIs;
 * - comment lines are skipped, so a docblock explaining WHY the bounded reader
 *   exists is not read as a call. Several of the converted files carry exactly
 *   such a paragraph;
 * - it matches the call, not the ceiling. A route that reads bounded and then
 *   does something unbounded with the result is a different problem, and this
 *   gate does not claim to see it.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

const SCAN_ROOT = "src/pages/api";

/**
 * The three unbounded readers, named once. A signal that silently stops
 * matching turns a gate green-and-blind; keeping the pattern beside the message
 * that quotes it is the only defence this repo has found for that.
 */
const UNBOUNDED_BODY_READ = /\brequest\s*\.\s*(json|text|formData)\s*\(/;

/**
 * Files allowed to call the raw APIs. EMPTY, and it should stay that way: the
 * bounded readers cover JSON, text and urlencoded form bodies, and a route that
 * needs something else (multipart, a stream) needs a bounded reader for THAT,
 * not an exemption from the ceiling.
 *
 * ONLY REMOVE LINES FROM THIS LIST.
 */
const ALLOWED_RAW_BODY_READS: readonly string[] = [];

/** Comment lines are skipped so a docblock MENTIONING a call is not a call. */
export function readsBodyUnbounded(content: string): boolean {
  return content.split("\n").some((line) => {
    const trimmed = line.trim();

    if (
      trimmed.startsWith("*") ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*")
    ) {
      return false;
    }

    return UNBOUNDED_BODY_READ.test(line);
  });
}

export type BodyLimitResult = {
  /** Reads a body with no ceiling and is not allow-listed. */
  unbounded: string[];
  /** Allow-list entries that no longer read a body unbounded — the list may only shrink. */
  stale: string[];
};

export function evaluateBodyLimits(
  files: readonly { path: string; content: string }[],
  allowlist: readonly string[]
): BodyLimitResult {
  const allowed = new Set(allowlist);
  const unbounded: string[] = [];
  const stillRaw = new Set<string>();

  for (const file of files) {
    if (!readsBodyUnbounded(file.content)) continue;

    if (allowed.has(file.path)) {
      stillRaw.add(file.path);
      continue;
    }

    unbounded.push(file.path);
  }

  return {
    unbounded,
    stale: allowlist.filter((entry) => !stillRaw.has(entry))
  };
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;

  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.name.endsWith(".ts")) {
      yield full;
    }
  }
}

async function main(): Promise<void> {
  const files: { path: string; content: string }[] = [];

  for await (const file of walk(SCAN_ROOT)) {
    files.push({
      path: file.split(path.sep).join("/"),
      content: await Bun.file(file).text()
    });
  }

  // A gate that walks nothing reports success. This repository has shipped one
  // of those before, and the fix is to say so out loud rather than to be
  // careful.
  if (files.length === 0) {
    console.error(
      `api:body-limit:check FAILED — scanned 0 files under ${SCAN_ROOT}. ` +
        "Run this from the repository root."
    );
    process.exit(1);
  }

  const { unbounded, stale } = evaluateBodyLimits(
    files,
    ALLOWED_RAW_BODY_READS
  );

  if (unbounded.length === 0 && stale.length === 0) {
    console.log(
      `api:body-limit:check OK — ${files.length} route file(s) under ${SCAN_ROOT}; ` +
        `none reads a request body without a ceiling, ${ALLOWED_RAW_BODY_READS.length} reasoned exemption(s).`
    );
    process.exit(0);
  }

  for (const file of unbounded) {
    console.error(
      `${file} — reads the request body with no ceiling. Use readJsonBody / ` +
        "readTextBody / readFormBody from src/lib/security/request-body-limit.ts, " +
        "and answer bodyTooLargeResponse(limitBytes) when the read reports tooLarge. " +
        "`request.json()`/`.text()`/`.formData()` buffer the WHOLE body before " +
        "returning, and the middleware's Content-Length pre-check passes a request " +
        "that declares no length at all."
    );
  }

  for (const file of stale) {
    console.error(
      `${file} — listed in ALLOWED_RAW_BODY_READS but no longer reads a body ` +
        "unbounded. Remove the line: that list may only shrink."
    );
  }

  console.error(
    `\napi:body-limit:check FAILED — ${unbounded.length} unbounded read(s), ${stale.length} stale exemption(s).`
  );

  process.exit(1);
}

if (import.meta.main) {
  await main();
}
