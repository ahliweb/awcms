🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](lessons-learned.id.md)

# Lessons learned

Hard-won operating lessons that are easy to forget and expensive to
re-learn — each one point to where the fuller account lives. Add to this list
only when a mistake has actually happened and been fixed; do not pre-write
hypothetical lessons.

- **"Run it, don't read it."** A script or gate that was never executed
  against a real defect is not proven. See
  [`../../docs/PROJECT_STATE.md`](../../docs/PROJECT_STATE.md) for the pattern
  and repeated incidents; `tests/graph-artifacts-check.test.ts` and
  `tests/knowledge-obsidian-sync.test.ts` both follow it — each rule is fed
  the actual broken input and required to go red, not merely proven green on
  a healthy tree.
- **The graph mixes "was once true" with "is true now."** See
  [`../../docs/awcms/knowledge-graph.md`](../../docs/awcms/knowledge-graph.md)
  §"Two ways to misread it".
- **Low cohesion on a deliberate chokepoint is not design debt.** Same
  document, §2.
- **A gate that reads only the English half of a bilingual pair misses the
  mirror going stale.** [`../../docs/PROJECT_STATE.md`](../../docs/PROJECT_STATE.md)
  §4, "the audit #727 asked for found something bigger than #727".
- **`graphify install` overwrites local skill patches on upgrade.** Back up
  and re-apply — this is why this repo does not commit a project-scoped
  Graphify skill (see `docs/awcms/knowledge-graph.md` §Baseline).
