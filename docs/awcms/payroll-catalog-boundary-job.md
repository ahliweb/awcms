🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](payroll-catalog-boundary-job.id.md)

# Runbook: scheduled payroll catalog check

Issue #1095 (owner decision K3 of 22 November 2026). Background and the rule
itself: [`hr-payroll.md`](hr-payroll.md) section 13.3.

`bun run payroll:catalog-boundary:job` reads the **catalog** of the deployed
database once a day and fails when something outside the payroll family reaches
a payroll table: a view, rule, function, trigger or grant, a missing required
trigger or foreign key, a look-alike table, or an object with an owner nobody
accounted for. It is a drift alarm. It reads **no data row of any table**.

It is in the `hr_commission` module's job registry, so `ops/awcms-jobs.crontab`
carries it (`17 3 * * *`, one run per day, under `flock`).

## How it runs in production

The production runtime image holds only `dist/`. Like every other job it runs
through `ops/run-job.sh`, which starts the `jobs` stage image
(`ghcr.io/ahliweb/awcms-jobs`, same commit as the app) with the generated
`ops/awcms-jobs.env-global` and `ops/awcms-jobs.env-scoped`. Nothing here is
special: install the crontab and the runner files as for any release, and the
job is scheduled.

It is a **dedicated-role job** (the same class as `social-publishing:dispatch`):

- its only login is `PAYROLL_CATALOG_AUDIT_DATABASE_URL`, granted to this job
  alone in `ops/awcms-jobs.env-scoped`, with **no fallback** to `DATABASE_URL`
  or `WORKER_DATABASE_URL`;
- `ops/run-job.sh` withholds `DATABASE_URL`, `WORKER_DATABASE_URL` and
  `SETUP_DATABASE_URL` from it unconditionally (a generated block;
  `bun run jobs:env-allowlist:check` fails when it is stale);
- the job refuses to start if one of those three is present, and refuses unless
  the server says both `session_user` and `current_user` are
  `awcms_catalog_boundary_audit` and the role is neither SUPERUSER nor BYPASSRLS.

## Operator setup (once per deployment)

`sql/420` creates the role `awcms_catalog_boundary_audit` as `NOLOGIN` with no
password. It holds CONNECT on the database and **no privilege on any
application table** (the catalog views are readable by every role). The
operator makes it usable:

