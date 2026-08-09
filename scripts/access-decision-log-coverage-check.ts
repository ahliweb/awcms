#!/usr/bin/env bun
/**
 * `bun run access:decision-log:coverage:check` — Issue #426.
 *
 * Every terminal decision of `authorizeInTransaction` writes a row to
 * `awcms_abac_decision_logs`. That property is what lets this system answer
 * "why was this request refused" from a table instead of a guess — and it is
 * currently held up by review habit alone.
 *
 * ## Why a gate, and why now
 *
 * The program in `docs/awcms/program-model-keanggotaan-2026-08-09.md` adds
 * THREE new exit branches to this one function: `TENANT_SUSPENDED` (#429),
 * `ENTITLEMENT_REQUIRED`, and the principal/delegated refusals. The most likely
 * regression in the whole program is one of them returning early without
 * logging.
 *
 * Nothing would catch it. The default suite runs WITHOUT PostgreSQL, so "a row
 * was written" is not assertable there; the DB-gated suite is a separate
 * workflow. And the request is still refused correctly, so no behavioural test
 * fails and no user complains. Only the trail is missing — on exactly the
 * refusals that most need explaining to a customer.
 *
 * This gate is GREEN today. Its value is not finding a defect now; it is
 * locking the property before three new branches land on top of it.
 *
 * ## The rule, and why the naive version is wrong
 *
 * Naive rule: "every `return` is preceded by `recordDecisionLog(`". It is wrong
 * in both directions here, and reading the guard is what shows it:
 *
 * - The `401 AUTH_REQUIRED` return CANNOT log. It fires when `context` is null,
 *   so there is no `tenantUserId` to attribute a row to. Demanding a log there
 *   would demand an impossible row.
 * - The `403 SOD_CONFLICT` return is preceded by a `recordDecisionLog` that
 *   recorded an **allow** — the ABAC decision genuinely was allow, and SoD is an
 *   additive deny recorded in `awcms_sod_conflict_evaluations` by
 *   `checkHighRiskSoDConflicts`. A textual "log immediately before the return"
 *   rule would pass it for the wrong reason; a "log in the same block" rule
 *   would fail it for the wrong reason.
 *
 * So the rule is DOMINANCE, approximated lexically: for a terminal return at
 * position `i`, walk the chain of blocks enclosing it and look for a
 * `recordDecisionLog(` call that sits at THAT block's own depth (not nested
 * deeper inside a sibling branch) at a position before `i`.
 *
 * A `recordDecisionLog` inside `if (machine && …) { … }` therefore covers that
 * branch's own return, and does NOT cover a return outside it — which is the
 * distinction the naive rule cannot make and the whole reason this is not a
 * three-line regex.
 *
 * ## Honest limits
 *
 * Lexical, not an AST. Two consequences, both stated rather than hidden:
 *
 * 1. Exemptions are keyed by the ERROR CODE in the return (`AUTH_REQUIRED`), not
 *    by line offset — offsets rot on every edit above them. The cost is that a
 *    SECOND unlogged return reusing an already-exempt code would inherit the
 *    exemption. That is a narrow hole and a deliberate trade for a key that
 *    cannot go stale; the alternative was a ledger that breaks on unrelated
 *    edits, which is how ledgers become off-switches.
 * 2. It reasons about ONE function. `evaluateFieldAccessInTransaction` is
 *    deliberately out of scope and deliberately logs nothing: it is a projection
 *    refinement of an already-logged decision, not a separate resource-access
 *    decision. Widening this gate to it would demand rows that ADR-0049 §6
 *    argues should not exist.
 */
import { readFile } from "node:fs/promises";

const GUARD_SOURCE = "src/modules/identity-access/application/access-guard.ts";
const GUARDED_FUNCTION = "authorizeInTransaction";

/**
 * The detection signal, named once. Issue #425 is the reason it is a constant
 * rather than a literal buried in a loop: a signal that silently stops matching
 * turns a gate green-and-blind, and the only defence is that the name it keys on
 * is visible in one place next to the failure message that quotes it.
 */
const LOG_CALL_PATTERN = /recordDecisionLog\(/g;

/**
 * Terminal returns that legitimately write no decision row, keyed by the error
 * code they carry. Each entry is a DECISION and must say why the row is
 * impossible or wrong — not why it was inconvenient.
 */
export const DECISION_LOG_EXEMPTIONS: Readonly<Record<string, string>> = {
  AUTH_REQUIRED:
    "Fires when `context` is null — unknown, expired, revoked, or a machine " +
    "credential whose service account is gone. There is no `tenantUserId` to " +
    "attribute the row to, and `awcms_abac_decision_logs.tenant_user_id` is the " +
    "column an auditor reads. A row here would be attributable to nobody. The " +
    "authentication failure is already covered by the login/audit trail."
};

export type DecisionReturn = {
  /** `AUTH_REQUIRED`, `MODULE_DISABLED`, … or `ALLOW` for the success return. */
  code: string;
  index: number;
  logged: boolean;
};

export type DecisionLogProblem = {
  code: string;
  message: string;
};

/**
 * The body of one top-level exported function. Exported so the extraction
 * itself is testable — an extractor that silently returns "" would make every
 * assertion below vacuous.
 */
export function sliceFunctionBody(source: string, name: string): string | null {
  const start = source.indexOf(`export async function ${name}(`);

  if (start === -1) {
    return null;
  }

  const rest = source.slice(start + 1);
  const nextExport = rest.search(
    /\nexport (?:async function|function|type|const)\s/
  );

  return nextExport === -1 ? rest : rest.slice(0, nextExport);
}

/**
 * Depth of every character, where the function body's own statements sit at
 * depth 1 (depth 0 is outside the opening brace).
 */
function depthMap(body: string): number[] {
  const depths: number[] = new Array(body.length);
  let depth = 0;

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];

    if (char === "}") {
      depth -= 1;
    }

    depths[i] = depth;

    if (char === "{") {
      depth += 1;
    }
  }

  return depths;
}

