---
"awcms": patch
---

feat(payroll-boundary): add `NON_PAYROLL_LOOKALIKE_EXCEPTIONS`, an exact-name, reasoned registry that lets one relation skip the catalog layer's `payroll-lookalike` column-overlap comparison (Issue #1354). Entries are exact lower-case `schema.table` names with a reason of at least 20 characters, validated at import (no wildcard, no malformed name, no payroll-family table); an excepted table stays subject to every other rule and a copy under another name is still flagged. Empty by default, so there is no behaviour change; documented in `docs/awcms/hr-payroll.md` section 13.3 (EN and ID) with the security-review requirement for entries.
