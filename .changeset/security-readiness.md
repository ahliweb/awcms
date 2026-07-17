---
"awcms": minor
---

Add `bun run security:readiness` — a go-live gate that catches inert RLS and
RLS-bypassing DB roles (Issue #142), ported from awcms-mini and adapted to
this base.

Nothing in this repo detected RLS regressions. Migrations 002-008 and 010-012
shipped 23 tenant-scoped tables with `ENABLE ROW LEVEL SECURITY` but no
`FORCE`, which PostgreSQL ignores for the table owner — the role this app
connects as. The isolation policies were never evaluated, and every check
stayed green for the entire time (found by manual audit, fixed by `sql/017`).

`scripts/security-readiness.ts` runs 13 named checks, each backed by a real
signal (a DB query, a grep over tracked files, or a call into a real domain
function — none hardcoded to pass). Any `critical` failure exits non-zero and
blocks go-live; `warning`/`info` findings print without blocking. The two the
issue exists for:

- **RLS enabled AND forced on tenant-scoped tables** (critical) — requires
  `relforcerowsecurity`, not just `relrowsecurity`. Every `awcms_%` table not
  in a documented, per-table-justified RLS-free allowlist must have both, so a
  future migration reintroducing the bug fails without anyone remembering to
  register anything.
- **App DB connection role does not bypass RLS** (critical) — `FORCE` still
  does nothing against `rolsuper`/`rolbypassrls`, so the app's own connection
  role is inspected.

Also: no hardcoded secret, `.env` not tracked, argon2id hashing, login
lockout, ABAC default-deny, audit table reachable, env config valid, sync HMAC
secret rotated, login rate limiting, and security response headers. Items that
genuinely cannot be automated from this repo (deployment/network/backup
concerns, per-table grant matrices) are printed as documented out-of-scope
entries with a reason rather than dropped.

Not wired into `bun run check`: the DB-backed checks need a migrated database
and `ci.yml` has no Postgres service. Run it against the target deployment,
using the app's own `DATABASE_URL` — a privileged/superuser URL makes the
result meaningless, which the role check reports outright.
