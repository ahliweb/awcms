🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0062-skills-are-gated-against-the-code-they-describe.id.md)

# ADR-0062 — Skills are gated against the code they describe

- **Status:** Accepted
- **Date:** 2026-08-04
- **Decision maker:** @ahliweb
- **Related:** [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md) (development only in `awcms` + `awcms-astro`; mini/micro become archives), [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md) (derived pathway removed), [ADR-0058](0058-unenforced-permissions-disposition.md) (precedent: a reasoned exception list as an artifact), [ADR-0057](0057-blog-page-lifecycle.md) §F (precedent: a coverage gate that needed three rewrites)

## Context

### 1. The numbers that forced this decision

`.claude/skills/` holds 55 skills. At the time this ADR was written:

- **Eleven consecutive ADRs — 0051 through 0061 — landed without ONE skill
  mentioning them.** Not some: zero.
- **Four skills for LIVE modules point at `src/lib/<module>/…`** for files that
  actually live in `src/modules/<module>/presentation/…`
  (`seo_distribution` ×3, `comments`, `theming`). The files moved; the skills did
  not.
- **Several announce an admin screen as "NOT ported" months after the screen
  landed** — `awcms-blog-content` states there is no blog admin UI when there are
  four screens, `awcms-media-library` states `/admin/media` has not been ported
  when PR #345 built it.
- **Six skills still teach the mini-first flow** that ADR-0055 revoked two days
  earlier, including one skill that is ENTIRELY a port procedure.

### 2. Why a stale skill is more dangerous than a stale document

A document is read by a human who can doubt it. **A skill is FOLLOWED.** And its
direction of ageing is the opposite of ordinary correction: the statement "this
module does not exist in this repo yet" starts out true, then the module gets
built, and the sentence ages into a confident lie. An agent reading it rebuilds
something that already exists — or, worse since ADR-0055, takes it from an
archive that no longer moves.

This repo has already recorded that pattern as a class: a check that answers
wrongly does not stop at one wrong report, **it breeds documents** (ADR-0058 §1:
two false scanner accusations were briefly written up as reasoned DECISIONS that
the routes refute line by line; ADR-0059: a guess was written up as a finding and
then copied into `PROJECT_STATE.md` as a decision).

### 3. Why the exemption used to be right, and why it no longer is

`docs/awcms/` and `.claude/skills/` were deliberately OUTSIDE `check:docs`. The
reason was valid when it was written: both held `awcms-mini` adaptation notes
that legitimately name tooling that does not exist here.

ADR-0055 revokes that reason **for skills**. Once mini/micro became archives and
capabilities are BUILT here, a skill that reads as port instructions is no longer
merely outdated — it directs work at a repo that no longer moves. `docs/awcms/`
stays outside this gate: its contents really are a mixture of history and
specification, and it is not executed as instructions.

## Decision

`bun run skills:check` (`scripts/skills-check.ts`) joins the `bun run check`
chain. Pure — no database, no network, no git — and it **does not read intent**:
prose cannot be gated, so every rule leans on the module registry, the same
authority `modules:*:check` uses.

**Rule 1 — a skill for a LIVE module describes LIVE code.** If the subject
`awcms-<x>` exists in `listModules()`, every `src/…` path it quotes must exist.
**No exception list**, deliberately: a skill for code that has already shipped
has no reason to name a file that does not exist. This is what caught all four
`src/lib/<module>/` misdirections.

**Rule 2 — every ADR cited exists.** `ADR-0042` must resolve to
`docs/adr/0042-*.md`. A reference to an ADR that was never written is a citation
its reader cannot check either.

**Rule 3 — a skill for code that does NOT exist must say so, with a reason.**
Target-specification and historical skills are legitimate: `awcms-social-publishing`
describes a module worth building, `awcms-news-portal` records a module that was
merged away. Both may quote paths that do not exist — but only from
`ASPIRATIONAL_SKILLS`, where each entry declares itself `target-spec`,
`historical`, or `cross-cutting` **and why**.

That list is deliberately per-SKILL, not per-PATH. A path list would grow every
time a target specification is edited and then stop being read; a skill list only
changes when a skill changes its NATURE — exactly when someone does need to look.

**Rule 4 — a command you are told to run must exist.** Every `bun run <target>`
in a skill must exist in `package.json` OR be listed in `scripts/README.md`
§Deferred. This rule is **deliberately narrow**: §Deferred explicitly ALLOWS a
skill to name a reference target that has not been built yet, so this gate does
not litigate that policy — it only catches targets that are neither. Today that
is exactly two, and one of them tells its reader to run
`github:snapshot:refresh`, which never existed, while the actual mechanism is the
`gh` CLI on the same page.

This is the same class `check:docs` already catches in code comments: six
comments in `src/modules/module-management/` tell you to run `modules:sync`, a
command that never existed here. That was already fixed in `src/` — and the skill
for the SAME module still names it, because skills sit outside every gate.

### Dead entries fail too

There are two ways an `ASPIRATIONAL_SKILLS` entry becomes meaningless, and the
second is the one that will actually happen: **the module gets BUILT**, rule 1
starts governing it, and its entry silently stops meaning anything while still
reading as a decision. The gate reports both. Three entries were dead the moment
they were written (`awcms-blog-content`, `awcms-form-drafts`,
`awcms-profile-identity`) and were removed immediately — proof that the check is
not hypothetical.

## Consequences

**What we get.** The defect class "a skill claims the code does not exist when it
does" turns red in CI, instead of being found next month by an agent that has
already followed it. 55 skills are now consistent with the registry; 10 wrong
paths were fixed; six skills teaching the pathway ADR-0055 revoked have been
reframed as "build it here with an admission ADR".

**What it costs.** Editing a skill can now turn CI red, and that is the point.
One side effect worth knowing: the body of many skills carries the awcms-mini
specification verbatim, with paths belonging to the SOURCE repo. Those paths must
now be written as belonging to the source (`awcms-mini:src/…`) instead of
`src/…`, because writing them as if they were this repo's paths is exactly the
mistake being gated.

**What this does NOT do.** This gate does not demand that every ADR be referenced
by some skill. Demanding that would produce ceremonial references added to turn
CI green — the "ceremony that looks like coverage" form that
`edge-cache:surfaces:check` already rejected for purging modules without a
surface. The 0-of-11 figure in §1 is the SYMPTOM that triggered this ADR, not the
thing being gated; what is gated is the checkable claim.

Zero migrations, zero permissions, zero OpenAPI changes, zero runtime changes —
not one file in `src/` changes its behaviour.
