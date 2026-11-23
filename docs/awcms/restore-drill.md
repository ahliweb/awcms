🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](restore-drill.id.md)

# Backup, restore and business-continuity drill (generic half)

> **Status:** the automated, synthetic half is built (Issue #968, owner decision
> K13 of 22 Nov 2026). The **payroll half is not**: `hr_payroll` is blocked by the
> DPIA (#976) and its tables (#957) do not exist, so its checks are listed as
> `deferred` in every report (section 6) and the issue stays open. The drill
> **against a production deployment is the operator's** (section 5), not
> automated here.

Companion to [`deploy/backup/README.md`](../../deploy/backup/README.md) (the
backup and restore scripts and the encryption/manifest design, ADR-0123),
[`resilience-dr-verification.md`](resilience-dr-verification.md) and
[`production-preflight-runbook.md`](production-preflight-runbook.md).

## 1. What the drill proves

`bun run ops:restore-drill` takes a dump of a database holding synthetic data,
restores it into a **second, fresh cluster**, and shows that:

| Claim                                        | Check ids                                                                                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| every table and row came back, unchanged     | `table_set`, `row_counts`, `row_checksums` (an order-independent `md5` of every row, per table)                                              |
| no sequence went backwards                   | `sequences_not_behind` (the next insert cannot reuse a key)                                                                                  |
| reservations and allocations are one instant | `booking_point_in_time`, `booking_reconciliation_clean` (booking.md section 7.1, run after the restore)                                      |
| row-level security survived                  | `rls_force_catalog`, `policies`, `rls_force_no_new_offenders`, and as `awcms_app`: `rls_isolation_as_app`, `rls_cross_tenant_write_refused`  |
| role grants survived                         | `roles`, `grants_relations`, `grants_columns`, `functions_and_grants`, `triggers`, `append_only_grant_as_app`, `runtime_role_not_privileged` |
| the schema around the data is intact         | `constraints`, `indexes`, `extensions`                                                                                                       |

Seeded domains: booking (holds, confirmations, cancellations, reschedules, slot
and stay reservations, all written through the real service as `awcms_app`, so
allocations, history, audit rows and events are the production ones) and
hr_workforce attendance (employments and clock events). Everything else is
whatever the migrations and those writers produce; every table in `public` is
compared.

**Point in time.** The drill exports a snapshot, reads the witness digests
inside it, commits more reservations and an attendance event **after** it, and
only then runs `pg_dump --snapshot`. The restore must equal the witness and must
contain none of the later writes; a copy that was not one instant would show up
as reconciliation drift. A drill that wrote nothing after the snapshot fails
(`booking_point_in_time` refuses to pass vacuously).

**As `awcms_app`, not a superuser.** A superuser bypasses RLS, so every isolation
check would pass whatever the restore did. The behaviour probes log in as the
real runtime role on the restored database: it must not be a superuser or
`BYPASSRLS`, see zero rows with no tenant context and for a foreign tenant, see
exactly the witness count per tenant, be refused a cross-tenant `INSERT`
(`42501`), and be refused an `UPDATE` on the append-only attendance log. A probe
that is wrongly accepted is rolled back, never left behind.

**Roles are cluster-scoped.** `pg_dump` carries no roles, and a restore into a
cluster without them fails at the first `GRANT`. The drill re-creates the
`awcms_*` roles from the source's attributes, per-role settings (the fail-closed
`app.current_tenant_id` default) and memberships, and sets a throwaway password
(the operator supplies a real secret, as for any deployment; sql/019 header).
That step is timed on its own so the RTO does not hide it.

## 2. Running it

Two disposable loopback clusters (different host:port; the script refuses the
same cluster, because roles would already exist and prove nothing) and a
`pg_dump`/`pg_restore` whose major version is at least the server's:

```bash
docker run -d --name drill-src --network host -e POSTGRES_USER=awcms -e POSTGRES_PASSWORD=awcms_password -e PGPORT=55968 postgres:18-alpine
docker run -d --name drill-dst --network host -e POSTGRES_USER=awcms -e POSTGRES_PASSWORD=awcms_password -e PGPORT=55969 postgres:18-alpine

export TMPDIR=/path/with/space   # the dump is written here
DRILL_SOURCE_URL=postgres://awcms:awcms_password@127.0.0.1:55968/postgres \
DRILL_TARGET_URL=postgres://awcms:awcms_password@127.0.0.1:55969/postgres \
  bun run ops:restore-drill --reservations 40 --employees 6 --days 5 --report drill.json

docker rm -f -v drill-src drill-dst
```

It creates and drops only databases named `awcms_drill_*`, refuses any
non-loopback host, prints a JSON report and exits non-zero unless every
**required** check is present and passing: removing a check from the pipeline
fails the drill (`REQUIRED_CHECK_IDS`). Passwords are passed to `pg_dump` and
`pg_restore` through the environment, never argv.

