---
"awcms": minor
---

Add the `booking` module foundation: generic resources, capacity units, schedules and reservations (Issue #937, ADR-0131 as amended by ADR-0135).

- **Schema only, no behaviour yet.** `sql/180` adds eleven `awcms_booking_*` tables (settings, resource pools, resources, units, service offerings, schedules and exceptions as empty shells, reservations, items, allocations, append-only reservation events), all with RLS `ENABLE` + `FORCE` and composite `(tenant_id, id)` foreign keys. `sql/181` seeds 32 permissions, granted to no role (run `identity-access:permissions:backfill` for existing tenants). A hold is a reservation in `held`, so there is no separate holds table.
- **Double-booking is unrepresentable.** Two partial GiST exclusion constraints on allocations (instants for slot mode, dates for stay mode, live rows only) need the trusted `btree_gist` extension, created by the migration: a managed database whose migration role cannot create trusted extensions fails the migration before any table exists.
- **The state machine is a trigger and a pure function.** `awcms_booking_reservations_update_guard` allows only the legal transitions and, per transition, only its columns; terminal states cannot move. `evaluateTransition` mirrors it for handlers, and an integration test asserts the two agree for every pair of states. History tables reject UPDATE and DELETE by trigger and revoked privileges.
- **No money, product id or customer name** is stored (booking.md section 10.2); a test reads `information_schema` to keep it so.
- **Contract additions.** `AccessAction` gains `confirm`, `reschedule`, `check_in`, `complete`, `no_show` and the high-risk `override`. The module is `experimental` with no route, navigation, OpenAPI path or AsyncAPI channel: the allocator, availability search and API are Issues #938 to #941. It does not depend on `commerce`.
- **Deferred inside the schema.** `service_requirements`, `resource_blocks` and `staff_assignments` of the design arrive with the slices that need them. Migrations are `sql/180` and `sql/181`.
