---
"awcms": patch
---

Claim queue rows through a `WITH due AS MATERIALIZED (...)` CTE in the email, push and WhatsApp dispatchers, so `LIMIT n` is honoured (Issue #1007). The previous `UPDATE ... WHERE id IN (SELECT ... LIMIT n FOR UPDATE SKIP LOCKED)` shape could claim more than `n` rows on stale statistics for a near-empty queue, because the planner re-ran the locked subquery per outer row. Claim predicates, ordering, RETURNING columns and tenant scoping are unchanged.
