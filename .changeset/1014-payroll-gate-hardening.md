---
"awcms": patch
---

Harden the payroll guards from #978 (Issue #1014). The CSV-writer scan is now structural (comma-joined cells in a file that also joins lines; every cell must go through `csvCellForWrite`; arrow writers and an unused import no longer pass; exemptions are no longer whole-file). `edge-cache:surfaces:check` tests a surface pattern as a regex against concrete payroll paths and refuses HR URL namespaces, and a reporting projection with a `domain_event` source may not consume a payroll event type. `sensitive-reads:check` refuses a `recordSensitiveRead` call that is not awaited/returned, is chained with `.catch`, or sits in a `try` whose `catch` does not rethrow; `expectAuditFailureYieldsNoData` is the reusable route-test assertion for #957 and #961.
