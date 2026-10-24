/**
 * Held-back register for `bun run deps:freshness` (Issue #1173).
 *
 * A version that is deliberately NOT taken although a newer one exists. Without
 * a register the only trace of such a decision is a reviewer's memory, and the
 * next person to run `bun outdated` re-discovers the drift, "fixes" it, and
 * finds out why it was held on a Friday. With one, the decision has a reason, an
 * owner and a date, and it stops being true on its own:
 *
 * - `reviewDate` passes -> `tests/dependency-held-back.test.ts` fails until the
 *   entry is re-justified (new date) or removed. This is the same rule the
 *   audit-exception list (`dependency-audit-exceptions.ts`) lives under, with
 *   one difference: that list expires by MATCHING (an exception that matches no
 *   advisory is stale), this one expires by CLOCK as well, because a hold has no
 *   advisory to match — "we are waiting for X" never fails by itself.
 * - The hold stops being behind (`heldVersion` >= the registry's latest) ->
 *   `deps:freshness` reports it as stale so the entry is removed rather than left
 *   as a record of something that is no longer true.
 *
 * ## What belongs here, and what does not
 *
 * IN: a direct dependency, runtime or image whose newer version was evaluated
 * and rejected or postponed, with the reason it is not safe NOW.
 *
 * OUT: drift nobody has looked at yet. `astro 7.4.0 -> 7.4.2` showing up in
 * `bun outdated` is a backlog item for the next atomic upgrade PR, not a hold;
 * registering it would turn the register into a second `bun outdated` that is
 * out of date the day after. A security advisory that cannot be fixed goes in
 * `dependency-audit-exceptions.ts`, not here.
 *
 * Empty is a fine state. It is not the target the way it is for the audit
 * exceptions, because "we looked and we are staying" is sometimes the right
 * answer, but every entry has to keep earning its place.
 */
export type HeldBackEntry = {
  /**
   * What is held, exactly as the registry or `bun outdated` names it. The
   * pseudo-package `bun` stands for the Bun runtime (`npm view bun`).
   */
  packageName: string;
  /** The version (or floor) we stay on. */
  heldVersion: string;
  /**
   * Why the newer version is not safe NOW — what was found, not "risk". A hold
   * with a vague reason cannot be re-evaluated; the reviewer has to redo it.
   */
  reason: string;
  /** Who decided, and who re-justifies it. */
  owner: string;
  /** ISO date (YYYY-MM-DD). Re-justify by then or remove. */
  reviewDate: string;
};

export const HELD_BACK: readonly HeldBackEntry[] = [
  {
    packageName: "bun",
    heldVersion: "1.3.0",
    reason:
      "The `engines.bun` floor and the CI `minimum-supported` cell stay at Bun 1.3.0 while the pin " +
      "(package.json `packageManager`, `setup-bun`, Dockerfile.production, cron runner image) moves to " +
      "the current release. Moving the floor changes what the template promises to consumers and what " +
      "the family-compatibility manifest declares, so it is a support-contract decision under " +
      "ADR-0032, not a side effect of a pin bump (stated in the #1172 / #1176 pin-bump changeset). " +
      "The held version here is the FLOOR, not the pin.",
    owner: "ahliweb",
    reviewDate: "2027-01-24"
  }
];
