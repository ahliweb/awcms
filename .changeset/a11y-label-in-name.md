---
"awcms": patch
---

Admin topbar: the brand link, theme toggle and account link now take their accessible name from content instead of an `aria-label` that omitted their visible text (WCAG 2.5.3 Label in Name, flagged by axe-core 4.14's `label-content-name-mismatch`). The theme toggle's name now always states the active mode, replacing `aria-description`.
