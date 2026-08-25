import type { ModuleDescriptor } from "./module-contract";
import { stripComments } from "../../../scripts/lib/source-text";

/**
 * Permission-enforcement coverage (ADR-0057 §F).
 *
 * Two modules have now shipped seeded permissions that NOTHING checks, and
 * both were found only because someone set out to build the screen for them:
 * `media_library` had five (ADR-0056), `blog_content` had four (ADR-0057), and
 * in the second case the gap was not a spare catalogue row — it meant a page
 * could never be published by any code path in the repo, while public page
 * search filtered on `status = 'published'` and therefore always returned
 * nothing.
 *
 * Every existing gate answers a different question. `admin-navigation-registry`
 * catches a navigation entry whose path has no page. The per-screen contract
 * tests bind a screen's permission keys to what its routes enforce. None of
 * them asks whether a DECLARED permission has an enforcer at all, which is why
 * both gaps sat in `main` with `bun run check` green.
 *
 * This module answers exactly that: for every permission a module descriptor
 * declares, does some source file build an `authorizeInTransaction` guard for
 * it — or is its absence recorded as a decision?
 *
 * ## And the same question backwards
 *
 * It shipped asking only the forward half, and the reverse half is the one with
 * the worse failure behind it: a guard naming a permission NO descriptor
 * declares has no catalogue row, so no role can hold it, so every actor is
 * denied in every deployment (`evaluateEnforcementCoverage` has the full
 * argument). The forward loop cannot see it — it walks the declared set, and an
 * undeclared key is by definition not in it.
 *
 * The proof that this was a live gap and not a tidy symmetry: the repo's own
 * scanner invented `seo_distribution.redirect.purge` out of a ternary's
 * comparison operand, and that phantom sat in the enforced set unremarked for
 * as long as nothing ever read that set back.
 *
 * ## What counts as an enforcer, and why the shape is the whole test
 *
 * `authorizeInTransaction(tx, tenantId, tokenHash, now, guard)` takes an
 * `AccessRequest`: an object literal carrying `moduleKey`, `activityCode` and
 * `action` together. Requiring all THREE keys in one literal is what separates
 * a guard from the two things that would otherwise be mistaken for one:
 *
 * - **audit events** carry `moduleKey` and `action` but never `activityCode`,
 *   and their `action` is a dotted event name (`blog.page.purged`) rather than
 *   a permission action. `media-object-directory.ts` is full of them, and
 *   ADR-0056 records that reading them as gates gives the wrong answer;
 * - **row mappings** (`action: record.action`) carry no string literal at all.
 *
 * ## Why it scans all of `src/`, not `src/pages/api/`
 *
 * `media_library.media.verify` is enforced inside an application function
 * (`media-finalize-upload-session.ts`), not in a route file. ADR-0056 §1 notes
 * that scanning route files alone gets the answer wrong in BOTH directions —
 * it misses that gate and mistakes audit-action strings for gates.
 *
 * This is a purely syntactic check and it is honest about that: it proves a
 * guard for the permission is CONSTRUCTED somewhere, not that it sits on the
 * right endpoint or that the endpoint is reachable. That is the class of defect
 * it is for. A permission enforced only in dead code would still pass, and the
 * per-screen contract tests are what cover the next layer down.
 */

/** `moduleKey.activityCode.action` — the same spelling `permissionKey()` produces. */
export type PermissionTriple = {
  moduleKey: string;
  activityCode: string;
  action: string;
};

export type EnforcementException = {
  key: string;
  reason: string;
};

export type UnenforcedPermission = {
  key: string;
  moduleKey: string;
};

/** A guard built in `src/` for a permission no module descriptor declares. */
export type UndeclaredGuard = {
  key: string;
  /** Every scanned source that builds it, so the report names the route to fix. */
  sources: string[];
};

