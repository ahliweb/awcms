🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](payroll-breach-notification-runbook.id.md)

# Payroll data breach notification procedure (runbook)

> **STATUS: DRAFT — not approved; not legal advice.** This is an agent-prepared
> procedure (owner decision K13, 22 November 2026). It turns the technical facts
> of this repository into an operating procedure. **It does not decide what the
> law requires.** Every legal reference below is either marked as quoted from the
> official text with a confirmation duty, or says "verify with counsel". The
> procedure takes effect only when the data controller and legal counsel have
> reviewed and signed section 16. Until then, treat the clocks in section 5 as
> **proposals**, not obligations.

- **Issue:** #1448. It treats residual risk **R-12** of the draft DPIA
  `docs/awcms/dpia-hr-payroll-phase-3.md` (draft in PR #1451, not yet on `main`; "breach of payroll
  data not detected or not notified in the required period") and legal question
  **L-P9** of [`hr-payroll.md`](hr-payroll.md) section 17.
- **Depends on:** owner decision **O5** (is the platform operator controller,
  processor or both, per deployment). O5 is **open**; section 2 gives the
  procedure for each outcome and does not choose one.
- **Related:** [`privacy-analysis.md`](privacy-analysis.md) section 5 (what only the
  operator can answer), [`../../SECURITY.md`](../../SECURITY.md) (vulnerability
  reports, a different channel), [`data-lifecycle.md`](data-lifecycle.md) (legal
  hold), [`hr-payroll.md`](hr-payroll.md) 13.2 and 13.3 (breach readiness, sensitive
  reads).

## 1. Scope and what "payroll data" means here

In scope: a confirmed or suspected **unauthorised access, disclosure, alteration,
loss or unavailability** of personal data held for the payroll family of modules
(`hr_payroll`, and the compensation-related data of `hr_commission` and
`hr_workforce`): compensation (pay basis and amounts), payout accounts (bank or
wallet references), payroll run lines (earnings, deductions, withholding), payslips,
commission accruals, attendance and metrics facts, and any export file of these.

Out of scope: a vulnerability report with no evidence of exposure (use
`SECURITY.md`), and an outage with no confidentiality or integrity impact (use the
normal operations runbooks, such as
[`database-capacity-runbook.md`](database-capacity-runbook.md)). An outage that
loses payroll data **is** in scope (availability and loss are part of the
definition above; whether a given loss must be notified is a legal question, see
section 3).

**Implementation state, said plainly.** The `hr_payroll` module is a **design**
(see `hr-payroll.md`): no payroll table exists in `sql/` and no payroll route
exists in `src/modules/` at the time of writing. What does exist and is used
below: the audit trail (`awcms_audit_events`), the sensitive-read audit and its
policy registry (`src/modules/_shared/sensitive-reads.ts`, which already names the
payroll kinds), the authorization decision log, sessions, the legal-hold engine,
the security readiness gate, and the payroll catalog-boundary check. Where a step
refers to an audit action that the payroll module will write (for example the
payout-account reveal row), the text says so. **Before phase 3 goes live, the
queries in section 8 must be re-run against a database that has the payroll module
enabled and its output compared with this document** (a go-live item, section 15.4).

## 2. Who is controller and who is processor

### 2.1 The parties in an AWCMS deployment

| Party                     | Who it is                                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Operator**              | AhliWeb (or whoever runs the AWCMS deployment): application, database, hosting account, backups, platform administration.                            |
| **Tenant**                | The organisation whose employees are paid through the deployment. Each tenant is isolated by RLS; the audit trail is per tenant.                     |
| **Data subjects**         | The tenant's employees (and, for commission, any beneficiary the tenant records).                                                                    |
| **Sub-processors**        | Hosting and backup providers, email or messaging providers where enabled. Listed in the per-deployment addendum (DPIA document B, tracked in #1449). |
| **Supervisory authority** | The data-protection authority under UU PDP. Whether it is constituted and how it receives notifications is **to be verified with counsel**.          |

### 2.2 Working assumption, and what O5 changes

The DPIA draft (section 1.5) discusses each **tenant as the controller** of its
employees' data and the operator as **processor** for tenant payroll data, and as a
possible **controller** for its own account, security and audit data. That is
discussion, not a decision: **O5 decides it per deployment.** The procedure is
written so that the technical steps are identical in every case and only the
"who notifies whom" column changes.

| Event                                               | If tenant = controller, operator = processor (assumption A)                                                                                                                                                                                                                   | If the operator is also a controller of the affected data (assumption B)                                                                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator detects an exposure of tenant payroll data | Operator **notifies the tenant** (controller) and gives it the evidence; **the tenant decides and sends** notices to data subjects and the authority. The operator does not contact data subjects or the authority on the tenant's behalf unless the processing terms say so. | The operator is **also** a notifier for the part it controls (for example the operator's own administrators' audit data, operator accounts, operator-held backups). Both parties run their own clock. |
| A tenant user (insider) causes it                   | Tenant is the controller of the insider's act; the operator supplies the audit evidence on request.                                                                                                                                                                           | Same.                                                                                                                                                                                                 |
| A platform operator staff member causes it          | The operator is the actor: it notifies the tenant at once and is the first-named party in the notice. Operator staff access to tenant payroll data is open risk R-11 (#1449).                                                                                                 | Same, and the operator's own duty as controller is also triggered (verify with counsel).                                                                                                              |
| Sub-processor reports an incident to the operator   | Operator relays to the tenant; the operator's contract with the sub-processor sets its own clock to the operator.                                                                                                                                                             | Same.                                                                                                                                                                                                 |

**Not decided here, and to be written into the processing terms (O5, #1449):**
how fast the operator must tell the tenant (section 5 proposes a number), what
evidence the operator hands over, who pays for notices, whether the operator may
send notices on the tenant's instruction, and who is the named contact on each
side (section 14).

## 3. Legal frame (UU 27/2022, Personal Data Protection Law)

This section states only what the author is confident of, and labels the rest.
Nothing here replaces counsel. **Confirmation duty:** before the controller signs,
counsel confirms each row against the official text of Law No. 27 of 2022 and its
implementing regulations as in force on the date of signing.

| Topic                                                                                                                                                                                                                   | What this runbook relies on                                                                                                                                                                                                                                                  | Status                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duty to notify on a failure of personal-data protection                                                                                                                                                                 | Article 46 of UU 27/2022: the **controller** must give written notice to the data subject and to the authority. The author's recollection is that the period is **3 x 24 hours** and the content is the data disclosed, when and how, and the handling and recovery efforts. | Quoted from memory of the official text. **Counsel must confirm the article, the period, the trigger for counting (discovery or occurrence) and the content list.** |
| Notice to the public in certain cases                                                                                                                                                                                   | The same article is understood to add a public notice where the failure disrupts public services or seriously affects the public interest.                                                                                                                                   | **Verify with counsel.** Unlikely for a private tenant payroll, not assumed away.                                                                                   |
| Duty of a processor to notify the controller                                                                                                                                                                            | Not quoted. Whether the law puts a direct, time-bound duty on a processor, or leaves it to the processing agreement, is **not asserted**.                                                                                                                                    | **Verify with counsel.** Section 5 uses a contractual proposal.                                                                                                     |
| Impact assessment (DPIA)                                                                                                                                                                                                | Required for high-risk processing; the DPIA draft cites it.                                                                                                                                                                                                                  | See the DPIA draft; counsel confirms the article.                                                                                                                   |
| Security safeguards and confidentiality duties of the controller                                                                                                                                                        | Exist in the law; article numbers are not quoted here.                                                                                                                                                                                                                       | **Verify with counsel.**                                                                                                                                            |
| Administrative or criminal consequences of a failure to notify                                                                                                                                                          | Exist in the law; neither amounts nor article numbers are quoted here, deliberately.                                                                                                                                                                                         | **Verify with counsel.**                                                                                                                                            |
| Implementing regulation, authority procedure and notification channel                                                                                                                                                   | The author does not know the current state of the implementing regulation or of the authority's notification form or portal.                                                                                                                                                 | **Verify with counsel.** Fill in section 14 once known.                                                                                                             |
| **Other regimes** that may also be triggered by payroll data: tax, social security, labour, sector regulators, a financial regulator if payout accounts are involved, foreign data-subject law if an employee is abroad | Not assessed.                                                                                                                                                                                                                                                                | **Verify with counsel**, per deployment (addendum B).                                                                                                               |
| Whether a given incident is **notifiable** (risk threshold)                                                                                                                                                             | Not asserted. Section 10 gives a factual assessment worksheet; the **decision** is the controller's, with counsel.                                                                                                                                                           | Controller and counsel decide.                                                                                                                                      |

**Design consequence.** Because the statutory period, if it is as recalled, is short
and runs on the controller, the operator-to-tenant step must be much shorter than
the statutory period, or the tenant cannot comply. That is why section 5 proposes
an operator clock of hours, not days. The proposal stays valid if counsel
corrects the statutory number; only the controller-side clock changes.

## 4. Roles and responsibilities

Names and contact details are **not** in this repository (no personal data in
docs). Section 14 is the template each deployment fills in its own, access-controlled
copy.

| Role                                             | Side        | Responsibility                                                                                                                                  |
| ------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Incident commander (IC)**                      | Operator    | Owns the incident from triage to closure; keeps the timeline; makes containment calls; is the single voice to the tenant.                       |
| **Security lead**                                | Operator    | Runs the investigation and the queries in section 8; preserves evidence; confirms or rules out exposure.                                        |
| **Platform on-call engineer**                    | Operator    | Executes containment (section 7): session revocation, account deactivation, key rotation, module disable, legal hold.                           |
| **Operator contact for legal and contracts**     | Operator    | Checks the processing terms, sub-processor contracts and the third-party register (section 12).                                                 |
| **Tenant incident contact**                      | Tenant      | Receives the operator's notice; speaks for the controller.                                                                                      |
| **Tenant data-protection officer or equivalent** | Tenant      | Where one is appointed (whether it is mandatory for this deployment is to be verified with counsel). Decides notifiability with counsel.        |
| **Tenant legal counsel**                         | Tenant      | Decides what the law requires; approves notices to data subjects and the authority.                                                             |
| **Tenant HR/payroll lead**                       | Tenant      | Knows which employees and which pay periods are affected; supports the notice and the employees' questions; freezes payroll operations if told. |
| **Sub-processor contacts**                       | Third party | Hosting, backup, email or messaging provider: supply logs and confirm scope.                                                                    |

An individual may hold more than one role in a small deployment, **except** that the
person whose conduct is under investigation holds none of them for this incident
(declare it and replace them).

## 5. Clocks

Two kinds of clock exist and they must not be confused.

- **Statutory clock** (section 3): runs on the **controller**. Value and trigger to be
  confirmed by counsel. Written in this document as "S" and never as a number
  that this document asserts.
- **Operational clocks** (below): **internal targets proposed by this runbook.**
  They are not law. The processing terms (O5) turn them into commitments or replace
  them.

Definitions: **T0** = the moment anyone at the operator first has a credible
indication (alert, report, finding). **T1** = the moment the security lead
records "exposure confirmed" (or "exposure cannot be ruled out after the
first-pass queries"). **T1 is never later than 24 hours after T0**; if the
queries cannot settle it, the answer on that day is "cannot be ruled out" and the
tenant is told so.

| Step                                                      | Proposed operational target                                                                   | Who                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------- |
| Acknowledge and assign an IC                              | within 1 hour of T0, around the clock for critical alerts                                     | On-call engineer                       |
| Containment decision (section 7)                          | within 4 hours of T0                                                                          | IC                                     |
| First-pass scoping (queries Q1 to Q6)                     | within 24 hours of T0 (this fixes T1)                                                         | Security lead                          |
| **Operator notice to the tenant (controller)**            | **within 24 hours of T1; earlier is better, and a heads-up as soon as exposure is plausible** | IC                                     |
| Tenant decides notifiability and sends notices            | within **S** counted by the controller from its own trigger                                   | Tenant, with counsel                   |
| Third-party obligation (section 12), for example LinkedIn | **24 hours** where the third party's terms say so, counted as that third party's terms say    | Operator (or tenant, per the register) |
| Full scoping and root cause                               | within 10 working days of T1 (proposal)                                                       | Security lead                          |
| Post-incident review                                      | within 15 working days of closure                                                             | IC                                     |

If counsel finds that the statutory period starts at occurrence rather than at
discovery, or that a processor has a direct duty, only this table changes.

## 6. Procedure overview

```
Detect -> Triage -> Contain -> Assess risk -> Notify -> Recover -> Review
 (6)       (7.1)     (7.2)       (10)        (11,12)     (7.3)      (13)
```

Each step writes one line in the incident timeline (time in UTC, who, what,
evidence reference). The timeline is the record that counsel and the controller
will ask for; keep it in an access-controlled location outside the repository.

### 6.1 Detect: where an exposure shows up

All of the following exist in the repository today unless a row says "will exist
with the payroll module".

| Signal                                     | What it tells you                                                                                                                                                       | Source (verified in code)                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sensitive-read audit rows** at `warning` | An actor reached a decade of reads or records in one window (10, 100, 1000 and so on), or ran an **export** or **export download** (always `warning`, never coalesced). | `awcms_audit_events` rows with `action` `sensitive_read.*`; written by `recordSensitiveRead` (`src/modules/logging/application/sensitive-read-audit.ts`); policy per permission in `src/modules/_shared/sensitive-reads.ts`                                                                                                                                                                          |
| **Payout-account reveal row** (`warning`)  | A disclosure of a payout account happened and by whom, never the value.                                                                                                 | Will exist with the payroll module (`hr-payroll.md` section 11.3, S12). The action name is not fixed in code yet.                                                                                                                                                                                                                                                                                    |
| **Critical audit rows** on `hr_payroll`    | A period lock or a reversal of a paid accrual.                                                                                                                          | `hr-payroll.md` section 11.3 table.                                                                                                                                                                                                                                                                                                                                                                  |
| **Authorization denials** from one actor   | Probing: many `deny` decisions on payroll permissions.                                                                                                                  | `awcms_abac_decision_logs` (`decision = 'deny'`)                                                                                                                                                                                                                                                                                                                                                     |
| **Authentication anomalies**               | `login_failed` bursts, `login_succeeded` from unexpected context, session handoff rejections.                                                                           | `awcms_audit_events` actions `login_failed`, `login_succeeded`, `auth.session_handoff.*` (`src/modules/identity-access`)                                                                                                                                                                                                                                                                             |
| **Readiness finding** `critical` / `fail`  | A control that keeps payroll data inside its tenant or role boundary has been weakened (RLS, role privilege, policy expression).                                        | `bun run security:readiness` (`scripts/security-readiness.ts`); a critical failure exits non-zero                                                                                                                                                                                                                                                                                                    |
| **Catalog boundary finding**               | A view, rule, function, trigger or grant reaches a payroll table from outside the payroll family, or an owner other than expected.                                      | `bun run payroll:catalog-boundary:check` (`scripts/payroll-catalog-boundary-check.ts`). Owner decision K3 schedules it **daily** against the deployed database under a minimal dedicated role (connect plus catalog, no table `SELECT`); the **operator provides the credential and the schedule**: it is not a job in this repository, and a deployment that has not set it up has no daily signal. |
| Report from a person                       | An employee, a tenant admin, a sub-processor, a researcher.                                                                                                             | The operator's published contact for security reports; `SECURITY.md` for vulnerability reports.                                                                                                                                                                                                                                                                                                      |
| Sub-processor notice                       | Hosting or backup provider reports an incident.                                                                                                                         | Sub-processor contract channel.                                                                                                                                                                                                                                                                                                                                                                      |

**What the signals cannot see (limits to say out loud in every assessment):**

- A read by an employee of **their own** released payslip arrives through an
  ownership grant and is intentionally not in the sensitive-read audit
  (`sensitive-reads.ts`, payslip policy rationale). Exposure of an account that
  belongs to such an employee shows in session and login rows, not in read rows.
- Reads are **coalesced**: in a window, the first read writes a row and later reads
  only increment a counter. Identities of records are **not** dropped (a read
  naming a record not already audited writes a row listing it), but the **count of
  reads** between rows lives in the running totals on the row, and the working
  counter table (`awcms_sensitive_read_windows`) is overwritten by the next window.
  Evidence is the audit row, never the counter table.
- The audit trail records **what the application did**. Theft of a **database dump
  or a backup**, a **direct database login**, or **hosting-level access** leaves no
  application audit row. Those need the database server log, the hosting access
  log and the backup provider's records, which are outside this repository.
- Audit retention is finite: the default for `awcms_audit_events` is **730 days**
  (minimum 365) and for `awcms_abac_decision_logs` **365 days** (minimum 90),
  governed by `data_lifecycle` descriptors and `AUDIT_LOG_RETENTION_DAYS`. An
  investigation of an old exposure may find the rows already purged: **place a legal
  hold first** (section 7.1).
- If `recordSensitiveRead` fails, the read **does not happen** (fail-closed). So
  an absence of read rows is meaningful for the audited permissions; it says
  nothing about data reached by a route that was never classified (the
  `sensitive-reads:check` gate exists to prevent that, and a gap is itself a
  finding).

## 7. Triage, containment, recovery

### 7.1 Triage (first hour)

1. Open the incident timeline. Record T0, the signal, and who reported it.
2. Assign the IC and the security lead. Declare any conflict of interest (an
   investigator who is a suspect is replaced).
3. Classify the **affected tenants**. In a multi-tenant deployment, scope **per
   tenant**: one run of the queries per tenant, with that tenant's id. Never
   merge tenants in a query result that leaves the operator.
4. **Preserve evidence before anything changes.**
   - Place a **legal hold** on the audit trail and the decision log for each
     affected tenant so the purge job cannot remove rows. Use
     `POST /api/v1/data-lifecycle/legal-holds` (permission
     `data_lifecycle.legal_hold.create`; an `Idempotency-Key` header and a reason of
     at least 10 characters are required; the hold is audited at `critical`; creating a
     hold does not grant the ability to release one). Descriptor keys:
     `logging.audit_events`, `identity_access.abac_decision_logs`, and
     `identity_access.sessions` if the hold surface accepts it (check the response;
     do not assume).
   - Export the result of the section 8 queries to the evidence location (read-only,
     with the query text, run time and the operator who ran it).
   - Pause `bun run logs:audit:purge` for the incident period if it is scheduled
     outside the data-lifecycle engine (the legal hold is the control; pausing is a
     belt and braces step, not a replacement).
   - Ask the hosting and backup providers to preserve their logs.
5. Do **not** delete or edit anything to "clean up". `awcms_audit_events` is
   append-only to the application role by design (migration 408); a tool that
   rewrites evidence is a finding.

### 7.2 Containment (within 4 hours)

Choose the least action that stops the exposure, record why, and prefer reversible
actions. All of these exist today.

| Situation                                                   | Action                                                                                                                                                                                                                                         | Reversible?                          |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| A tenant user's account is suspected                        | `POST /api/v1/users/{id}/sessions/revoke-all` (permission `identity_access.user_sessions.revoke`, audited; "the incident control", effective on the next request); then `PATCH /api/v1/users/{id}` to set the status inactive.                 | Yes: status can be set active again. |
| The user's own devices are suspected                        | `POST /api/v1/auth/sessions/revoke-all` by the user (self-service) and a password reset; if MFA is on, review the factors.                                                                                                                     | Yes.                                 |
| A role or ABAC policy is too wide                           | Narrow it through the access admin surface; ABAC is default-deny, so removing a grant takes effect immediately for new requests.                                                                                                               | Yes.                                 |
| The payroll module itself must stop for a tenant            | `POST /api/v1/tenant/modules/hr_payroll/disable` (tenant module lifecycle; not for core modules).                                                                                                                                              | Yes: enable.                         |
| Payout-account key material may be exposed (ADR-0137)       | Rotate the payout-account key ring and the HMAC key ring following ADR-0137 once implemented. **Not implementable today**: record it as a gap if triggered.                                                                                    | n/a                                  |
| A secret or credential leaked (database URL, worker secret) | Rotate through the deployment's secret store; restart. Follow `deploy-coolify.md` and `production-preflight-runbook.md` for the sequence.                                                                                                      | Yes.                                 |
| A leaked export file                                        | Disable the export configuration (`POST /api/v1/reports/exports/{id}/disable`) where the export came from the reporting module; for a payroll export, per the module once it exists.                                                           | Yes.                                 |
| Suspected database-level compromise                         | Escalate to the hosting provider; isolate the instance; rotate all database role credentials; do not restore over the evidence. Run `bun run security:readiness` as the **application role** (not a privileged one) on the recovered instance. | Case by case.                        |

### 7.3 Recovery

- Restore from backup only on a **new** target and after the evidence is preserved
  (`deploy/backup/restore-postgres.sh`, `deploy/backup/README.md`). A restore of
  payroll data requires the reconciliations of `hr-payroll.md` section 14.
- Re-run `bun run security:readiness` (application role) and
  `bun run payroll:catalog-boundary:check` on the restored or remediated database.
  The recovery is not complete until both are clean or every finding is accepted in
  writing by the IC.
- Re-enable the module (`POST /api/v1/tenant/modules/hr_payroll/enable`) only when
  the IC records the root cause as closed or contained.

## 8. Evidence: "who read what" for a tenant and a window

These queries are **read-only** and were run against a freshly migrated database
(all migrations applied, a seeded tenant with synthetic audit rows) to check syntax,
tenant filtering and the JSON paths. They were **not** run against production data.
They answer the question the DPIA asks (PS-18): who read what, and how much, for one
tenant and one time window.

**How to run them.**

- Connect as the **application role** (`awcms_app`), through the operator's access
  path, **not** as a superuser: RLS is `FORCE`d and keys on
  `app.current_tenant_id`; a superuser bypasses RLS and could read across tenants.
  Every query below **also** carries `tenant_id = :'tenant'` so that a privileged
  session cannot accidentally widen it.
- Set the variables once, then run inside one **read-only transaction**.
- Never paste query output with record ids or user ids into a chat or an email.
  The ids are references, not values (no amount, name or account is stored in
  these rows), but they identify people to anyone who can join them.

```sql
-- psql
\set ON_ERROR_STOP on
\set tenant '<tenant uuid>'
\set from   '<window start, ISO 8601 UTC, e.g. 2026-11-01T00:00:00Z>'
\set to     '<window end, exclusive>'

BEGIN READ ONLY;
SELECT set_config('app.current_tenant_id', :'tenant', true);
```

**Q1 - Every sensitive read in the window (one row per audit row).**

```sql
SELECT created_at, actor_tenant_user_id, module_key, action, resource_type, severity,
       (attributes ->> 'callItemCount')::int AS call_item_count,
       attributes ->> 'reason'               AS reason,
       attributes ->> 'mode'                 AS mode,
       correlation_id
  FROM awcms_audit_events
 WHERE tenant_id = :'tenant'::uuid
   AND created_at >= :'from'::timestamptz AND created_at < :'to'::timestamptz
   AND module_key IN ('hr_payroll', 'hr_commission', 'hr_workforce')
   AND action LIKE 'sensitive\_read.%'
 ORDER BY created_at;
```

**Q2 - Who read how much (per actor and kind).** Rank to find the outlier.

```sql
SELECT actor_tenant_user_id, action,
       count(*)                                                AS audit_rows,
       count(*) FILTER (WHERE severity <> 'info')              AS warning_rows,
       sum((attributes ->> 'callItemCount')::bigint)           AS records_in_rows,
       max((attributes ->> 'windowItemCount')::bigint)         AS peak_window_items,
       max((attributes ->> 'windowReadCount')::bigint)         AS peak_window_reads,
       min(created_at) AS first_seen, max(created_at) AS last_seen
  FROM awcms_audit_events
 WHERE tenant_id = :'tenant'::uuid
   AND created_at >= :'from'::timestamptz AND created_at < :'to'::timestamptz
   AND module_key IN ('hr_payroll', 'hr_commission', 'hr_workforce')
   AND action LIKE 'sensitive\_read.%'
 GROUP BY actor_tenant_user_id, action
 ORDER BY records_in_rows DESC NULLS LAST;
```

`records_in_rows` counts records returned by the calls that wrote a row;
`peak_window_items` and `peak_window_reads` are the running totals of the window at
its last row, and are the better measure of volume for a coalesced window.

**Q3 - Which records were reached (the affected set).** This is the list that
becomes the list of affected employees: the ids are record ids (employment,
compensation, payslip); map them to people **inside the tenant's own system**, not in
the query. It is complete by design: the writer lists every record id it audits.

```sql
SELECT DISTINCT e.action, e.actor_tenant_user_id, rid AS record_id
  FROM awcms_audit_events e
  CROSS JOIN LATERAL jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(e.attributes -> 'resourceIds') = 'array'
              THEN e.attributes -> 'resourceIds' ELSE '[]'::jsonb END) AS rid
 WHERE e.tenant_id = :'tenant'::uuid
   AND e.created_at >= :'from'::timestamptz AND e.created_at < :'to'::timestamptz
   AND e.module_key IN ('hr_payroll', 'hr_commission', 'hr_workforce')
   AND e.action LIKE 'sensitive\_read.%'
 ORDER BY e.action, rid;
```

An **export** row carries a row count and the ids of the records it contained
(`hr-payroll.md` 13.3): an export with a large `callItemCount` and few ids in
`resourceIds` means ids were truncated by the per-row cap and the export spans
several rows sharing the call (`idsChunk`, `idsChunks`); read all chunks.

**Q4 - Payroll actions at `warning` or `critical` (exports, reveals, reversals, locks).**

```sql
SELECT created_at, actor_tenant_user_id, module_key, action, resource_type, resource_id,
       severity, attributes, correlation_id
  FROM awcms_audit_events
 WHERE tenant_id = :'tenant'::uuid
   AND created_at >= :'from'::timestamptz AND created_at < :'to'::timestamptz
   AND module_key = 'hr_payroll'
   AND severity IN ('warning', 'critical')
 ORDER BY created_at;
```

**Q5 - Authorization decisions on the payroll family (allow and deny).**

```sql
SELECT tenant_user_id, module_key, activity_code, action, decision,
       count(*) AS decisions, min(created_at) AS first_seen, max(created_at) AS last_seen
  FROM awcms_abac_decision_logs
 WHERE tenant_id = :'tenant'::uuid
   AND created_at >= :'from'::timestamptz AND created_at < :'to'::timestamptz
   AND module_key IN ('hr_payroll', 'hr_commission', 'hr_workforce')
 GROUP BY tenant_user_id, module_key, activity_code, action, decision
 ORDER BY decisions DESC;
```

A high count of `deny` for one `tenant_user_id` is probing; a high count of `allow`
for one actor on a read action should match Q2.

**Q6 - Identity events in the window (logins, handoffs, access changes).**

```sql
SELECT created_at, actor_tenant_user_id, action, severity, correlation_id
  FROM awcms_audit_events
 WHERE tenant_id = :'tenant'::uuid
   AND created_at >= :'from'::timestamptz AND created_at < :'to'::timestamptz
   AND module_key = 'identity_access'
 ORDER BY created_at;
```

**Q7 - Sessions issued in the window, and which are still live.** Sessions are keyed
by identity; map a `tenant_user_id` to its identity with Q8.

```sql
SELECT s.id, s.identity_id, s.issued_at, s.expires_at, s.revoked_at
  FROM awcms_sessions s
 WHERE s.tenant_id = :'tenant'::uuid
   AND s.issued_at >= :'from'::timestamptz AND s.issued_at < :'to'::timestamptz
 ORDER BY s.issued_at;
```

**Q8 - Map suspect actor ids to identities.**

```sql
SELECT tu.id AS tenant_user_id, tu.identity_id
  FROM awcms_tenant_users tu
 WHERE tu.tenant_id = :'tenant'::uuid
   AND tu.id = ANY (ARRAY['<tenant_user uuid>']::uuid[]);

ROLLBACK;
```

**Cross-checks with other tools.** The same `resourceType` filter is available through
`GET /api/v1/logs/audit` (permission `logging.audit_trail.read`, up to 100 items per
call, newest first, current tenant only) and the admin screen `/admin/audit-trail`;
neither filters by actor or time window, which is why the SQL above is the
investigation path.

**Answering "was it read" negatively.** A negative finding ("no read rows for actor X")
is only as strong as the limits in section 6.1. Write the limits into the finding.

## 9. Triage record (what to capture)

Per incident, in the incident timeline (never in this repository):

- T0, T1, IC, security lead, affected tenant(s), sub-processors involved.
- The signal, the first-pass query results (exported), the containment actions with
  times, and whether a legal hold was placed (hold ids).
- Categories of data in the affected set (compensation, payout account, payslip,
  commission, attendance), the **number of data subjects** (distinct employees
  after mapping Q3 in the tenant's system), the period covered, and whether payout
  account **values** (not only masks) could have been exposed (only a reveal or
  a database-level compromise could).
- What is **not known**, said explicitly.

## 10. Risk assessment worksheet (factual input for the controller)

The operator fills the factual columns; **the controller, with counsel, decides
notifiability.** This runbook does not assert a threshold.

| Question                                                                                              | Answer source                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Was a human or system outside the tenant's authorised staff able to read the data?                    | Q1 to Q7; hosting and database logs                                                                                            |
| Was the data readable (clear) or protected (masked, encrypted)?                                       | Payout accounts: ciphertext plus mask unless revealed (ADR-0137, design); amounts are readable to a reader with the permission |
| Which categories, how many subjects, which period?                                                    | Q3 mapped inside the tenant system                                                                                             |
| Could the data support fraud (payout accounts with names), discrimination, extortion, identity theft? | Controller's judgement                                                                                                         |
| Was the exposure contained, and is it ongoing?                                                        | Section 7 actions and re-run of Q1 after containment                                                                           |
| Were the affected individuals vulnerable (a small team, an easily identified person)?                 | Controller                                                                                                                     |
| Any cross-border element?                                                                             | Addendum B; counsel                                                                                                            |
| Any other regime triggered (section 3)?                                                               | Counsel                                                                                                                        |

Classify, for the internal record only: **Confirmed exposure**, **Possible exposure
(cannot be ruled out)**, **Ruled out** (with the reason and the limits). A "ruled out"
finding is also reported to the tenant if the tenant was told of the suspicion.

## 11. Notification content and templates

Templates are **drafts for counsel**. Placeholders are in angle brackets. Never put
an amount, an account number, a name or a national identifier in any notice. Say
what categories were affected, never the values. Send over a channel the tenant has
named in section 14, not over a channel that may be the compromised one.

### 11.1 Operator to tenant (controller)

> **Subject:** [Security incident - payroll data] <deployment> - <tenant> - ref <incident id>
>
> To: <tenant incident contact>, <tenant data-protection contact, if any>
>
> This is a notice from <operator>, as processor of <tenant>'s payroll data, under
> <reference to processing terms, clause>.
>
> 1. **What happened (facts known at <UTC time>):** <short description>.
> 2. **When:** first indication <T0, UTC>; exposure confirmed or not ruled out
>    <T1, UTC>; period of possible exposure <from> to <to>; ongoing: <yes/no>.
> 3. **Data affected (categories only):** <compensation / payout accounts (masked or
>    clear) / payslips / run lines / commission / attendance>. Approximate number of
>    employees: <n, or "being determined">. Evidence reference: <file ids>.
> 4. **How it was detected and how it was reached:** <audit rows / report / provider>.
> 5. **What we have done:** <containment actions with times>; evidence preserved
>    (legal hold placed: <yes/no>).
> 6. **What we do not yet know:** <list>.
> 7. **What we need from you:** decision on notification to data subjects and the
>    authority (the legal duty is yours as controller); a named contact; <other>.
> 8. **What we will provide:** the query results for your tenant (Q1 to Q8), a
>    timeline, and a written update at <time, at least every 24 hours until closed>.
>
> Contact: <incident commander, channel>. This notice is a statement of facts known at
> the time given and is not legal advice.

### 11.2 Controller (tenant) to data subjects

For the tenant and its counsel to finalise. The content points below follow the
elements the author recalls from the notice duty (section 3, to be confirmed by
counsel): what data, when and how, what was done, what the person can do.

> **Subject:** Notice about your personal data held by <organisation>
>
> We are writing to tell you about an incident that may involve your payroll
> information.
>
> - **What happened:** <plain-language description>, discovered on <date>.
> - **What information:** <categories, for example "your pay level and your payslips";
>   state plainly whether bank or wallet details were involved and whether they were
>   readable or protected>.
> - **When and how:** <period; how the access happened>.
> - **What we have done:** <actions>; <actions to prevent recurrence>.
> - **What you can do:** <watch your account for unusual transactions; contact your
>   bank if your account details were involved; be careful with messages that cite
>   your pay; change your password>.
> - **Who to ask:** <contact, channel, hours>.

### 11.3 Controller (tenant) to the authority

The format, channel and any form are **to be confirmed with counsel** (section 3).
Prepare the facts in this order, which is a superset of what the recalled duty asks
for: controller identity and contact; description and timeline; categories and
approximate number of subjects; likely consequences; measures taken and planned;
whether data subjects have been or will be told, and when; whether other authorities
or third parties were told. Mark as **"initial notice, to be supplemented"** when
facts are still being determined, if counsel confirms that staged notices are
accepted.

### 11.4 Operator to a third party that has its own incident clause

Use the third party's required channel and wording (section 12). Keep it factual:
account or credential involved, time of discovery, containment, contact.

## 12. Obligations to third parties (register pattern)

Some integrations carry their own incident clauses, separate from the law and from
the tenant relationship. The pattern, set by owner decision K15 (22 November
2026), is to keep a **register** of them, to put the clock of each in the incident
timeline at T0, and to name who sends the notice.

| Third party | Clause (verified verbatim by the orchestrator on 22 Nov 2026)                                                                                                                                                                         | Clock    | Contact in the term                    | Who sends                                                   | Triggered by payroll data?                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| LinkedIn    | API Terms of Use (revision 13 December 2022), section 7.1(d): report a security incident to LinkedIn within 24 hours.                                                                                                                 | 24 hours | the security address given in the term | The operator, as holder of the application credential (U15) | **No**, unless a LinkedIn access token or LinkedIn-sourced data is in the exposed set (check Q6 and the connector accounts) |
| Others      | The operator completes this row per enabled connector (payment, messaging, email, marketplace): clause, clock, channel, owner. A connector with **no** clause found is recorded as "none found, checked on <date>", never left blank. | -        | -                                      | -                                                           | -                                                                                                                           |

Rule: the LinkedIn clock and the payroll clock run **independently**. A single
incident can start both. LinkedIn notice content (K15 reading, to be confirmed
by counsel for the tenant relationship): what was exposed of LinkedIn's data and
tokens, time of discovery, containment, contact. Payroll data is **not** shared
with LinkedIn and must never be included in a LinkedIn notice.

## 13. Closure and review

An incident closes when containment is verified (Q1 re-run shows no further
unauthorised reads), recovery is verified (section 7.3), notices are sent or the
controller records why not (with counsel), and the third-party register shows each
clause handled.

Within the proposed 15 working days, hold a **blameless review**: timeline, what
the signals showed and when, what they did not show (section 6.1 limits), whether
the clocks in section 5 were met, and the follow-ups as issues. Record it in the
post-incident log of the deployment. A release that carried a relevant change also
gets its line in [`post-release-reviews.md`](post-release-reviews.md), pointing to
the incident note rather than copying it.

## 14. Contact points (per-deployment template, kept outside the repository)

| Role                           | Name | Channel (primary and fallback) | Hours/escalation | Verified on |
| ------------------------------ | ---- | ------------------------------ | ---------------- | ----------- |
| Operator incident commander    |      |                                |                  |             |
| Operator security lead         |      |                                |                  |             |
| Operator on-call engineer      |      |                                |                  |             |
| Operator legal and contracts   |      |                                |                  |             |
| Tenant incident contact        |      |                                |                  |             |
| Tenant DPO or equivalent       |      |                                |                  |             |
| Tenant legal counsel           |      |                                |                  |             |
| Tenant HR/payroll lead         |      |                                |                  |             |
| Authority notification channel |      | (to be confirmed with counsel) |                  |             |
| Hosting provider security      |      |                                |                  |             |
| Backup provider                |      |                                |                  |             |

Verify the table at least every six months and after every staff change: a
contact that has not been tried is not a contact. Use a channel that does not
depend on the deployment itself (an outage or compromise of AWCMS must not cut the
line to the tenant).

## 15. Exercises and acceptance

### 15.1 Cadence

- A **tabletop exercise** at least **once a year** and **before payroll phase 3 goes
  live** (proposal; the controller may require more).
- A **technical drill** of section 8 (run Q1 to Q8 against a copy, not production)
  after any migration that touches the audit tables, the decision log, sessions
  or the payroll family, and as part of the go-live check of section 1.
- Review the contact table (section 14) every six months; review the legal frame
  (section 3) whenever counsel reports a change in the law.

### 15.2 Tabletop scenario (first exercise)

**Scenario "the export that should not have left".** A tenant's payroll clerk account
runs two `sensitive_read.export` actions at 02:10 and 02:14 UTC on a Sunday, each with
several hundred records, then reads other employees' payslips through
`hr_payroll.payslips.read` (opening a window and reaching the 100-record milestone).
The account's owner says they were asleep. The security lead's first query (Q2) shows
the account at the top; Q6 shows a `login_succeeded` from an unfamiliar network
shortly before. A staff member of the operator also reports that the tenant's HR
director asked yesterday why "the system is slow".

Inject cards, in order, with the questions each must answer:

1. **Detection.** Which signal fired, and who saw it? How long until someone
   acknowledged? (Section 6.1.)
2. **Triage and preservation.** Who is IC? Is a legal hold placed before anything
   else? Whose queries, run as which role? (Section 7.1, 8.)
3. **Containment.** Which action first: revoke all sessions of the user, then set it
   inactive? Does it also stop an attacker already holding a session? (Section 7.2.)
4. **Scope.** Q3 lists 640 record ids. How do they map to employees, and who does
   the mapping? Which of the limits in section 6.1 apply (is the owner's own payslip
   read covered)?
5. **Roles.** Assumption A or B? Who tells whom, and how fast? Who decides whether
   to notify employees and the authority, and who writes to them? (Sections 2, 11.)
6. **Clocks.** Fill the section 5 table with the times from the exercise. Which
   clock is the tightest?
7. **Third parties.** Does the exposed set include a connector credential
   (section 12)? What would be sent, to whom?
8. **Communication.** Draft the section 11.1 notice in 15 minutes; a second person
   reviews it for amounts, names and identifiers (there must be none).
9. **Close.** What would count as closure? What follow-ups would you file?

Observers record: time to each decision, any step that needed a document that does
not exist, any query that did not run, any contact that could not be reached.

### 15.3 Exercise record

| Field                                 | Entry                                                              |
| ------------------------------------- | ------------------------------------------------------------------ |
| Date, duration, facilitator           | **NOT YET HELD.** No exercise has been performed as of this draft. |
| Participants (roles, not names here)  |                                                                    |
| Scenario used                         | 15.2 (first exercise)                                              |
| Times achieved vs section 5 proposals |                                                                    |
| Gaps found (issue numbers)            |                                                                    |
| Changes made to this document         |                                                                    |
| Next exercise due                     |                                                                    |

The acceptance item "a tabletop exercise recorded" of #1448 is satisfied **only
when this table is filled for a real exercise.** The scenario and the record format are
here; the exercise needs the operator and the tenant's people in a room, which an
agent cannot hold.

### 15.4 Go-live checklist items this runbook adds

- [ ] O5 decided; processing terms carry the operator clock (section 5) or a
      replacement (#1449).
- [ ] Counsel has confirmed section 3 line by line and filled the "verify with counsel" cells.
- [ ] Section 14 filled for the deployment, tried, and dated.
- [ ] Section 8 queries re-run on a database with the payroll module enabled, output compared with this
      document; the payout-account reveal audit action name added to Q4 or Q1.
- [ ] `payroll:catalog-boundary:check` scheduled by the operator (K3) with its dedicated role, and
      `security:readiness` run as the application role on a schedule.
- [ ] First tabletop exercise held and recorded (section 15.3).

## 16. Sign-off (owner decision K13)

Accountability under UU PDP cannot be delegated to an agent. This document has no
legal effect until the controller and counsel sign here.

| Field                                                 | Entry |
| ----------------------------------------------------- | ----- |
| Name of the controller's representative               |       |
| Name of legal counsel                                 |       |
| Date of review                                        |       |
| Decision (approve / approve with conditions / reject) |       |
| Conditions                                            |       |
| Platform operator representative (for section 5)      |       |

## 17. Items flagged "verify with counsel" (collected)

1. Article 46 of UU 27/2022 and the **3 x 24 hours** period, the trigger for counting it,
   the content of the notice (quoted from the author's recollection of the official text).
2. Public notice in cases of disrupted public service or serious public interest.
3. Whether a **processor** has a direct, time-bound duty to notify.
4. The authority: whether it is constituted, the notification channel and form.
5. Whether staged or initial notices are accepted.
6. Whether a data-protection officer is mandatory for the deployment.
7. Article numbers for security safeguards, confidentiality, and the consequences of
   failing to notify.
8. Other regimes triggered by payroll data (tax, social security, labour, sector,
   financial regulator, foreign law).
9. Whether a given incident is **notifiable** (the risk threshold).
10. The reading of third-party clauses (section 12) for the tenant relationship (K15).

## 18. References

`dpia-hr-payroll-phase-3.md` (draft, PR #1451, R-12);
[`hr-payroll.md`](hr-payroll.md) 11.3, 13.2, 13.3, 14, 17 (L-P9, O5, PS-18);
[`privacy-analysis.md`](privacy-analysis.md); [`data-lifecycle.md`](data-lifecycle.md);
[`../adr/0137-payout-account-encryption-at-rest-and-keyed-hashing.md`](../adr/0137-payout-account-encryption-at-rest-and-keyed-hashing.md);
`src/modules/logging/application/sensitive-read-audit.ts`;
`src/modules/_shared/sensitive-reads.ts`; `sql/007`, `sql/005`, `sql/224`, `sql/408`;
owner decisions K3, K13, K15 (22 November 2026); issue #1448.
