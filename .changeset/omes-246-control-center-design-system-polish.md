---
"awcms": patch
---

fix(control-center): polish the OMES design system — forms, multi-value tiles, lifecycle strip, panel edges (ahliweb/omes#246, part 1b)

Fixes 5 defects a screenshot review of part 1 (`ahliweb/omes#246` part 1/3, PR #829) found across the same 9 `/admin/omes/*` screens:

1. **Multi-value tiles** (server health distribution, job state summary, backup freshness, deployment drift on the overview screen) rendered every part through the 32px mono `.stat-value` style meant for a single number, wrapping onto 2-3 lines at 1440px and worse below it. They now render as `.omes-stat-breakdown`, a compact wrapping list of value+label chips.
2. **Form controls** on all 8 filter/create forms used a bare `.admin-toolbar` with unstyled sibling `<label>`/`<input>` markup — flat grey inputs, the native light `<select>` popup, labels detached from their controls. They now use `.admin-create-form`, the same vocabulary ~18 other admin list screens already use, which already consumes the tokens `.omes-cc` overrides — no new color pairing.
3. **Lifecycle strip** `→` separators orphaned at the start of a wrapped line below 1440px. Each pill + its trailing arrow is now one atomic flex item, so the pair always wraps together.
4. **Panel edge/gutter at 1440px** — a `clamp()` sign error and a percentage-height/padding miscalculation in `.omes-cc`'s negative-margin bleed left a light-canvas strip on the panel's right edge and bottom on wide/short screens. Both fixed.
5. **Sidebar clipping at 1440px**, raised by the same review, is architecturally unrelated to `.omes-cc` (a sibling subtree; CSS custom properties don't cascade to it) and could not be reproduced through normal interaction against either this branch or the commit before part 1 — filed as its own `ahliweb/awcms` issue rather than fixed or guessed at here.

`APP_BUDGET_BYTES` rises 229,500 → 230,400 B (measured +1,109 B after trimming). New contrast pairs: none — every color used is already in the table in `src/modules/omes-control/README.md`/`.id.md`, which now also documents this fix.
