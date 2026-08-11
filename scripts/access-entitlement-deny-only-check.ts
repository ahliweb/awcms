#!/usr/bin/env bun
/**
 * `bun run access:entitlement:deny-only:check` — ADR-0084, Gelombang 5 PR 5.1
 * of Issue #423.
 *
 * The entitlement layer may only ever refuse. It must not export anything that
 * can return an ALLOW, because an entitlement is a structural gate on top of
 * authorization and never a source of it.
 *
 * ## The mutation this exists to catch
 *
 * `evaluateEntitlementRequirement` returns `EntitlementDenial | null` — a shape
 * with no "yes" in it. The mutation that breaks the property is one line and
 * reads like tidying:
 *
 *     -  if (facts.held) return null;
 *     +  if (facts.held) return { allowed: true, ... };
 *
 * Nothing behavioural would fail. The chokepoint only tests the value for
 * truthiness, so an "allow" object refuses every entitled request — the loud
 * failure. The quiet one is worse and arrives later: once a call site starts
 * reading `.allowed`, entitlement becomes a second grant path, and a tenant that
 * pays for a plan is authorized by billing rather than by a role. ADR-0063
 * records this class exactly — a mutation that moved the RBAC check above the
 * ABAC block left every behavioural test green.
 *
 * ## Two rules, both structural
 *
 * 1. **No allow vocabulary.** No file in the layer may contain an `allowed`
 *    property assignment or an `allowed` field in a type it declares. The layer
 *    has no business naming the concept.
 * 2. **Every exported `evaluate*` returns the deny-or-null type.** Checked
 *    against the annotation, so a function that drops its return type and starts
 *    inferring a wider one fails rather than passing by omission.
 *
 * ## Why it carries SYNTHETIC probes
 *
 * Gelombang 1 recorded the failure mode this avoids: a ledger-driven check goes
 * inert the moment its ledger reaches zero, because a detector with nothing to
 * find cannot demonstrate it still works. The entitlement layer is one small
 * file that should stay clean forever, so a detector proven only by "it found
 * nothing" would be proven by nothing at all.
 *
 * So the detector runs against three sources that are DEFECTIVE ON PURPOSE and
 * fails if any of them passes. A refactor that quietly breaks the matching —
 * renaming the denial type, switching to a regex that no longer matches — turns
 * this gate red immediately instead of silently green.
 *
 * Pure: reads source text. No database, no network.
 */
import { readFileSync } from "node:fs";

/**
 * The files that make up the entitlement decision layer.
 *
 * An allow-list rather than a directory scan, deliberately: the property is
 * about a specific decision surface, and a scan would either drag in every
 * neighbour that legitimately says `allowed` (the whole rest of
 * `identity-access/domain`) or need an exclusion list that becomes the real
 * declaration anyway. A new file joining the layer is a review decision, and
 * adding it here is how that decision gets recorded.
 */
const LAYER_FILES: readonly string[] = [
  "src/modules/identity-access/domain/entitlement.ts"
];

/** The only return type an exported decision function in this layer may carry. */
const DENY_OR_NULL_RETURN = "EntitlementDenial | null";

/**
 * `allowed` used as a property — declared in a type, or written in an object
 * literal. Deliberately NOT a bare word match: the file's own prose explains at
 * length why it can never allow anything, and a gate that forbids the English
 * word would forbid its own justification.
 */
const ALLOW_VOCABULARY = /(^|[^A-Za-z0-9_])allowed\s*[?:]/;