1. Give it a login and a password (generate one; never reuse another role's):

   ```sql
   ALTER ROLE awcms_catalog_boundary_audit LOGIN PASSWORD '<secret>';
   ```

   CONNECT comes from PostgreSQL's default `CONNECT` for `PUBLIC`, as for every
   other `awcms_` role. If you revoked it, also run
   `GRANT CONNECT ON DATABASE <db> TO awcms_catalog_boundary_audit;`.

2. Put the connection string in the environment of the **app service** (the
   Coolify application), next to its other variables, never in `DATABASE_URL`:

   ```
   PAYROLL_CATALOG_AUDIT_DATABASE_URL=postgres://awcms_catalog_boundary_audit:<secret>@<host>:5432/awcms
   ```

   `ops/run-job.sh` does not read a separate jobs environment: it copies the
   allow-listed variables from the running app container
   (`docker exec "$APP" printenv`). The generated files grant this one variable
   to `payroll:catalog-boundary:job` alone, so no other job receives it, and the
   web process never reads it. The consequence is that the value does sit in the
   app container's environment, which is why the role holds nothing but CONNECT
   and the catalog: a leaked value reads structure, never a row.

3. **Split-role deployments only** (migrations run by one role, payroll objects
   owned by another): set `PAYROLL_EXPECTED_OWNERS=role1,role2` in the same
   environment. The expected owner is otherwise the owner of the migration
   ledger.

4. Restrict the login to what it needs in `pg_hba.conf` (recommended, not
   enforced by the application): one database, one source host, TLS, e.g.

   ```
   hostssl  awcms  awcms_catalog_boundary_audit  <jobs-host-cidr>  scram-sha-256
   ```

   and no other `pg_hba` line may match this role (`host all all 0.0.0.0/0` would
   let the login be used from anywhere). The role has no table privilege, so this
   narrows where a leaked password can be tried, not what it can read.

5. Run it once by hand to see it pass before the first night:

   ```
   ops/run-job.sh payroll:catalog-boundary:job
   ```

`security:readiness` pins the role (it exists; not SUPERUSER, BYPASSRLS,
CREATEDB or CREATEROLE; no table- or column-level privilege on any relation; in
no membership; owns nothing). Granting it anything fails that check.

## What a run looks like

Every outcome is a **structured log line** from the repo logger (one JSON object
per line on stdout, with `level`, `message`, `moduleKey: "hr_commission"` and
`job`), not a bare text line, so a log shipper that filters on `level: "error"`
sees it. The exit status carries the same verdict.

| Outcome                                                                         | Exit | Log                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean                                                                           | 0    | `info` `payroll.catalog_boundary.ok` with the summary (so "ran and found nothing" differs from "did not run").                                                                                                                                                          |
| **Not activated** (`PAYROLL_CATALOG_AUDIT_DATABASE_URL` unset)                  | 0    | `warning` `payroll.catalog_boundary.skipped_not_activated` and the line `payroll:catalog-boundary:job SKIPPED (not activated)`. No check ran: **there is no drift alarm until the operator activates it.** `security:readiness` warns about the same state (see below). |
| A finding                                                                       | 1    | One `error` `payroll.catalog_boundary.finding` per finding (`code`, `object`, `detail`), then one `error` `payroll.catalog_boundary.failed` with the counts. `expectedOwnersMissing: true` marks the split-role case below.                                             |
| Owner not accounted for and `PAYROLL_EXPECTED_OWNERS` empty                     | 1    | The same, with `expectedOwnersMissing: true` and a summary naming `PAYROLL_EXPECTED_OWNERS`: on a split-role deployment set it; on any other deployment it is a payroll object that changed hands, which is the finding next to it.                                     |
| Misconfigured: URL set but the wrong role, unreachable, or a shared URL present | 1    | `error` `payroll.catalog_boundary.job_refused` with the reason (role names only, never a connection string).                                                                                                                                                            |

`security:readiness` carries two checks for this role: a **critical** pin (the role
holds nothing: no table or column privilege, no `EXECUTE` on any SECURITY DEFINER
function, `NOINHERIT`, no membership, owns nothing) and a **warning**,
"Scheduled payroll catalog check is activated", which fails while the role has no
LOGIN. The warning never blocks go-live; a fresh or local database shows it
because it is not activated.

The job log is `$AWCMS_JOB_LOG/payroll-catalog-boundary-job.log`. The failing
exit status and the `error` lines are what the host's cron mail or log shipper
alerts on: **wire them to a person**, a green-by-default log nobody reads is not
an alarm, and neither is a job that stays "not activated".

## When it fails

1. Read the findings. Each has a `code` (see the table in
   `scripts/lib/payroll-catalog-boundary.ts`) and names the object.
2. A finding on a release you just deployed is a migration that reached payroll
   outside the family: treat it as a security finding
   ([`SECURITY.md`](../../SECURITY.md)), not as a flaky check.
3. Do not add an entry to `PAYROLL_CATALOG_EXEMPTIONS` to silence it. The way out
   is the payroll family name.

## Limits

- The check is **defence in depth**. Migration review (CODEOWNERS and a security
  review for `sql/` touching payroll) remains the primary control, and the
  residuals #1095 lists (rebuilds behind unmodelled constructs, finite helper
  lists, logical replication slots, a superuser) are unchanged.
- Daily, so a change made and reverted within a day is not seen.
- Not activated means not running: until the operator sets the URL and the role
  has a LOGIN, the job logs `SKIPPED (not activated)` and exits 0.
- `payroll:catalog-boundary:check` (`DATABASE_URL`) is still the operator form for
  a restored database; it is not a job and is not scheduled.
