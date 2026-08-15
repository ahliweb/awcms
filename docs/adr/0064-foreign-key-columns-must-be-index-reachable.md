🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0064-foreign-key-columns-must-be-index-reachable.id.md)

# ADR-0064 — Foreign key columns must be index-reachable

- **Status:** Accepted
- **Date:** 2026-08-04
- **Decision makers:** @ahliweb
- **Related:** [`../awcms/repo-assessment-2026-08-04.md`](../awcms/repo-assessment-2026-08-04.md) §5 (finding: zero of 28 gates check performance), [ADR-0062](0062-skills-are-gated-against-the-code-they-describe.md) + [ADR-0063](0063-ownership-grants-run-through-the-authorization-chokepoint.md) (precedent: a list of reasoned exceptions, dead entries fail too)

## Context

### 1. This repo's gates never check performance

The 4 August 2026 assessment measured it: **zero of 28 gates** in `bun run check`
touch performance. The practical consequence — an FK column without an index, or
an N+1 query, lands with fully green CI and shows up months later as "the admin
screen got slow".

### 2. Why FKs specifically

Postgres indexes the **REFERENCED** side of a foreign key automatically (it is a
unique constraint) and the **REFERENCING** side **not at all**. An FK column
without an index pays twice, and both are visible too late:

- every parent row `DELETE`/`UPDATE` **sequential scans** the child table to
  enforce the constraint, on a table that only grows;
- a join from parent to child has no index to use either.

Measured in this repo: **182 FK columns**, and **14** of them reachable by no
index at all. One table — `awcms_blog_ads` — has no index whatsoever outside its
primary key.

### 3. A strict rule produces a gate that will be switched off

The literally "correct" rule is that an **FK column must LEAD an index**, because
Postgres can only use a B-tree PREFIX. Measured: **40 of 182** violate it.

Forty migrations on the day a gate lands is not a gate — it is an exception list
waiting to be written. This repo has already recorded that failure class three
times (ADR-0057 §F drafts 1–3, ADR-0058 §1): a checker that demands too much
trains its readers to add exceptions until it stops asking anything at all.

## Decision

### §A — The rule: index-reachable, tenant-aware

An FK column counts as **reachable** if it:

1. **leads** an index (`(fk, …)`), **or**
2. is the **second column after `tenant_id`** (`(tenant_id, fk, …)`).

Point 2 is a deliberate relaxation, and the reason is specific to this codebase:
**every tenant-scoped query carries `tenant_id`** — RLS `FORCE` guarantees that —
so the composite `(tenant_id, fk)` IS the index that join uses. Demanding 26
extra single-column indexes would add real write cost for lookups nobody ever
performs.

**The residual is stated, not hidden.** A composite `(tenant_id, X)` does **NOT**
help Postgres enforce the constraint when a PARENT row is deleted — that needs a
bare `X` lookup and will scan. Accepted because parent deletion on these tables
is administrative and rare, while the write cost of 26 indexes is paid on every
insert forever. If parent deletion ever becomes hot, the answer is an index for
that table — not a stricter global rule.

The relaxation is **bounded and tested in both directions**: a column that is
second after something other than `tenant_id` is NOT reachable, and a THIRD
column after `tenant_id` is not either. Without that bound the rule would accept
any composite and find zero — exactly "a gate that reads as coverage while giving
nothing".

### §B — `sql/090` indexes the remaining thirteen

Thirteen additive indexes (`IF NOT EXISTS`, zero data moved, zero constraints
changed). The most notable:

- `awcms_abac_decision_logs.tenant_user_id` — the fastest-growing table in the
  schema, and precisely the column an audit of "what did this user do" filters on.
- `awcms_access_assignments.role_id` — deleting a role scans every assignment row
  in the deployment.
- `awcms_blog_ads.tenant_id` — the only table without any index at all.

### §C — One exception, and the reason is not "we didn't get to it"

`awcms_setup_state.tenant_id`. That table is a hard singleton
(`id boolean PRIMARY KEY` + `CHECK (id)`), so it holds **exactly one row** and an
index on it is pure write overhead against a one-page scan.

Exceptions that are **dead** — the column is already indexed, or is no longer an
FK — are reported as failures too, following ADR-0062/0063.

## Consequences

**What we get.** This repo's first performance gate. The "FK without an index"
defect class goes red in CI instead of being discovered through latency
complaints. Thirteen real scans gone.

**What we pay.** Thirteen indexes means thirteen structures maintained on every
insert. Accepted: all of them are on columns that are joined or filtered, and the
alternative is a sequential scan that grows without bound.

**What is NOT done.** This gate does not measure query plans, does not count
queries per endpoint, and does not touch Core Web Vitals — all three are in
assessment §7 as separate items. It is deliberately one rule that can be decided
from migration text alone, without a database, so it can join the pure `check`
chain.

**Zero permissions, zero OpenAPI changes, zero runtime changes.**
