/**
 * admin-screen-coverage-check.ts — `bun run admin:screen-coverage:check`.
 *
 * Every declared permission is claimed by an admin screen, or is a written
 * decision, or sits on a ledger that may only shrink. Pure: registry + source
 * text, no database, no network.
 *
 * ## The gap this closes
 *
 * [ADR-0051](../docs/adr/0051-admin-screens-consolidated-in-awcms.md) decided
 * every SYSTEM admin screen belongs in this repo, and then nothing measured
 * compliance. The checks that look adjacent answer different questions:
 *
 * - `access:permissions:enforcement:check` — "does this permission have an
 *   ENFORCER?" A route counts. A `curl`-only surface passes it forever.
 * - `tests/admin-navigation-registry.test.ts` — "does every `navigation` entry
 *   point at a page, and vice versa?" A module with no `navigation` has nothing
 *   to check.
 * - per-screen contract tests — "does THIS screen gate the right keys?" They
 *   cannot see a permission no screen mentions.
 *
 * So "usable only via `curl`" was found by hand, repeatedly, and each time it
 * was found it was found late. One mechanical scan surfaces it in a second.
 *
 * ## What this gate does NOT answer
 *
 * It asks whether a screen CLAIMS a permission — never whether the control is
 * correct. `/admin/blog`'s Restore button claimed `posts.restore` while being
 * rendered on rows that could only 404 (#351); this gate would have said
 * "covered" throughout. Correctness is the per-screen contract test's job, and
 * the two answer different questions on purpose.
 *
 * ## Why the matcher resolves file-local helpers
 *
 * A matcher keyed on literal `permissionKey("mod","activity","action")` triples
 * alone reports `blog_content`'s templates/menus/widgets/theme as unclaimed:
 * `blog-presentation.astro` binds `const can = (activity, action) =>
 * ssr.permissions.has(permissionKey("blog_content", activity, action))` and
 * calls it eight times with literals. Reporting a claimed permission as
 * unclaimed is the failure mode that has already cost this repo four rewrites of
 * `permission-enforcement-check.ts` and two exception entries written up as
 * decisions — a scanner that answers "uncovered" for something covered trains
 * its readers to widen the exception list until it asks nothing.
 *
 * Resolution is therefore FILE-FIRST and deliberately narrow: a helper counts
 * only when its body binds the module key as a LITERAL and forwards its own two
 * parameters. Anything else is left unresolved rather than guessed at.
 */
import { listModules } from "../src/modules";

const SCREEN_GLOB = "src/pages/admin/**/*.astro";

/**
 * Permissions with NO screen, on purpose, with the reason. A register of
 * DECISIONS — the same shape `permission-enforcement-check.ts` uses, and for the
 * same reason: an entry here is the visible act of saying "an operator should
 * not drive this from a page", and the next reader can disagree with a sentence
 * rather than with silence.
 */