export type EnforcementCoverageResult = {
  valid: boolean;
  declaredCount: number;
  enforcedCount: number;
  unenforced: UnenforcedPermission[];
  /**
   * The other direction: guards that demand a permission nothing declares.
   * See `evaluateEnforcementCoverage` for why an entry here is a dead endpoint
   * rather than an untidy name.
   */
  undeclaredGuards: UndeclaredGuard[];
  /** Exceptions whose permission is no longer declared, or has since gained an enforcer — a stale allow-list entry is how a gate quietly stops asking. */
  staleExceptions: string[];
};

export function permissionTripleKey(triple: PermissionTriple): string {
  return `${triple.moduleKey}.${triple.activityCode}.${triple.action}`;
}

/**
 * A guard field is written one of two ways, and a scanner that only reads the
 * first is not merely incomplete — it reports the majority of this repo's
 * permissions as unenforced:
 *
 *     moduleKey: "media_library"          // string literal
 *     moduleKey: THEMING_MODULE_KEY       // imported string constant
 *
 * `theming`, `site_search`, `seo_distribution`, `comments`, `media_library`
 * and others name their module key and activity codes through constants. The
 * first draft of this gate read literals only and produced 39 false positives,
 * including three permissions that had gained endpoints the same week.
 *
 * `constants` maps every `const NAME = "value"` found across the scanned
 * sources. A name bound to two different values anywhere is deliberately left
 * UNRESOLVED rather than guessed: the resulting report of "unenforced" is
 * visible and fixable, whereas guessing one of the two values could mark a
 * permission enforced on the strength of an unrelated file's constant.
 *
 * That conflict rule is right for names that arrive by IMPORT and wrong for
 * names a file binds itself, which is why callers resolve through
 * `resolveConstantsForSource` rather than passing the cross-file table
 * directly. See its comment for the two permissions the flat table lost.
 */
function readStringField(
  literal: string,
  field: string,
  constants: ReadonlyMap<string, string | null>
): string | null {
  const match = new RegExp(
    `\\b${field}\\s*:\\s*(?:"([^"]+)"|([A-Za-z_$][A-Za-z0-9_$]*))`
  ).exec(literal);

  if (!match) return null;
  if (match[1] !== undefined) return match[1];

  return constants.get(match[2]!) ?? null;
}

/**
 * A string compared against, rather than assigned — `lifecycleAction === "purge"`.
 *
 * Removed WHOLE, quotes included, rather than blanked to `""`. Blanking looks
 * equivalent and is not: `("" ? "delete" : "update")` re-pairs the quotes, so
 * the GAPS between the real literals (`" ? "`, `" : "`) start matching as
 * literals themselves. The first draft of this fix did exactly that and
 * invented four permissions per route.
 */
const COMPARISON_OPERAND = /(?:===|!==|==|!=)\s*"[^"]*"/g;

/**
 * `action` is the one guard field that is not always a single value. Two
 * comments routes decide it per request:
 *
 *     action: (decision === "approve" ? "approve" : "reject") as ...
 *
 * A reader that only accepts `action: "literal"` reports both
 * `comments.moderation.approve` and `.reject` as unenforced while the route
 * gates every request on one of them. So every string literal in the
 * expression counts — the guard really can require any of them.
 *
 * Every literal in a VALUE position, that is. The string a ternary tests
 * against is not one of the actions the guard can require:
 *
 *     action: (lifecycleAction === "purge" ? "delete" : "update") as ...
 *
 * requires `delete` or `update` and never `purge`, but reading every literal
 * alike invented a third permission, `seo_distribution.redirect.purge`, that no
 * module declares and no catalogue row backs. That phantom was harmless only
 * for as long as this file asked its question in one direction: an invented
 * ENFORCED key that matches nothing simply never gets looked at. It stops being
 * harmless the moment a phantom collides with a declared-but-genuinely-
 * unenforced permission — the gate would then report it covered — and it stops
 * being harmless immediately for `undeclaredGuards` below, which reads the
 * enforced set as the set of permissions this repo actually demands.
 *
 * Note the two routes above are the reason to drop only the OPERAND and not the
 * whole condition: `approve` is both what the request is tested against and
 * what the guard requires, and it survives here because it also appears in a
 * value position.
 *
 * The expression ends at the field separator, and the scan is over a literal
 * with nested objects already blanked, so a comma inside a nested value cannot
 * cut it short.
 */
