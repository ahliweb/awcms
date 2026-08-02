---
"awcms": patch
---

Correct a stale claim: `idn-admin-regions` is not screenless, so ADR-0021's criterion 1 has **zero** exceptions rather than one.

`docs/PROJECT_STATE.md` §4 listed `idn-admin-regions` as "deliberately without a screen, see ADR-0052", the contract test added with `/admin/media` carried a matching carve-out, and PR #345's own body repeated it as fact. All three were wrong: `/admin/idn-regions` landed in #332.

ADR-0052 moved that module's dataset **lifecycle** to operator jobs — not the whole module — and the two read permissions it kept are exactly what that screen drives. Verified against the code rather than the documents: `grep -L 'navigation:' src/modules/*/module.ts` now returns nothing at all.

The carve-out also failed in the other direction. With `idn_admin_regions` excused, that module could have **lost** its screen and the test would still have passed — an exception written for a module that did not need one, protecting it from the check it was supposed to be under. The assertion is now a plain `toEqual([])`, mutation-proven by removing `idn-admin-regions`' navigation entry.
