---
"awcms": minor
---

`.claude/skills/` is gated against the code it describes (ADR-0062).

`bun run skills:check` joins the `check` chain. The exemption it retires was
justified when written — skills carried awcms-mini adaptation notes that
legitimately named absent tooling — but ADR-0055 removed that justification:
once mini/micro became archives, a skill that reads as a porting instruction
points work at a repo that does not move.

What the exemption cost, measured when the gate was written: eleven consecutive
ADRs (0051–0061) landed with **zero** skills referencing any of them; four
skills for live modules pointed at `src/lib/<module>/…` for files that now live
at `src/modules/<module>/presentation/…`; several announced admin screens as
un-ported months after those screens shipped; and six still taught the
mini-first pathway two days after it was retired.

Stale skills decay in the dangerous direction. A stale doc makes a reader pause;
a skill is followed. "This module is not in this repo" starts out true, the
module gets built, and the sentence ages into a confident falsehood.

Three rules, none of which read intent — each keys off the module registry:

1. A live module's skill must cite `src/…` paths that exist. No exception list:
   a skill for shipped code has no reason to name a file that is not there.
2. Every cited `ADR-NNNN` must resolve to a file in `docs/adr/`.
3. A skill for code that does not exist must be listed in `ASPIRATIONAL_SKILLS`
   as `target-spec`, `historical` or `cross-cutting`, with its reason. Dead
   entries — where the module has since been built — are reported too.

All 55 skills were brought into line: 10 wrong paths fixed, the six mini-first
skills reframed as "build here with an admission ADR", and the edge-cache,
media-library, blog-content and seo-distribution skills corrected against what
actually shipped.

Zero migrations, zero permissions, zero runtime change — no file under `src/`
changes behaviour.