export const DELIBERATELY_UNSCREENED: Readonly<Record<string, string>> = {
  // Authoring a condition DSL needs a real editor, and the same objection the
  // six `workflow.definition.*` entries below record applies with more force
  // here: a malformed workflow graph is a bad diagram, a malformed ACCESS
  // policy is an authorization rule. A JSON textarea that accepts one until
  // `POST /api/v1/access/policies` rejects it is a worse affordance than none.
  //
  // `read` and `analyze` ARE screened — `/admin/access-policies` lists the
  // evaluated policy set and simulates a decision against it. This entry is
  // about the write half only, and it is a DECISION rather than a backlog
  // item: the surface stays API-and-script until someone builds an editor
  // worth trusting with a deny rule.
  "identity_access.abac_policies.configure":
    "no condition-DSL editor; /admin/access-policies covers read + simulate",

  // Six permissions, one decision: authoring a node/transition graph needs a
  // real editor, and a JSON textarea that accepts a malformed graph until
  // `publish` rejects it is a worse affordance than none.
  // `tests/admin-approvals-page-contract.test.ts` pins them OUT of that screen.
  "workflow.definition.read":
    "no graph editor; see /admin/approvals contract test",
  "workflow.definition.create":
    "no graph editor; see /admin/approvals contract test",
  "workflow.definition.update":
    "no graph editor; see /admin/approvals contract test",
  "workflow.definition.publish":
    "no graph editor; see /admin/approvals contract test",
  "workflow.definition.retire":
    "no graph editor; see /admin/approvals contract test",
  "workflow.definition.delete":
    "no graph editor; see /admin/approvals contract test",

  // Upload is a three-step browser flow (create -> PUT to R2 -> verify).
  //
  // `media_library.media.create` USED to sit here, on the objection that "a
  // button that STARTS a session but cannot finish it leaves a `pending_upload`
  // row on every misclick". Issue #595 built the flow that finishes, and every
  // failure path cancels the session it created — so the objection stopped
  // applying and the entry was removed rather than left to read as a reviewed
  // judgement about code that had moved on.
  //
  // The other two stay: `cancel` is driven by the uploader's own failure
  // handling rather than by an operator clicking it, and nothing screens
  // verification.
  "media_library.media.verify":
    "three-step upload; finalisation belongs to the uploading client",
  "media_library.media.cancel":
    "three-step upload; only the uploading client knows what to cancel",

  // `media_library.enforcement.read`/`.enable` USED to sit here, on the
  // reasoning that a one-way tenant posture switch "belongs with the other
  // posture switches on /admin/security, not in an object console". Finding D8:
  // that sentence describes a RELOCATION THAT NEVER HAPPENED. `/admin/security`
  // carries the MFA enforcement level and nothing about media at all, so the
  // entry recorded a screen that does not implement it as a settled judgement —
  // and a decision is exempt from the shrink-only ledger, so the surface stopped
  // being counted as work not done. Moved to `NOT_YET_SCREENED`; the reasoning
  // about WHERE it belongs survives there, as a note about the screen to build.

  // The admin post list has its own search, which tolerates an empty query;
  // the public search endpoint does not, and wiring the screen to it would make
  // the empty state an error.
  "blog_content.search.read":
    "the admin list has its own search; the public endpoint rejects an empty query",

  // ADR-0044 §4 closed the free-URL advertisement write path (410 Gone);
  // `ad_placements` supersedes it. A screen for a permission whose endpoints
  // answer 410 would be a control that cannot work.
  "blog_content.ads.read":
    "free-URL ad path retired by ADR-0044; endpoints answer 410",
  "blog_content.ads.configure":
    "free-URL ad path retired by ADR-0044; endpoints answer 410",

  // Enqueues a notification to an explicit set of users — plausible as an
  // inter-module API, and forcing a button onto it invents an affordance whose
  // correct shape nobody has decided.
  "email.notification.create": "inter-module API, not an operator affordance",

  // The lookup surface other modules' forms consume, not a page of its own.
  // `/admin/idn-regions` drives `dataset.read`/`dataset.configure` instead.
  "idn_admin_regions.region.read":
    "lookup API for other modules' forms; /admin/idn-regions drives dataset.*"
};

export type Coverage = {
  claimed: ReadonlySet<string>;
  declared: readonly string[];
};

/**
 * Permission keys an admin screen gates on.
 *
 * Two spellings, both required — see this file's header for why the second
 * exists and why it is narrow.
 */
export function extractScreenClaims(source: string): Set<string> {
  const claims = new Set<string>();

  for (const match of source.matchAll(
    /permissionKey\(\s*"([a-z_]+)"\s*,\s*"([a-z_]+)"\s*,\s*"([a-z_]+)"\s*\)/g
  )) {
    claims.add(`${match[1]}.${match[2]}.${match[3]}`);
  }

  // Issue #450 — a screen routed through `loadAdminScreen` states its guard as
  // an `AccessRequest` object literal, the same shape the routes use, in both
  // `authorize:` and the `can({...})` calls that decide its affordances.
  //
  // Without this the migration would collapse 133 permission claims one screen
  // at a time and turn `admin:screen-coverage:check` red for the wrong reason:
  // it would report a missing SCREEN for a permission whose screen exists and
  // now gates on it more strictly than before.
  for (const match of source.matchAll(
    /moduleKey:\s*"([a-z_]+)"\s*,\s*activityCode:\s*"([a-z_]+)"\s*,\s*(?:\/\/[^\n]*\n\s*)*action:\s*"([a-z_]+)"/g
  )) {
    claims.add(`${match[1]}.${match[2]}.${match[3]}`);
  }

  for (const helper of source.matchAll(
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*\(\s*([A-Za-z_$][\w$]*)\s*(?::[^,)]+)?,\s*([A-Za-z_$][\w$]*)\s*(?::[^,)]+)?\)[^=]*=>[\s\S]{0,200}?permissionKey\(\s*"([a-z_]+)"\s*,\s*\2\s*,\s*\3\s*\)/g
  )) {
    const name = helper[1]!;
    const moduleKey = helper[4]!;

    for (const call of source.matchAll(
      new RegExp(`\\b${name}\\(\\s*"([a-z_]+)"\\s*,\\s*"([a-z_]+)"\\s*\\)`, "g")
    )) {
      claims.add(`${moduleKey}.${call[1]}.${call[2]}`);
    }
  }

  return claims;
}

