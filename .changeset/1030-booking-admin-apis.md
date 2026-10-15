---
"awcms": minor
---

feat(booking): admin APIs for resources, units, pools, offerings and the policy (#1030, prerequisite of the #942 admin screens). `GET/POST /api/v1/booking/resources`, `GET/PATCH/DELETE /resources/{id}` and `POST /resources/{id}/restore` (a resource with its units, `poolId` as the pool membership, capacity that only grows, unit relabel and deactivate); the same set for `/resource-pools` and `/offerings`; `GET` and `PUT /api/v1/booking/policy` (replaces the whole policy, `null` is the module default, audited `critical`). Every write takes `Idempotency-Key` with replay and runs under a savepoint; the database guards reach the caller as named 409s (`BOOKING_MODE_IN_USE`, `TIMEZONE_IN_USE`, `SCHEDULE_TIMEZONE_MISMATCH`, `CODE_TAKEN`), delete is soft and refused while the resource is in use (`RESOURCE_IN_USE`, `POOL_NOT_EMPTY`), and soft-deleted rows need `.restore` as well. No migration. New audit events `booking.pool.*` and `booking.offering.restored`.
