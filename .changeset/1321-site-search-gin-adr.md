---
"awcms": patch
---

docs(site_search): Proposed ADR-0165 for Issue #1321 (public search cannot use its GIN index under FORCE RLS). Records measured plans (13 to 24 ms status quo, 0.8 ms SECURITY DEFINER read function, 7.7 ms LEAKPROOF, which is rejected) and the security analysis; no query shape fixes it without a boundary change. No code, schema or behaviour change; the existing plan-pinning test stays. Awaiting the owner's decision.
