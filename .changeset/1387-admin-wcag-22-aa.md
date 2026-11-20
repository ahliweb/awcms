---
"awcms": patch
---

test(a11y): the admin accessibility target rises from WCAG 2.1 AA to 2.2 AA (Issue #1387). The `wcag22aa` axe tag is added to the three admin axe specs (`a11y-axe`, `admin-booking`, `admin-channel-accounts`), which brings axe's `target-size` rule; `docs/awcms/14_ui_ux_design_system.md` lists the criteria WCAG 2.2 adds and how each is checked (only `target-size` is automated, the rest is manual review). No runtime or UI change. A local run of the `a11y-axe` spec against the seeded tenant found no new violations.