export type CoverageProblem = string;

/**
 * The rule, over an injected snapshot so a test can drive it with a planted
 * gap instead of the live registry.
 */
export function evaluateScreenCoverage(
  coverage: Coverage,
  decisions: Readonly<Record<string, string>>,
  ledger: readonly string[]
): CoverageProblem[] {
  const problems: CoverageProblem[] = [];
  const ledgerSet = new Set(ledger);

  for (const key of coverage.declared) {
    if (coverage.claimed.has(key)) continue;
    if (key in decisions || ledgerSet.has(key)) continue;

    problems.push(
      `"${key}" is declared but no admin screen claims it. Give it a screen, ` +
        "add it to DELIBERATELY_UNSCREENED with the reason an operator should " +
        "not drive it from a page, or — if it is simply not built yet — to " +
        "NOT_YET_SCREENED, which may only shrink."
    );
  }

  // A claim for a permission nobody declares is a screen gating on a key no
  // role can hold: the control is invisible to everyone, forever.
  for (const key of coverage.claimed) {
    if (!coverage.declared.includes(key)) {
      problems.push(
        `A screen gates on "${key}", which no module declares. No role can ` +
          "hold it, so the control it guards can never appear."
      );
    }
  }

  for (const [key, reason] of Object.entries(decisions)) {
    if (coverage.claimed.has(key)) {
      problems.push(
        `"${key}" is listed as deliberately unscreened ("${reason}") but a ` +
          "screen now claims it. Remove the entry — a stale decision reads as " +
          "reviewed judgement about code that moved on."
      );
    }

    if (ledgerSet.has(key)) {
      problems.push(
        `"${key}" is in BOTH registers. A permission is either a decision or ` +
          "unfinished work, never both."
      );
    }
  }

  for (const key of ledger) {
    if (coverage.claimed.has(key)) {
      problems.push(
        `"${key}" is on NOT_YET_SCREENED but a screen now claims it. Delete ` +
          "the line: the ledger only ever shrinks, and that is the only thing " +
          "that makes its length mean something."
      );
    }

    if (!coverage.declared.includes(key)) {
      problems.push(
        `"${key}" is on NOT_YET_SCREENED but no module declares it any more. ` +
          "Delete the line."
      );
    }
  }

  return problems;
}

export async function collectCoverage(): Promise<
  Coverage & { screens: string[] }
> {
  const screens: string[] = [];

  for await (const file of new Bun.Glob(SCREEN_GLOB).scan({
    cwd: process.cwd()
  })) {
    screens.push(file);
  }

  const claimed = new Set<string>();

  for (const screen of screens.sort()) {
    for (const key of extractScreenClaims(await Bun.file(screen).text())) {
      claimed.add(key);
    }
  }

  const declared = listModules().flatMap((module) =>
    (module.permissions ?? []).map(
      (permission) =>
        `${module.key}.${permission.activityCode}.${permission.action}`
    )
  );

  return { claimed, declared, screens };
}

async function main(): Promise<void> {
  const { claimed, declared, screens } = await collectCoverage();
  const problems: string[] = [];

  // A corpus that resolved to nothing would make every rule pass vacuously.
  if (screens.length === 0) {
    problems.push(
      `No admin screen matched \`${SCREEN_GLOB}\` — the check would pass vacuously.`
    );
  }

  const { NOT_YET_SCREENED } = await import("./admin-screen-coverage-ledger");

  problems.push(
    ...evaluateScreenCoverage(
      { claimed, declared },
      DELIBERATELY_UNSCREENED,
      NOT_YET_SCREENED
    )
  );

  if (problems.length > 0) {
    console.error("admin:screen-coverage:check FAILED");

    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }

    process.exitCode = 1;
    return;
  }

  console.log(
    `admin:screen-coverage:check OK — ${screens.length} screens claim ` +
      `${claimed.size} of ${declared.length} declared permissions; ` +
      `${Object.keys(DELIBERATELY_UNSCREENED).length} deliberate, ` +
      `${NOT_YET_SCREENED.length} awaiting a screen.`
  );
}

if (import.meta.main) {
  await main();
}