function readActionValues(
  fields: string,
  constants: ReadonlyMap<string, string | null>
): string[] {
  const match = /\baction\s*:\s*([^,\n]*(?:\n(?![^\n]*:)[^,\n]*)*)/.exec(
    fields
  );
  if (!match) return [];

  const expression = match[1]!.replace(COMPARISON_OPERAND, "");
  const literals = [...expression.matchAll(/"([^"]+)"/g)].map(
    (found) => found[1]!
  );

  if (literals.length > 0) return literals;

  const identifier = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*$/.exec(expression);
  if (!identifier) return [];

  const resolved = constants.get(identifier[1]!);
  return resolved ? [resolved] : [];
}

const STRING_CONSTANT =
  /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*[^=]+)?=\s*"([^"]+)"/g;

/**
 * Collects `const NAME = "value"` bindings across all sources. Conflicting
 * bindings for one name resolve to `null` (unresolvable) rather than to either
 * value — see `readStringField`.
 */
export function collectStringConstants(
  sources: readonly string[]
): Map<string, string | null> {
  const constants = new Map<string, string | null>();

  for (const source of sources) {
    const clean = stripComments(source);
    for (const match of clean.matchAll(STRING_CONSTANT)) {
      const name = match[1]!;
      const value = match[2]!;

      if (!constants.has(name)) {
        constants.set(name, value);
        continue;
      }

      if (constants.get(name) !== value) {
        constants.set(name, null);
      }
    }
  }

  return constants;
}

/**
 * The bindings visible to ONE source file: its own `const NAME = "value"`
 * first, and the cross-file table only for names it does not bind itself.
 *
 * Reading the repo as one flat namespace instead is not a rounding error — it
 * is the very false-positive class this file's header warns about, produced by
 * the gate's own first release, and it was believed. `MODULE_KEY` is bound in
 * five files to four different values (`visitor_analytics`, `email` twice,
 * `sync_storage`, `domain_event_runtime`), so the conflict rule above left it
 * unresolvable EVERYWHERE. The guard in `src/pages/api/v1/analytics/settings.ts`
 * — `moduleKey: MODULE_KEY`, with `const MODULE_KEY = "visitor_analytics"` two
 * dozen lines above it — was therefore invisible, and
 * `visitor_analytics.settings.read`/`.update` were written into the exception
 * list as decisions, with a stated reason ("no route names a settings
 * activity") that the route disproves line by line.
 *
 * A name the file binds itself wins outright; the cross-file table is consulted
 * only for the names that can only have arrived by import. A file that binds
 * one name to two values still resolves to `null` — locally unresolvable is
 * still unresolvable, and guessing there would reintroduce the opposite defect.
 */
export function resolveConstantsForSource(
  source: string,
  crossFileConstants: ReadonlyMap<string, string | null>
): Map<string, string | null> {
  const resolved = new Map(crossFileConstants);

  for (const [name, value] of collectStringConstants([source])) {
    resolved.set(name, value);
  }

  return resolved;
}

/**
 * Every balanced `{...}` region, outermost included.
 *
 * An innermost-braces-only match is not enough, and the way it fails is
 * instructive: `workflows/tasks/{id}/decisions.ts` builds its guard as
 * `{ ...GUARD_ACTIVITY, action: "approve", resourceAttributes: { ... } }`.
 * Matching innermost braces finds only `resourceAttributes`' object and never
 * the guard around it, so a fully enforced permission reads as unenforced.
 */
function findObjectLiterals(text: string): string[] {
  const regions: string[] = [];
  const opens: number[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === "{") {
      opens.push(index);
      continue;
    }

    if (character === "}" && opens.length > 0) {
      regions.push(text.slice(opens.pop()!, index + 1));
    }
  }

  return regions;
}

