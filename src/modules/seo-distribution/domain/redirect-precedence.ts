/**
 * Which of the two redirect strategies answers, when both could.
 *
 * Pure and free of I/O on purpose. The rule it encodes was previously
 * expressed only as the ORDER of two `await`s inside a `try` block, which is a
 * shape no test can reach without a database — and so nothing tested it, and it
 * was wrong for as long as it existed. Making the decision a value makes it
 * checkable.
 *
 * ## The rule: most specific wins
 *
 * A tenant-authored rule names ONE exact path and was written on purpose. The
 * retired-`/news` mapping is a blanket prefix rewrite standing in for routes
 * this repo removed. When both claim a path, the deliberate instruction is the
 * right answer.
 *
 * ## What the old order cost
 *
 * The retired handler answered first. Since it claims EVERY `/news/**` path,
 * and the legacy archive Issue #599 migrates has URLs shaped
 * `/news/{legacyId}_{slug}.html`, every exact rule written by
 * `blog:legacy:redirects:import` was unreachable — 23,906 of them — and each of
 * those URLs was instead 301'd to `/blog/{tenantCode}/{legacyId}_{slug}.html`,
 * which no post answers. A redirect into a 404, which is what #599's Definition
 * of Done exists to forbid.
 *
 * ## Why the fallback must return the host-based result, not a fresh value
 *
 * Strategy 2's `passthrough` carries the 404-capture context that feeds
 * not-found telemetry. Falling back to a bare `{ kind: "passthrough", capture:
 * null }` would silently retire that telemetry for the whole `/news` family,
 * which is the sort of loss that shows up as an empty dashboard nobody can date.
 */
import type { RedirectStatusCode } from "./redirect-rule";

/** Structurally identical to the service's `RedirectResolution`, kept local so this stays I/O-free. */
export type RedirectOutcome =
  | { kind: "redirect"; status: RedirectStatusCode; location: string }
  | { kind: "passthrough"; capture: unknown }
  | { kind: "skip" };

/**
 * Pick the answer.
 *
 * `retired` is `null` when the path is not in the retired family at all, which
 * is every path except `/news/**` — outside that family this function always
 * returns `hostBased` unchanged, so the precedence is unobservable there.
 */
export function chooseRedirectOutcome<
  H extends RedirectOutcome,
  R extends RedirectOutcome
>(hostBased: H, retired: R | null): H | R {
  if (hostBased.kind === "redirect") return hostBased;
  if (retired !== null && retired.kind === "redirect") return retired;
  return hostBased;
}
