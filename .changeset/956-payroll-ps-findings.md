---
"awcms": patch
---

Write the three blocking payroll review findings into the phase 3 design (Issue #956, Refs #957): PS-01 (the payee is never the actor; trigger and handler guard, SOD23 and SOD24), PS-02 (reversal gets its own calculate/approve chain with R x C and R x A per-instance rules, and reversing a paid run posts a recovery line so the replacement run pays only the delta; SOD25 to SOD27) and PS-03 (`calculation_revision` and `totals_digest` written by the database; approve and finalize are refused with 409 on a stale revision; SOD28 and SOD29). Updates `hr-payroll.md` sections 7.4, 7.5, 9 and 12 and adds a status table (17.5), with the Indonesian mirror, and records the PS-02 decision as ADR-0136 Amendment A1 with status Proposed, pending maintainer acceptance and counsel's answer to L-C3. This does not complete the legal review: section 17.4 stays blank and #957 stays blocked. Documentation only; no migration, route, permission or code.
