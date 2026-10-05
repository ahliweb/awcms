---
"awcms": patch
---

fix(a11y): every admin `.data-table-scroll` table wrapper is now a keyboard-focusable, named region (`tabindex="0"`, `role="region"`, `aria-labelledby`/`aria-label`) with a visible focus ring, so keyboard users can scroll wide tables (WCAG 2.1.1, axe `scrollable-region-focusable`). A new contract test fails CI when a wrapper lacks any of them (#907).
