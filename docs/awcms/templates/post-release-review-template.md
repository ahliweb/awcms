🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](post-release-review-template.id.md)

# Post-release review — v<X.Y.Z>

- **Tag:** `v<X.Y.Z>` · **Deployed:** `<date>` · **Written:** `<date>`
- **Author:** `<name>`

## What went in

One paragraph, not a changeset list. What a reader six months from now is
looking for is the **shape** of this release: foundation change, feature
addition, or fix.

## What happened when it met production

- Deploy: smooth / troubled — and if troubled, what failed.
- Migration: how long, and whether anything locked something up.
- Production validation (step 17): what was checked, what was found.
- What showed up in production for the first time and did **not** show up in CI.

That last line is the most valuable one. ADR-0083 accepts that this repo has no
staging, and **the price of that decision is paid exactly on this line** —
collecting it release after release is the only way to know whether the price is
still worth it.

## Surprises

Anything that did not match expectations, including the pleasant ones. "None"
is a legitimate answer and must be written down.

## What changed because of it

Concrete changes: a new gate, a runbook step, a corrected document, or an issue
opened. **If there is none, say there is none** — a review that always produces
an action is a review that invents actions.

Recommendations that change the direction of the work still get written to
`PROJECT_STATE.md` §4; here the link is enough.
