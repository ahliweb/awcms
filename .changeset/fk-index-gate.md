---
"awcms": minor
---

Foreign-key columns must be index-reachable — the repo's first performance gate
(ADR-0064, `sql/090`).

The 2026-08-04 assessment measured **zero of 28 gates** touching performance, so
an unindexed foreign key lands with CI fully green and surfaces months later as
"the admin screen got slow".

Postgres indexes a foreign key's referenced side automatically and its
referencing side not at all, so a bare FK column pays twice: every parent
`DELETE`/`UPDATE` sequentially scans the child table to enforce the constraint,
and the parent→child join has no index either. Measured here: 182 FK columns, 14
unreachable, with `awcms_blog_ads` carrying no index at all beyond its primary
key.

The rule is tenant-aware — reachable means leading an index, or being the second
column after `tenant_id`. The literal "must lead" rule is violated by 40 of 182,
and forty migrations on the day a gate lands is not a gate but an exemption list
waiting to be written. Since RLS `FORCE` guarantees every tenant-scoped query
carries `tenant_id`, a `(tenant_id, fk)` composite is the index those joins
actually use. The residual is stated rather than hidden: that composite does not
help enforce the constraint on a parent delete. The relaxation is bounded and
tested both ways — a second column after anything else does not count, and
neither does a third column after `tenant_id`.

`sql/090` adds thirteen indexes (additive, `IF NOT EXISTS`, no data moved).
`awcms_setup_state.tenant_id` is the single exemption: a hard singleton holding
exactly one row.

Zero permissions, zero OpenAPI change, zero runtime change.
