🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0101-client-asset-budget-splits-by-audience.id.md)

# ADR-0101 — The client asset budget splits by audience

- **Status:** Accepted
- **Date:** 2026-08-20
- **Decision maker:** ahliweb
- **Related:** Issue #590; `scripts/client-asset-budget.ts`; ADR-0070 (awcms-astro carries the public surface); ADR-0083 (the domain root stops being a 404); Issue #552 (per-screen cost lowered instead of raising the ceiling)

## Context

`build:asset-budget:check` has gated one number since 2026-08-05: the byte total of `dist/client`, against a single ceiling. Its stated premise is written into its own failure message — the symptom it exists to prevent arrives as **"the public pages feel slow"**.

Issue #590 asked where 42 kB of growth came from and whether the gate should distinguish assets a public reader downloads from assets only an admin screen loads. Answering it required attribution nobody had done.

### What the measurement found

Attribution came from Astro's own SSR route manifest (`dist/server/entry.mjs`), which maps each route to the assets it links — not from file names, which are misleading here (the largest CSS chunk is named `error-log.*.css` but is the shared `admin.css`).

Measured on `main` @ `05b55b32`, clean build:

| audience                                                    |                                        bytes | assets                                                         |
| ----------------------------------------------------------- | -------------------------------------------: | -------------------------------------------------------------- |
| **Reader** — public content pages                           |                                   **21,415** | `css/public-content.css` (16,800) + `js/news-share.js` (4,615) |
| Anonymous app pages — `/`, five auth pages, theming preview |                                   19,460 CSS | `auth.css`, `index.css`, `_token_.css`, `motion.css`           |
| **Admin** — post-login                                      | **47,157 CSS** plus nearly every page script | 8 CSS files, 40,587 B of them admin-only                       |
| Push service worker                                         |                                        6,245 | `push-sw.js`, registered from the admin console                |

The decisive structural fact: **a public content page loads zero `_astro` assets.** Those pages are not Astro components. `src/pages/blog/`, `[...path].ts`, the feeds and the sitemaps are `.ts` routes emitting their own HTML shell through `blog-content/domain/public-page-rendering.ts`, which links two absolute paths out of `public/`. The only non-admin routes carrying `styles` in the manifest are `/`, the five auth pages, and `/theming/preview/[token]`.

So reader weight is 21,415 B — **11% of a 186,689 B total dominated by admin.**

### Why that makes the single ceiling unfit for its own premise

A budget measures what it can see move. Reader weight could not move it:

```
reader regression of +5,000 B  ->  total 191,689 B  <=  ceiling 192,000 B  ->  PASSES
```

Verified by planting exactly that regression. Five thousand bytes is a **23% increase in what a visitor to an article downloads** — precisely the "public pages feel slow" failure the gate was built for — and the gate waves it through, because 5,000 B is 2.6% of a number that admin dominates.

The converse also holds: admin growth consumes headroom that was nominally protecting readers, so the two surfaces silently compete for one allowance while only one of them is what the premise is about.

### A second defect the same investigation surfaced

`src/lib/security/security-headers.ts` carried the sentence "`public/` holds exactly two files (`js/news-share.js`, `css/public-content.css`)" as part of the reasoning for `Cross-Origin-Resource-Policy: same-origin`. `public/` held **three** — `push-sw.js` was added on 2026-08-10 and no check re-read the claim. The CORP reasoning survives the correction (a same-origin service worker is unaffected), but an enumeration that nothing re-verifies decays, and this one had.

## Decision

**We decided to split the client asset budget into one budget per audience, and to make the classification a gate rather than a comment.**

- `READER_BUDGET_BYTES` = **24,000** — what a visitor to a public article downloads. Measured 21,415 B. Deliberately tight: ~2,585 B of headroom, about one more small script.
- `APP_BUDGET_BYTES` = **172,000** — admin, auth, landing, theming preview. Measured 165,274 B, ~4% headroom. Inherits the old ceiling's job of catching accretion one screen at a time.
- `PER_FILE_BUDGET_BYTES` = 27,000, unchanged.

Classification is **derived, not listed**, wherever structure allows it: everything under `_astro/` is Vite output for `.astro` pages and is therefore `app`, with no list to maintain. `public/` is copied through verbatim and has no such structure, so its files are declared in `PUBLIC_ASSET_AUDIENCE` — and that registry is enforced in both directions:

- a file in the build that no entry declares **fails** the check;
- an entry naming a file the build did not emit **fails** it too.

That is what stops the `security-headers.ts` decay from recurring: the enumeration cannot silently go stale, because the build re-checks it every time.

## Consequences

- **Positive:** reader-facing weight is now measured as its own quantity, so a regression in it fails on its own terms instead of hiding inside an admin-dominated total. The failure message names which surface broke and what to do about it.
- **Positive:** a new file in `public/` cannot enter the build without someone deciding who downloads it. The question "is this reader-facing?" is asked at the moment the answer is known.
- **Negative / trade-off:** the reader budget is tight enough that a legitimate reader-facing feature will need a reviewed raise. That is the intended cost — the raise is the diff where the justification gets written down, exactly as Issue #552 established for the old ceiling.
- **Negative / trade-off:** `TOTAL_BUDGET_BYTES` is gone, so there is no single number to quote. The two surface numbers are printed on every pass instead.
- **Neutral:** the per-file cap (27,000) is above the reader budget (24,000), so on the reader surface the surface budget always fires first and the per-file rule is inert there. This is intended — the tighter rule should be the one that fires — and is asserted by a test so it cannot become an accident nobody noticed.
- **Neutral:** the sum of the two budgets (196,000) exceeds the old single ceiling (192,000). This is not a loosening in any direction that matters: neither surface can spend the other's allowance, which is the entire point.

## Alternatives considered

- **Keep one ceiling, raise or lower it.** Rejected: the measurement shows the number cannot see the thing its premise is about. Lowering it would block the next admin screen for reasons unrelated to readers; raising it would widen the blind spot. The attribution table in Issue #590 found no single culprit to trim — 26 commits of growth, one deliberate −22,700 B recovery, no fat — so there was nothing a re-tuned single number would have fixed.
- **Split by directory (`_astro/` vs everything else).** Rejected as the _whole_ rule: it is right for `_astro/` and wrong for `public/`, which holds both reader assets and the admin-registered `push-sw.js`. Using it alone would count the service worker as reader weight and quietly overstate the tightest budget in the repo.
- **Attribute every asset from the SSR route manifest at check time.** Rejected as too fragile for a gate. It is the right tool for a one-off investigation (it produced the table above), but it depends on the private shape of Astro's build output, which no contract keeps stable — a gate that breaks on an Astro upgrade teaches people to disable gates. The structural `_astro/` rule plus a two-way-enforced registry gets the same answer from facts that do not move.
- **Exclude admin assets from the budget entirely.** Rejected: admin weight is real weight for the editors who use it all day on the connections a regional newsroom has. It needs a budget; it needs its own.