Tests: `tests/restore-drill-compare.test.ts` (each comparator fails on a
deliberately broken input, and a drill missing any required check fails) and
`tests/integration/restore-drill.integration.test.ts` (a real restore, then
twelve tampers of the restored database, each of which must turn the matching
check red and, once reverted, green again: lost FORCE, a widened or revoked
grant, `BYPASSRLS`, a widened policy, a rewound sequence, a changed cell, a
missing event, a missing allocation, a function turned `SECURITY INVOKER`, a
disabled trigger, a column grant; plus a witness that claims a leaked or absent
post-snapshot write).

## 3. RTO and RPO

**RTO (measured, LOCAL).** The drill reports `measuredRtoMs` = dump + role
provisioning + restore + verification, with each phase separately; set-up
(migrate, seed) is not part of it.

**RPO is a property of the backup policy, not something a drill measures.** It is
the interval between two usable dumps (plus any archived WAL, which this
deployment does not run): `deploy/backup/backup-postgres.sh` taken every _T_
gives an RPO of at most _T_ plus the time to copy it off-site. The drill
restores a given dump; it does not choose one. The production RPO is whatever
schedule the operator runs and records in the drill log; no figure is asserted
here. (`deploy/backup/restore-drill.sh` reports the age of the restored backup
as `restoreRpoSeconds`: an observation of one backup, not a policy.)

## 4. Drill log

> **LOCAL.** Loopback Docker clusters on a shared developer machine
> (PostgreSQL 18.x, `pg_dump` 18.6), default `fsync`, synthetic data, no
> encryption layer. These are **not** production figures and not a capacity
> statement; they bound what the procedure costs on a small schema-dominated
> database.

Run of 23 Nov 2026, four runs, all `ok`:

| Run     | Reservations/tenant | Employees/tenant | Days | Tables | Rows (all tables) | Dump bytes | dump ms | roles ms | restore ms | verify ms | **RTO ms** |
| ------- | ------------------- | ---------------- | ---- | ------ | ----------------- | ---------- | ------- | -------- | ---------- | --------- | ---------- |
| small 1 | 40                  | 6                | 5    | 278    | 3168              | 2,894,580  | 540     | 44       | 6884       | 736       | **8204**   |
| small 2 | 40                  | 6                | 5    | 278    | 3168              | 2,894,789  | 535     | 41       | 6229       | 690       | **7495**   |
| small 3 | 40                  | 6                | 5    | 278    | 3168              | 2,894,404  | 535     | 177      | 5747       | 755       | **7214**   |
| medium  | 300                 | 30               | 6    | 278    | 12252             | 3,536,971  | 574     | 42       | 5669       | 748       | **7033**   |

(Each run: 2 tenants; the medium run seeded 810 reservation rows and 720
attendance events; the small runs 108 and 120.)

Reading it: **the restore is dominated by the schema, not the rows.** 278
tables, 1,270 indexes, 298 policies and 162 triggers cost about 5.7 to 6.9 s
whether the database holds 3 thousand or 12 thousand rows, so four times the
rows moved RTO by nothing beyond run-to-run noise (7.0 to 8.2 s). Do not extrapolate row volume from this;
a production-sized drill (section 5) is what measures it.

All 21 required checks passed in every run, the 15 `CHECK` constraints compare
equal modulo grouping parentheses (see limitations), and the post-restore
booking reconciliation reported drift 0 for both tenants. The restored runtime
role logged in as `awcms_app` (not superuser, not `BYPASSRLS`).

**One finding, not a drill failure.** `awcms_setup_state` carries a `tenant_id`
column and has no row-level security, before and after the restore; it is the
single "tenant table without FORCE" in the schema. The check
(`rls_force_no_new_offenders`) fails only on a table that **lost** FORCE through
the restore, so the drill is green; whether that table should be protected is a
separate question for its owner, recorded here rather than silently accepted.

**Limitations of the drill, stated.**

- `CHECK` definitions are compared modulo parentheses and whitespace, because
  `pg_dump` re-emits and the restore re-parses them, flattening nested `AND`/`OR`
  groups (15 checks differed only in grouping). A changed, dropped or added
  condition still fails; a pure regrouping would not be seen.
- Sequences are compared "not behind": a sequence is not transactional, so the
  dump may legitimately read a value ahead of the snapshot.
- The drill uses plain `pg_dump`/`pg_restore`. It does not exercise `age`
  encryption, the authenticated manifest or the off-site copy of ADR-0123;
  `deploy/backup/restore-drill.sh` does, on a real backup, and is the one to run
  on a schedule.
- It does not exercise WAL archiving or point-in-time recovery (none is
  configured), a replica, or a different PostgreSQL major version.