/** `export function evaluateX(...)...: <return type> {` — annotation captured. */
const EXPORTED_EVALUATOR =
  /export\s+function\s+(evaluate[A-Za-z0-9_]*)\s*\([\s\S]*?\)\s*:\s*([^{]+)\{/g;

export type DenyOnlyFinding = { file: string; problem: string };

/**
 * The detector, over source TEXT so the probes below can feed it strings that
 * were never written to disk.
 */
export function findDenyOnlyViolations(
  file: string,
  source: string
): DenyOnlyFinding[] {
  const findings: DenyOnlyFinding[] = [];

  for (const line of source.split("\n")) {
    // Comment lines are prose about the rule, not code that breaks it.
    const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, "");

    if (ALLOW_VOCABULARY.test(code)) {
      findings.push({
        file,
        problem:
          `names an \`allowed\` property (\`${line.trim()}\`). The entitlement ` +
          "layer may only refuse; a shape carrying `allowed` is a second grant " +
          "path waiting for its first reader."
      });
    }
  }

  const seen: string[] = [];

  for (const match of source.matchAll(EXPORTED_EVALUATOR)) {
    const [, name, returnType] = match;
    seen.push(name!);

    if (returnType!.trim() !== DENY_OR_NULL_RETURN) {
      findings.push({
        file,
        problem:
          `exported \`${name}\` returns \`${returnType!.trim()}\`, not ` +
          `\`${DENY_OR_NULL_RETURN}\`. A decision function in this layer must ` +
          "be unable to express an allow at the type level."
      });
    }
  }

  if (seen.length === 0) {
    // The self-test that keeps this from passing an empty file. #425's lesson:
    // a signal that silently stops matching turns a gate green-and-blind.
    findings.push({
      file,
      problem:
        "declares no exported `evaluate*` function. Either the layer lost its " +
        "decision function or this gate's matcher stopped recognising it — " +
        "both are failures, and they are indistinguishable from here."
    });
  }

  return findings;
}

/**
 * Sources that MUST be rejected. Each is the smallest form of one real
 * regression; if the detector passes any of them it has stopped working.
 */
const PROBES: readonly { name: string; source: string }[] = [
  {
    name: "evaluator returning an allow object",
    source: `export type EntitlementDenial = { reason: string };
export function evaluateEntitlementRequirement(f: unknown): EntitlementDenial | null {
  if (f) { return { allowed: true, reason: "entitled" }; }
  return null;
}`
  },
  {
    name: "evaluator widened to a boolean return",
    source: `export type EntitlementDenial = { reason: string };
export function evaluateEntitlementRequirement(f: unknown): boolean {
  return Boolean(f);
}`
  },
  {
    name: "a type in the layer declaring an allowed field",
    source: `export type EntitlementDecision = { allowed: boolean; reason: string };
export function evaluateEntitlementRequirement(f: unknown): EntitlementDenial | null {
  return null;
}`
  },
  {
    name: "layer with no decision function at all",
    source: `export const ENTITLEMENT_REQUIRED_POLICY = "entitlement_required";`
  }
];

function main(): void {
  const failures: string[] = [];

  for (const probe of PROBES) {
    if (findDenyOnlyViolations("<probe>", probe.source).length === 0) {
      failures.push(
        `  SELF-TEST FAILED — the detector accepted a source it must reject: ` +
          `${probe.name}. This gate is no longer checking anything.`
      );
    }
  }

  for (const file of LAYER_FILES) {
    let source: string;

    try {
      source = readFileSync(file, "utf8");
    } catch {
      failures.push(
        `  ${file} — listed in LAYER_FILES but missing. A dead entry is itself ` +
          "a failure: it means the gate is guarding a file nobody has."
      );
      continue;
    }

    for (const finding of findDenyOnlyViolations(file, source)) {
      failures.push(`  ${finding.file} — ${finding.problem}`);
    }
  }

  if (failures.length > 0) {
    console.error("access:entitlement:deny-only:check FAILED\n");
    console.error(failures.join("\n"));
    process.exit(1);
  }

  console.log(
    `access:entitlement:deny-only:check OK — ${LAYER_FILES.length} file(s) in ` +
      `the entitlement layer export deny-or-null decisions only; ` +
      `${PROBES.length} synthetic probe(s) still rejected.`
  );
}

if (import.meta.main) {
  main();
}