/**
 * Blanks out nested `{...}` so a field is read only when it belongs to THIS
 * literal. Without it, an audit-event object carrying
 * `attributes: { action: "..." }` inside a literal that also names a module
 * and activity would register as a guard for a permission nobody checks.
 */
function withoutNestedLiterals(region: string): string {
  const inner = region.slice(1, -1);
  let depth = 0;
  let masked = "";

  for (const character of inner) {
    if (character === "{") {
      depth += 1;
      masked += " ";
      continue;
    }

    if (character === "}") {
      depth = Math.max(0, depth - 1);
      masked += " ";
      continue;
    }

    masked += depth > 0 ? " " : character;
  }

  return masked;
}

/**
 * Collects every guard triple a single source file constructs.
 *
 * Handles the two shapes the repo actually uses:
 *
 * 1. all three keys in one literal —
 *    `{ moduleKey: "blog_content", activityCode: "pages", action: "publish" as const }`;
 * 2. an activity constant spread beside a per-call action —
 *    `const UPDATE_ACTIVITY = { moduleKey: "blog_content", activityCode: "pages" };`
 *    then `{ ...UPDATE_ACTIVITY, action: "update" }`. Four routes do this
 *    because they gate two actions through one activity, and a scanner that
 *    missed it would report `blog_content.pages.update` unenforced while the
 *    route enforces it on every request.
 */
export function collectGuardTriples(
  source: string,
  constants: ReadonlyMap<string, string | null> = new Map()
): PermissionTriple[] {
  const clean = stripComments(source);
  const regions = findObjectLiterals(clean);
  const literals = regions.map((region) => ({
    region,
    fields: withoutNestedLiterals(region)
  }));

  const activityConstants = new Map<
    string,
    { moduleKey: string; activityCode: string }
  >();

  for (const { region, fields } of literals) {
    const moduleKey = readStringField(fields, "moduleKey", constants);
    const activityCode = readStringField(fields, "activityCode", constants);

    if (!moduleKey || !activityCode) continue;

    // `const NAME = { moduleKey: ..., activityCode: ... }` — the assignment
    // ends where this literal begins, so look back from it.
    const at = clean.indexOf(region);
    const preceding = clean.slice(Math.max(0, at - 120), at);
    const nameMatch =
      /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*(?::[^=]*)?=\s*$/.exec(preceding);

    if (nameMatch) {
      activityConstants.set(nameMatch[1]!, { moduleKey, activityCode });
    }
  }

  const triples: PermissionTriple[] = [];

  for (const { fields } of literals) {
    const actions = readActionValues(fields, constants);
    if (actions.length === 0) continue;

    const moduleKey = readStringField(fields, "moduleKey", constants);
    const activityCode = readStringField(fields, "activityCode", constants);

    if (moduleKey && activityCode) {
      for (const action of actions) {
        triples.push({ moduleKey, activityCode, action });
      }
      continue;
    }

    // No `activityCode` of its own — an audit event, unless it spreads an
    // activity constant.
    const spread = /\.\.\.([A-Za-z0-9_$]+)/.exec(fields);
    if (!spread) continue;

    const activity = activityConstants.get(spread[1]!);
    if (!activity) continue;

    for (const action of actions) {
      triples.push({ ...activity, action });
    }
  }

  return triples;
}

