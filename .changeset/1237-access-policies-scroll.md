---
"awcms": patch
---

fix(admin/access-policies): the policy table no longer scrolls the whole page sideways at 360px and 640px once the tenant has stored a policy (Issue #1237). `/admin/access-policies` rendered its `<table class="admin-table">` with no scroll wrapper; it now sits in a focusable, named `.data-table-scroll` region, as on `/admin/roles`, so a wide table scrolls inside its own card (`scrollWidth` was 643px at 360px and 646px at 640px with one row).

The `responsive-360` sweep now seeds one inert policy row before it measures (a flat, disabled, non-DSL-managed row written straight to the database, which the evaluator never loads), so a fresh CI database reproduces the overflow instead of walking an empty page. A source-level contract test also pins the wrapper without needing a browser or a database. No behaviour change otherwise; the message texts are unchanged.