/**
 * True when some `recordDecisionLog(` call DOMINATES `index`: it appears before
 * it, at the depth of one of the blocks enclosing it, so every path reaching
 * `index` through that block ran the call.
 */
function isDominatedByLog(
  body: string,
  depths: number[],
  index: number
): boolean {
  const returnDepth = depths[index] ?? 0;

  for (const match of body.matchAll(LOG_CALL_PATTERN)) {
    const at = match.index!;

    if (at >= index) {
      continue;
    }

    const logDepth = depths[at] ?? 0;

    // At or above the return's own block chain. A log nested DEEPER than the
    // return sits inside a sibling branch and dominates nothing.
    if (logDepth > returnDepth) {
      continue;
    }

    // The block the log sits in must still be open at `index` — otherwise it
    // closed before the return and belongs to a branch that was not taken.
    let closed = false;

    for (let i = at; i < index; i += 1) {
      if ((depths[i] ?? 0) < logDepth) {
        closed = true;
        break;
      }
    }

    if (!closed) {
      return true;
    }
  }

  return false;
}

/** Every terminal `return { allowed: … }` in the body, with its coverage. */
export function collectDecisionReturns(body: string): DecisionReturn[] {
  const depths = depthMap(body);
  const returns: DecisionReturn[] = [];

  for (const match of body.matchAll(/return\s*\{\s*allowed:\s*(true|false)/g)) {
    const index = match.index!;
    const tail = body.slice(index, index + 400);
    const failCode = tail.match(/fail\(\s*\d+\s*,\s*"([A-Z_]+)"/);

    returns.push({
      code: match[1] === "true" ? "ALLOW" : (failCode?.[1] ?? "UNKNOWN"),
      index,
      logged: isDominatedByLog(body, depths, index)
    });
  }

  return returns;
}

/** The rule, over already-classified returns. */
export function findUnloggedDecisions(
  returns: readonly DecisionReturn[],
  exemptions: Readonly<Record<string, string>> = DECISION_LOG_EXEMPTIONS
): DecisionLogProblem[] {
  return returns
    .filter((entry) => !entry.logged && !(entry.code in exemptions))
    .map((entry) => ({
      code: entry.code,
      message:
        `terminal return \`${entry.code}\` is not dominated by a ` +
        "`recordDecisionLog(` call, so this decision leaves no row in " +
        "`awcms_abac_decision_logs`. The request is still refused correctly, " +
        "which is why no behavioural test catches this — only the trail is " +
        "missing, on exactly the refusal that most needs explaining. Either log " +
        "before returning, or add a reasoned entry to DECISION_LOG_EXEMPTIONS " +
        "saying why the row is impossible."
    }));
}

/** An exemption whose code no longer appears unlogged is a stale claim. */
export function findStaleExemptions(
  returns: readonly DecisionReturn[],
  exemptions: Readonly<Record<string, string>> = DECISION_LOG_EXEMPTIONS
): DecisionLogProblem[] {
  const unlogged = new Set(
    returns.filter((entry) => !entry.logged).map((entry) => entry.code)
  );

  return Object.keys(exemptions)
    .filter((code) => !unlogged.has(code))
    .map((code) => ({
      code,
      message:
        "is exempt from the decision-log rule but no longer returns without " +
        "logging (it now logs, or the branch is gone). Delete the entry: an " +
        "exemption list that keeps entries it no longer needs is how a gate " +
        "turns into an off switch."
    }));
}

async function main(): Promise<void> {
  const source = await readFile(GUARD_SOURCE, "utf8");
  const body = sliceFunctionBody(source, GUARDED_FUNCTION);

  // A rename or a move would make every assertion below range over nothing and
  // report a cheerful OK. This repo has already shipped gates that passed while
  // scanning zero files.
  if (!body) {
    console.error(
      `access:decision-log:coverage:check FAILED — could not find ` +
        `\`export async function ${GUARDED_FUNCTION}(\` in ${GUARD_SOURCE}. ` +
        "If the chokepoint moved or was renamed, update this gate in the same commit."
    );
    process.exitCode = 1;
    return;
  }

  const returns = collectDecisionReturns(body);

  // Same reasoning one level down: zero returns means the pattern went stale,
  // not that the guard stopped deciding things.
  if (returns.length === 0) {
    console.error(
      "access:decision-log:coverage:check FAILED — 0 terminal returns found in " +
        `${GUARDED_FUNCTION}. That is a blind detector, not a clean function ` +
        `(coverage signal: ${LOG_CALL_PATTERN.source}).`
    );
    process.exitCode = 1;
    return;
  }

  const problems = [
    ...findUnloggedDecisions(returns),
    ...findStaleExemptions(returns)
  ];

  if (problems.length > 0) {
    console.error("access:decision-log:coverage:check FAILED");

    for (const problem of problems) {
      console.error(`  - ${problem.code} ${problem.message}`);
    }

    process.exitCode = 1;
    return;
  }

  const logged = returns.filter((entry) => entry.logged).length;

  console.log(
    `access:decision-log:coverage:check OK — ${returns.length} terminal decisions in ` +
      `${GUARDED_FUNCTION}, ${logged} write a decision log, ` +
      `${Object.keys(DECISION_LOG_EXEMPTIONS).length} reasoned exemption(s).`
  );
}

if (import.meta.main) {
  await main();
}