/**
 * Both directions between the two things that must agree about a permission:
 * what the descriptors DECLARE, and what the code DEMANDS.
 *
 * The forward direction — a declared permission nothing enforces — is the one
 * this file was written for, and its consequence is a catalogue row that grants
 * nothing.
 *
 * The reverse direction costs one more loop and catches the strictly worse
 * failure. `authorizeInTransaction` answers from `grantedPermissionKeys`, built
 * by joining the actor's active role grants to `awcms_permissions`. A key that
 * no descriptor declares has no catalogue row to join to, so no role can hold
 * it, so `evaluateAccess` returns `default_deny` — for the tenant owner, for
 * the platform tenant, for every actor in every deployment, permanently. The
 * endpoint is not weakly guarded; it is DEAD, and it answers 403 in a shape
 * indistinguishable from a legitimate refusal.
 *
 * This repo has shipped that exact defect twice. `POST /api/v1/identity/
 * business-scope/assignments` refused every input in every deployment (#180
 * F2), and `blog_content.pages.publish` meant no page could be published by any
 * code path while public search filtered on `status = 'published'` and
 * therefore always returned nothing (ADR-0057). Both were found by hand, months
 * later, by someone who set out to build a screen. Neither is visible to the
 * forward question: a guard whose key matches no declaration is simply not in
 * the set the forward loop iterates.
 *
 * `undeclaredGuards` shares the EXCEPTIONS list with the forward direction, and
 * deliberately so — an entry there asserts that a permission key and its
 * enforcement may legitimately disagree, which is the same claim in both
 * directions and should be argued once, in an ADR.
 */
export function evaluateEnforcementCoverage(
  modules: readonly ModuleDescriptor[],
  sources: readonly string[],
  exceptions: readonly EnforcementException[],
  /**
   * Paths parallel to `sources`, used only to name the offending file in the
   * reverse report. Absent for callers that scan text they built themselves.
   */
  sourceNames: readonly string[] = []
): EnforcementCoverageResult {
  const crossFileConstants = collectStringConstants(sources);
  const enforced = new Set<string>();
  const guardSources = new Map<string, string[]>();

  for (const [index, source] of sources.entries()) {
    const constants = resolveConstantsForSource(source, crossFileConstants);

    for (const triple of collectGuardTriples(source, constants)) {
      const key = permissionTripleKey(triple);
      enforced.add(key);

      const name = sourceNames[index];
      if (name === undefined) continue;

      const seen = guardSources.get(key);
      if (seen) {
        if (!seen.includes(name)) seen.push(name);
        continue;
      }
      guardSources.set(key, [name]);
    }
  }

  const declared = new Map<string, string>();

  for (const module of modules) {
    for (const permission of module.permissions ?? []) {
      const key = permissionTripleKey({
        moduleKey: module.key,
        activityCode: permission.activityCode,
        action: permission.action
      });
      declared.set(key, module.key);
    }
  }

  const excused = new Set(exceptions.map((exception) => exception.key));

  const unenforced: UnenforcedPermission[] = [];

  for (const [key, moduleKey] of declared) {
    if (enforced.has(key) || excused.has(key)) continue;
    unenforced.push({ key, moduleKey });
  }

  const undeclaredGuards: UndeclaredGuard[] = [];

  for (const key of enforced) {
    if (declared.has(key) || excused.has(key)) continue;
    undeclaredGuards.push({ key, sources: guardSources.get(key) ?? [] });
  }

  // An exception for a permission that is gone, or that now HAS an enforcer,
  // is worse than no exception: it is a documented reason that no longer
  // applies to anything, and it keeps the gate from asking again.
  //
  // "Gone" cannot mean "not declared" alone once the reverse direction exists:
  // an exception excusing an UNDECLARED guard is doing its job precisely
  // because the permission is undeclared, and calling it stale would make that
  // kind of exception impossible to write.
  const staleExceptions = [...excused].filter(
    (key) =>
      (!declared.has(key) && !enforced.has(key)) ||
      (declared.has(key) && enforced.has(key))
  );

  unenforced.sort((left, right) => left.key.localeCompare(right.key));
  undeclaredGuards.sort((left, right) => left.key.localeCompare(right.key));
  staleExceptions.sort();

  return {
    valid:
      unenforced.length === 0 &&
      undeclaredGuards.length === 0 &&
      staleExceptions.length === 0,
    declaredCount: declared.size,
    enforcedCount: [...declared.keys()].filter((key) => enforced.has(key))
      .length,
    unenforced,
    undeclaredGuards,
    staleExceptions
  };
}