- `security:readiness` was not run against the restored database by this drill.

## 5. Production drill: operator runbook

Run by the operator against the real deployment's backups, on a schedule the
operator owns (at least before each major release and after any change to
backup, encryption or role set-up). The drill never targets production itself.

1. **Choose a real backup** produced by `deploy/backup/backup-postgres.sh`
   (encrypted, with its manifest) and copied off-site; record the artifact name
   and its `sha256`. Restoring the local copy only proves the local copy.
2. **Scratch cluster, same PostgreSQL major as production**, isolated from it
   (no shared network, no production secrets). Create the roles first: the
   `awcms_*` roles are cluster-scoped and are not in the dump. List them from
   production (`SELECT rolname FROM pg_roles WHERE rolname LIKE 'awcms\_%'`) and
   create them with the same attributes and `ALTER ROLE ... SET` defaults
   (`docs/awcms/environments.md`); set real runtime passwords the way a new
   deployment does (`ALTER ROLE awcms_app LOGIN PASSWORD '<secret>'`).
3. **Restore:** `deploy/backup/restore-postgres.sh <artifact>` (drill mode, the
   default; it verifies the manifest and decrypts first) into the scratch
   database. Start a timer at step 2 and stop it when step 6 passes: that is the
   actual RTO of this deployment.
4. **Migrate forward:** `bun run db:migrate` against the restored database to
   prove the current release applies on the restored data
   ([`production-preflight-runbook.md`](production-preflight-runbook.md)).
5. **Compare** with what production holds at the backup's instant, where you
   can: row counts for the domain tables (`awcms_booking_reservations`,
   `awcms_booking_resource_allocations`, `awcms_hr_attendance_events`, the
   payroll tables once they exist), and `SELECT relname, relforcerowsecurity FROM
pg_class WHERE relrowsecurity` for FORCE.
6. **Verify as the runtime role, not the owner:** log in as `awcms_app`; with no
   tenant context a tenant table must return 0 rows; with a real tenant id it
   must return that tenant's count; with a foreign UUID, 0. Then run the booking
   reconciliation (`GET /api/v1/booking/reservations/reconciliation`, booking.md
   section 7.1) for each active tenant: reservations and allocations must come
   back from the same point in time, `drift` 0. After any restore also run
   `bun run security:readiness` with the production environment (not a local
   `.env`).
7. **Record** in the drill log: date, artifact and `sha256`, backup age (the
   observed RPO of that backup) and the policy RPO, measured RTO by phase, the
   data volume, who ran it, and every discrepancy. Destroy the scratch cluster.

Payroll additions (apply once #957 lands; the checks are `deferred` in the
report until then, section 6):

- keep every key id a restorable backup still needs in **both** the encryption
  and the hash key rings (ADR-0137 sections 2 and 6): before dropping a key id,
  query the `keyId` prefix of `account_ciphertext` in the database **and in every
  retained backup**;
- drill the restore **without** the key ring (reveal and re-encryption must fail
  closed; masked reads work) and **with** it (reveal works, the AAD-bound
  ciphertext authenticates);
- run the payroll reconciliation (hr-payroll.md section 14) after attendance,
  commission and payroll are restored from the same point in time;
- counsel question L-P8 (backups that still contain purged data subjects)
  depends on this drill's evidence.

## 6. Payroll: deferred, with its hook

The payroll controls above are the part of #968 that needs payout accounts and
the key ring, i.e. #957. They are present in every report as `deferred`, never
absent and never counted as passed (`PAYROLL_DEFERRED_CHECKS` in
`scripts/lib/restore-drill.ts`):

| Deferred check                         | Contract                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `payroll_key_ring_retention`           | every key id a restorable backup needs is in both the encryption and hash rings            |
| `payroll_restore_without_key_ring`     | reveal and re-encryption fail closed, masked reads work                                    |
| `payroll_restore_with_key_ring`        | reveal works, AAD-bound ciphertext authenticates                                           |
| `payroll_reconciliation_after_restore` | the payroll reconciliation after attendance, commission and payroll restore to one instant |

**Hook for #957:** add the payroll seed to `scripts/lib/restore-drill-seed.ts`
(synthetic payout accounts under a **throwaway** key ring, never a real key),
add the check ids to `REQUIRED_CHECK_IDS` and implement them in
`scripts/lib/restore-drill-verify.ts`, and move the entries out of
`PAYROLL_DEFERRED_CHECKS`. The integration test's tamper list is where a
"key ring missing" and "wrong key id" tamper belongs. Until then the issue stays
open.

## 7. Open points

- The production drill (section 5) has not been run: it needs the operator's
  deployment and backups.
- No production RPO is stated: it follows from the schedule the operator runs.
- The owner of `awcms_setup_state` decides whether it needs row-level security.
