---
"awcms": patch
---

Test-only: the `hr_workforce` attendance `Idempotency-Key` replay integration test now builds one request body and posts it twice. Two separate `clock()` calls each defaulted `occurredAt` to a second-precision timestamp, so under load the two posts could straddle a second, hash differently, and correctly return `409 IDEMPOTENCY_CONFLICT` where the test expected a replay. No production behaviour changes.
