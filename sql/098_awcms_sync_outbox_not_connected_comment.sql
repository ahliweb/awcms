-- Issue #477 — say in the schema itself that this queue has no producer.
--
-- `sql/010` created `awcms_sync_outbox` and nothing has ever written a row into
-- it: not application code, not a trigger, not a migration. `POST
-- /api/v1/sync/pull` is its only reference and it only SELECTs, so the endpoint
-- can answer nothing but an empty event list.
--
-- The module README and the OpenAPI tag description now say so, but a DBA
-- reading the schema sees neither. An empty table with a cursor index, an RLS
-- policy and a status CHECK looks exactly like a queue that happens to be
-- drained — which is the wrong conclusion in the expensive direction, since it
-- invites building on a path that was never connected.
--
-- `sql/010` itself is applied and therefore immutable (editing an applied
-- migration blocks `db:migrate` on every running deployment while staying green
-- on an empty CI database), so the comment lands here instead.
--
-- Nothing structural changes. `COMMENT ON` takes no lock worth the name and
-- rewrites no rows; this migration is safe to run against a live database and
-- idempotent by construction — a second run simply sets the same text.

COMMENT ON TABLE awcms_sync_outbox IS
  'NOT CONNECTED (issue #477): no producer exists anywhere in the codebase — no application code, no trigger, no migration INSERTs into this table. POST /api/v1/sync/pull, its only reader, can therefore only ever return an empty event list. Whether to wire a producer or retire the table is an open product decision; awcms_domain_events is this repo''s working transactional outbox. Asserted by tests/object-queue-purge.test.ts, which fails the moment a write appears.';
