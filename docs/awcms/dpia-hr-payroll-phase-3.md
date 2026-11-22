🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](dpia-hr-payroll-phase-3.id.md)

# DPIA (DRAFT) — HR payroll phase 3 (`hr_payroll`)

> **STATUS: DRAFT — not approved; awaiting the signature of the data controller
> and review by legal counsel.** This is not a completed or approved DPIA. It is
> an agent-prepared draft (owner decision K13, 22 November 2026): accountability
> under UU PDP (Law No. 27 of 2022) cannot be delegated to an agent, so the
> document has no legal effect until the controller completes section 7. It is
> not legal advice. **Issue #976 stays open and #957 stays blocked** until it is
> signed.

| Field               | Entry                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document            | Platform-level DPIA, **document (A)**, of the phase 3 design (decision-support comment on #976, section 1)                                                                            |
| Drafted             | 22 November 2026, by an AI agent on the repository state of `main` at commit `16c8ebcd`                                                                                               |
| Method              | ISO/IEC 29134 structure, mapped to the UU PDP impact-assessment duty. Article numbers are quoted only where the author is confident; every other reference says "verify with counsel" |
| Document (B)        | The per-deployment addendum is **not written here**; its template and go-live gate are tracked in #1449                                                                               |
| Scope               | Compensation, payout accounts, payslips, withholding and contribution data, read paths, retention posture                                                                             |
| What exists in code | **`hr_payroll` has no table, route or migration yet.** Controls below are marked _in code_ only when they exist on `main` today; the rest are _designed_ or _planned_                 |

**Reading rule.** "In code" means a file, test or gate in this repository that a
reader can run. "Designed" means decided in an ADR or in
[`hr-payroll.md`](hr-payroll.md) but not built. A designed control is not
evidence of protection.

## 1. Description of the processing

### 1.1 Purpose and lawful basis

| Item            | Draft statement                                                                                                                                                                                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose         | Pay employees and workers correctly and on time; compute and record withholding and contributions the employer owes; give each person their own payslip; keep an auditable, correctable record (`hr-payroll.md` 2.3, 7).                                                                             |
| Candidate basis | The employment relationship and the employer's legal obligations (labour, tax, social security). **Consent is not the proposed basis**: an employee cannot freely refuse (ADR-0138 reasons the same way). Which UU PDP basis applies, and whether any category needs another, is for counsel (L-P2). |
| Not purposes    | Performance scoring, profiling, marketing, AI training, sale or sharing with third parties. No AI or Hermes context receives payroll data (AI is read-only and has no payroll context).                                                                                                              |

### 1.2 Data subjects and data categories

Subjects: employees and workers of a tenant (tenant users linked to an
employment, ADR-0094 decision 1). Sources: the tenant's HR staff, phase 1
(`hr_workforce`) and phase 2 (`hr_commission`) data.

| Category                                               | Examples                                                  | Where it lives                                               | Classification (draft)                                                                            |
| ------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Identity reference                                     | opaque `profile_id`                                       | `awcms_hr_employments` (composite FK)                        | General. **No name, NIK, NPWP, contact or address in any HR table** (ADR-0132 section 2)          |
| Employment and attendance                              | employee number, terms, attendance minutes                | `hr_workforce` tables (landed)                               | General                                                                                           |
| Compensation                                           | pay basis, base amount, effective dates                   | `awcms_hr_compensation` (designed)                           | **Personal financial data; likely specific personal data** (see 1.3)                              |
| Payout account                                         | bank or wallet reference                                  | `awcms_hr_payout_accounts` (designed, ADR-0137)              | **Personal financial data; likely specific personal data**; ciphertext + keyed hash + mask        |
| Run lines, payslips                                    | earnings, deductions, withholding, employer contributions | `awcms_hr_payroll_run_lines`, `awcms_hr_payslips` (designed) | Personal financial data                                                                           |
| Tax identifiers used by a run                          | NIK, NPWP                                                 | `profile_identity` only; resolved server-side when needed    | Personal identifier; never copied (`hr-payroll.md` 3, 11.2)                                       |
| Commission accruals (phase 2, landed)                  | accrual amount, rule version, source reference            | `awcms_hr_commission_accruals`                               | Personal financial data; `payroll-boundary` marker (`sql/311`)                                    |
| Audit and read-audit rows                              | actor, permission, record ids, counts                     | audit log, `awcms_sensitive_read_windows` (`sql/224`)        | Ids and counts only, by construction                                                              |
| Health, biometric, geolocation, photo, device evidence | not collected by payroll                                  | not in phase 3                                               | Out of scope; geolocation attendance evidence is ADR-0138 (own per-tenant DPIA, do not duplicate) |

### 1.3 Specific personal data

UU PDP distinguishes general from **specific** personal data and lists
**personal financial data** among the specific categories (Art. 4; **verify with
counsel**, as the decision-support comment on #976 asks). `hr-payroll.md` 13.2
names only health, biometric and geolocation as specific data and does not name
financial data: **if counsel confirms, section 13.2 must be corrected** (the
correction is part of the checklist in section 7, item 9). Until confirmed, this
draft treats salary, payout accounts and withholding data as specific personal
data, the cautious reading. Processing specific personal data is one of the
high-risk indicators that make an impact assessment mandatory (Art. 34; verify).

### 1.4 Art. 34 high-risk indicator check (for the DPO to confirm)

| Indicator                                        | Phase 3               | Note                                                                       |
| ------------------------------------------------ | --------------------- | -------------------------------------------------------------------------- |
| Automated decision with significant legal effect | Probably no           | Calculations are deterministic and approved by humans (SoD, ADR-0132/0136) |
| Specific personal data                           | **Likely yes**        | Personal financial data (1.3)                                              |
| Large scale                                      | Depends on the tenant | Per-deployment addendum (#1449)                                            |
| Systematic evaluation or monitoring              | Possible              | Attendance minutes feed pay; no scoring (`workforce-metrics.md`)           |
| Matching or combining datasets                   | Possible              | HR + commission + payroll are linked by employment id by design            |
| New technology                                   | No                    | Standard components                                                        |
| Restriction of subject rights                    | Possible              | Erasure limited by retention (2.4)                                         |

Conclusion for the draft: **a DPIA is required**, not optional.

### 1.5 Roles: controller and processor (O5 stays open)

Owner decision O5 (is the platform operator controller, processor or both, **per
deployment**) is **still open** (`hr-payroll.md` 16). The draft assumption, for
discussion only: each **tenant** is the controller of its employees' data (the
reasoning of ADR-0094 decision 1 and of ADR-0138); the **operator** is a
processor for tenant payroll data and may be a controller for its own account,
security and audit data. Consequences that wait for O5: who answers subject
requests, who signs processing terms, who notifies a breach, who holds the
per-deployment addendum. Tracked in #1449. This draft does not decide O5.

Other parties: hosting and backup providers (sub-processors; cross-border
position, section 3.4); no payment provider, no bank file and no outbound
transfer of an account number exists or is decided (ADR-0137 section 7: a later
issue, through the outbox, never inside a transaction).

### 1.6 Data flow (text diagram)

```
Employee / HR staff  --TLS-->  Astro + API (awcms_app role, tenant context set)
                                   |  authorizeInTransaction (RBAC+ABAC default-deny, step-up where enrolled)
                                   v
                       PostgreSQL (FORCE RLS per tenant; payroll tables granted to awcms_app only)
                         |            |                     |
                         |            |                     +--> backups (encrypted, ADR-0123; payout keys held outside DB and backups)
                         |            +--> audit log: ids, counts, permission names (no amounts)
                         +--> domain-event outbox: ids/kinds/counts (no amounts, no names)
                                   |
                                   +--> payslip NOTICE by email/push: no amount (hr-payroll.md 11)
FORBIDDEN derived paths: reporting projections, site search, comments, edge cache,
report exports, AI/Hermes context, sync to offline nodes, worker role (awcms_worker).
```

Payout account numbers are decrypted only in memory by an audited reveal
(ADR-0137 section 4); no bank file or provider call exists.

## 2. Necessity and proportionality

### 2.1 Minimisation (in code or designed)

- No identity fields in any HR table; NIK and NPWP stay in `profile_identity`
  (designed, ADR-0132 section 2; the phase 1 tables in code follow it).
- No health reason (time-off kind is coarse), no photo, biometric or device
  evidence ever (O6); geolocation is verdict-only, off by default (ADR-0138,
  implemented by #970, `sql/306`).
- Events, audit rows and payslip notices carry ids, kinds and counts, never an
  amount (`hr-payroll.md` 10, 11.3).
- Payroll boundary prevents a second, wider copy: no projection, search index,
  comment, cache entry or export of payroll tables (`payroll-data-boundary.ts`,
  section 4).

### 2.2 Accuracy

Effective-dated, append-only compensation versions; rule versions immutable once
published; finalized runs immutable and corrected by reversal (`hr-payroll.md`
7.1 to 7.4, designed). Reading attendance and commission as snapshots on the
lines means a later correction flows to the next period. The risk of a wrong rule
transcription remains (R-15).

### 2.3 Retention

**No statutory period is asserted anywhere in the repository.** Posture today:
phase 1 attendance and shift history are bounded by a `data_lifecycle`
descriptor; financial rows (accruals, and planned phase 3 rows) are retained for
the life of the tenant, and `hr_commission` deliberately declares no retention
descriptor for them because none would be true (`src/modules/hr-commission/module.ts`;
the reasoned `BOUNDED_BY_DESIGN` entries for `awcms_hr_commission_accruals` and
`_transitions` in `scripts/data-lifecycle-table-coverage-check.ts`). Counsel
must fix the period per record class and decide whether a purge route must exist
before the first run (L-P5, L-P6). Residual R-07, #1447.

### 2.4 Data-subject rights

| Right                      | How phase 3 answers it                                                                                                                                                                                                                                                       | Status                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Access, portability        | The `subject-data` export, answered **per tenant** (ADR-0094 decision 1) with masked values; payroll-boundary tables export behind their own gate and the export's stored report keeps ids and a marker, never earnings (#1018, `tests/subject-export-payroll.test.ts`)      | In code for the framework; phase 3 descriptors designed |
| Rectification              | Append a new effective-dated version or reverse a run; history is not edited, so the audit trail stays valid; the immutable payslip does not rewrite (L-C2)                                                                                                                  | Designed; counsel to confirm L-C2                       |
| Erasure                    | Limited by legal retention: the profile is **anonymised**, HR and payroll rows remain and resolve to the anonymised profile (ADR-0094 decision 2, `retain_under_obligation`); deletion is maker/checker and audited `critical` (ADR-0094 decision 3). Backups age out (L-P8) | Framework in code; posture for counsel (L-P7)           |
| Objection, restriction     | Process to be defined by the controller; no technical switch exists for payroll                                                                                                                                                                                              | Open: addendum (B), #1449                               |
| Notice to the data subject | Employee notice of purposes, categories, retention, rights: adequacy for counsel (L-P11)                                                                                                                                                                                     | Open: #1449                                             |

## 3. Risk assessment

### 3.1 Scale

Likelihood L and impact I each 1 (rare / minor) to 5 (almost certain / severe
harm to a person: fraud, discrimination, loss of livelihood, exposure of
financial position). **Score = L x I.** 1-5 low, 6-11 medium, 12-19 high, 20-25
critical. The scale and every score are the author's **draft proposal**; the DPO
fixes the scale and may change any score. "Inherent" assumes the phase 3 design
exactly as written but **no control built**; "residual" assumes the controls
marked _in code_ plus the _designed_ controls implemented as written.

### 3.2 Risk register

| Id   | Risk                                                                                                                         | Inherent L x I | Residual L x I | Treatment                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------- | ------------------------------------------------------------ |
| R-01 | Unauthorised read of compensation or lines by a holder of a wide read permission (PS-06, PS-18)                              | 4 x 5 = 20     | 2 x 5 = 10     | Mitigate (4.1, 4.2); PS-06 split still to be designed        |
| R-02 | Cross-tenant access to pay data                                                                                              | 2 x 5 = 10     | 1 x 5 = 5      | Mitigate (RLS, 4.1)                                          |
| R-03 | Insider fraud: payee approves own pay, runs and pays alone, swaps payout account before payment (PS-01, PS-02, PS-03, PS-12) | 3 x 5 = 15     | 2 x 5 = 10     | Mitigate (designed SoD; not built)                           |
| R-04 | Audit trail incomplete or tamperable; bulk harvesting through reveal or paged reads                                          | 3 x 4 = 12     | 2 x 4 = 8      | Mitigate (4.2)                                               |
| R-05 | Unattended job or worker role reaches payroll data                                                                           | 3 x 5 = 15     | 1 x 5 = 5      | Mitigate (4.1)                                               |
| R-06 | Salary copied to a derived surface: projection, search, comment, cache, export, CSV formula injection                        | 3 x 5 = 15     | 2 x 5 = 10     | Mitigate (4.1); residual #1095                               |
| R-07 | Retention longer than lawful, or no purge route (PS-17)                                                                      | 4 x 3 = 12     | 4 x 3 = 12     | **Open: #1447**                                              |
| R-08 | Full response body stored in `awcms_idempotency_keys` for the retention window echoes earnings                               | 3 x 4 = 12     | 3 x 4 = 12     | **Open: #1450** (commission masked, PR #1439 in review)      |
| R-09 | Money, account numbers or identifiers in logs, error messages, audit rows, events                                            | 3 x 4 = 12     | 3 x 4 = 12     | **Open: #1450** (phase 3 canary test)                        |
| R-10 | Mutation responses return earnings to a caller who only needed an acknowledgement                                            | 3 x 4 = 12     | 3 x 4 = 12     | **Open: #1450** (commission: PR #1439)                       |
| R-11 | Operator staff (platform or hosting) access tenant payroll data without defined terms; O5 unresolved                         | 3 x 5 = 15     | 3 x 5 = 15     | **Open: #1449**                                              |
| R-12 | Breach of payroll data not detected or not notified in the required period                                                   | 3 x 5 = 15     | 3 x 5 = 15     | **Open: #1448**                                              |
| R-13 | Cross-border processing by hosting or backup providers without a lawful transfer position (L-P10)                            | 3 x 4 = 12     | 3 x 4 = 12     | **Open: #1449** (addendum B)                                 |
| R-14 | Loss or theft of backups holding payout accounts; restore without keys; key-ring loss makes accounts unreadable              | 3 x 5 = 15     | 2 x 5 = 10     | Mitigate (4.1, ADR-0137 section 6); drill #968               |
| R-15 | Incorrect calculation harms employees (rule-data error, rounding, currency mismatch; PS-07 to PS-09)                         | 3 x 4 = 12     | 2 x 4 = 8      | Mitigate (designed); counsel L-A, L-D                        |
| R-16 | Subject request mishandled (erasure vs retention; per-tenant answering; payslip not rewritten)                               | 3 x 3 = 9      | 2 x 3 = 6      | Mitigate (2.4); L-P7                                         |
| R-17 | Residual gaps of the payroll boundary, #1095 residuals 1 to 7 ("narrowed, not closed")                                       | 2 x 5 = 10     | 2 x 5 = 10     | **Accept with review**, tracked in #1095 and #1436 (see 5.2) |

Residual scores that rest on a _designed_ control are conditional: if the control
is not built as written, the residual equals the inherent score. R-07, R-08,
R-09, R-10, R-11, R-12 and R-13 have **no residual reduction yet** and are the
risks that must have a treatment accepted by the controller before go-live.

## 4. Controls

### 4.1 Controls in code today (verified on `main`, 22 November 2026)

| Control                                                                | Evidence                                                                                                                                                                                                                                                       | Risks            |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Forbidden derived surfaces for payroll tables and events               | `src/modules/_shared/payroll-data-boundary.ts` (single list; enforced by the reporting, site-search, comments, edge-cache registries and report export); `tests/payroll-data-boundary.test.ts`                                                                 | R-06, R-01       |
| Only the request role may touch payroll-family tables                  | `PAYROLL_ALLOWED_GRANTEES = ["awcms_app"]` in `payroll-data-boundary.ts`; checked by `bun run payroll:sql-boundary:check` (migrations) and `bun run payroll:catalog-boundary:check` (catalog); `sql/311` boundary markers                                      | R-05, R-17       |
| Payroll tables forced to the boundary by name and by marker            | `scripts/lib/payroll-catalog-boundary.ts`; `tests/payroll-catalog-boundary.test.ts`, `tests/payroll-catalog-boundary-1077.test.ts`, `tests/payroll-name-exceptions-1276.test.ts`                                                                               | R-17             |
| Sensitive-read audit, fail-closed, rate-aware, ids and counts only     | `src/modules/logging/application/sensitive-read-audit.ts`, window counter `sql/224`, `tests/integration/sensitive-read-audit.integration.test.ts`; fail-closed route fixture `tests/fixtures/sensitive-read-fail-closed.ts` (`expectAuditFailureYieldsNoData`) | R-01, R-04       |
| Gate that a guard on a sensitive permission calls the audit            | `bun run sensitive-reads:check` (`src/modules/_shared/sensitive-reads.ts`, default-deny over every non-write action of a sensitive module, with `NOT_SENSITIVE_READS` reasons)                                                                                 | R-01, R-04       |
| Subject export never stores earnings in the replay cache               | `tests/subject-export-payroll.test.ts` (Issue #1018)                                                                                                                                                                                                           | R-08, R-16       |
| Idempotency keys purged on a schedule                                  | `domain_event_runtime.idempotency_keys` descriptor in `src/modules/domain-event-runtime/module.ts` (30 days default, floor 7, ceiling 90), grant in `sql/276`                                                                                                  | R-08 (bounds it) |
| CSV formula neutralisation for every CSV writer                        | `src/lib/security/csv-formula.ts`, structural scan `tests/csv-formula-neutralisation.test.ts`                                                                                                                                                                  | R-06             |
| Field encryption primitive for payout accounts                         | `src/lib/security/field-encryption.ts` (AES-256-GCM, key ring, length-prefixed AAD over purpose, tenant and row id; separate keyed hash ring; ADR-0137 implementation note). **The payout-account table that uses it does not exist.**                         | R-14 (partial)   |
| Tenant isolation: FORCE RLS, composite FKs, role separation            | the `sql/` RLS policies and `bun run security:readiness` (readiness pins policies and roles by canonical expression); `tests/security-readiness-rls.test.ts`. Applies to the phase 1 and 2 tables in code                                                      | R-02             |
| Subject-data and lifecycle coverage per table, gated                   | `subjectData` and `dataLifecycle` descriptors (for example `src/modules/hr-commission/module.ts`), `bun run data-lifecycle:*` coverage gates (ADR-0094; PS-17 requires one per phase 3 table in its migration)                                                 | R-16, R-07       |
| Geolocation evidence off by default, verdict-only, own per-tenant DPIA | ADR-0138, `sql/306` (not duplicated here)                                                                                                                                                                                                                      | scope            |
| Step-up where an MFA factor is enrolled                                | `requireStepUp` (`mfa-session-assurance.ts`), applied to sensitive actions by ADR-0141 section 4. Not unconditional: a holder without an enrolled factor is not stopped (PS-13)                                                                                | R-03, R-04       |

### 4.2 Controls designed, not built (do not count as protection yet)

| Control                                                                                                                                                             | Where decided                                         | Needed for | Risks        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------- | ------------ |
| Payout account: ciphertext, keyed HMAC, mask, audited reveal (`warning`), conditional step-up                                                                       | ADR-0137, ADR-0141; #959                              | #959       | R-01, R-14   |
| SoD calculate / approve / pay in the database, configurable per tenant; payee never the actor (PS-01)                                                               | ADR-0132, ADR-0136; `hr-payroll.md` 7.5               | #957, #960 | R-03         |
| Approval bound to the reviewed calculation (`calculation_revision`, `totals_digest`, PS-03)                                                                         | `hr-payroll.md` 7.5, 9                                | #957, #960 | R-03         |
| Paid-run reversal and recovery without double payment (PS-02)                                                                                                       | ADR-0136 Amendment A1 (**Proposed**) and counsel L-C3 | #957       | R-03, R-15   |
| Split read permissions: totals without per-employee lines (PS-06). **Finding only: 11.1 still lists one `runs.read`; the split is not yet written into the design** | `hr-payroll.md` 17.2 (PS-06)                          | #957, #961 | R-01         |
| Immutable finalized runs, period lock, reversal-only correction                                                                                                     | `hr-payroll.md` 7.2, 7.4                              | #957, #960 | R-03, R-15   |
| Rule versions immutable, maker/checker, citation required (PS-07 to PS-09)                                                                                          | `hr-payroll.md` 7.3                                   | #958       | R-15         |
| Payslip owner link guarded (self-link refused, re-link audited; PS-14)                                                                                              | `hr-payroll.md` 7.5, 9                                | #957, #961 | R-01         |
| Large-run bounds, pagination (PS-16)                                                                                                                                | `hr-payroll.md` 14                                    | #960       | availability |
| Backup and restore drill including restore without the key ring                                                                                                     | #968; ADR-0137 section 6; ADR-0123                    | #968       | R-14         |

### 4.3 Planned in review

PR #1439 (open, **not on `main`**, so not counted in 4.1) masks the commission
accrual mutation results with an allow-list receipt, stores the masked body in
the idempotency row, and adds a daily catalog-boundary job under a
privilege-free dedicated role. When merged it reduces R-08 and R-10 **for
`hr_commission` only** and strengthens R-17. `hr_payroll` still needs the same
pattern (#1450).

## 5. Residual risks

### 5.1 Residual risks with their issues

| Risk                                                                     | Issue                                                                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| R-07 retention and purge route                                           | **#1447** (new)                                                                                  |
| R-12 breach notification                                                 | **#1448** (new)                                                                                  |
| R-11 operator access and O5; R-13 transfers; addendum (B) and gate       | **#1449** (new)                                                                                  |
| R-08, R-09, R-10 stored bodies, logs, mutation receipts for `hr_payroll` | **#1450** (new)                                                                                  |
| R-14 backup, restore, key custody                                        | #968 (existing)                                                                                  |
| R-03 insider fraud (PS-01 to PS-03, PS-12), R-01 (PS-06)                 | #957, #959, #960 (existing, blocked by this DPIA); ADR-0136 Amendment A1 awaiting the maintainer |
| R-15 rule-data error                                                     | #958; counsel checklist 17.3 A and D                                                             |
| R-16 subject requests                                                    | counsel L-P7, L-C2; per-tenant answering is in code (ADR-0094)                                   |
| R-17 payroll boundary residuals                                          | #1095 and #1436 (see 5.2)                                                                        |

### 5.2 #1095 residuals 1 to 7, restated as privacy risk

The boundary (static migration scan plus catalog check) is **defence in depth
against accidental or obvious leaks**; migration review (CODEOWNERS plus a
security review for `sql/` touching payroll) is the primary control. The
residuals are "narrowed, not closed" and are **accepted with review**, not
accepted as closed, for this draft:

1. A reviewed migration can rebuild a payroll table behind unmodelled
   constructs; the catalog layer detects leftovers but does not prevent them.
2. Finite helper lists: an unlisted function that runs a query text is a hole
   until listed.
3. A non-family table with RLS off and grants to `awcms_worker` or `PUBLIC` is
   flagged only if it looks like a payroll table (70% column overlap, at least 5
   columns).
4. A rebuild changing more than 30% of the ledger's columns evades the look-alike
   check.
5. Out of scope by design: logical replication slots are not read; a superuser
   is trusted by definition.
6. Extension members are not read; only `ALTER EXTENSION ... ADD` is refused.
7. The audit-call check's dead-branch limit is unchanged.

Tracking: #1095 stays open for these; the direction from deny-list scanning to
allow-lists is #1436. PR #1439 adds a scheduled catalog check and is the owner's
decision K3 on #1095's two open decisions. The DPIA reviewer should note that
residuals 5 and 6 are inherent (trusting the database owner and superuser) and
fall under the operator-access risk R-11, which no scanner can close.

## 6. Consultation

| Who                                            | Purpose                                                                                                                                                                                             | Status                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Data-protection officer (or designated person) | Fix the scale, confirm scores, answer the high-risk check (1.4), confirm the DPO requirement                                                                                                        | **Not yet consulted** (L-P10)                       |
| Legal counsel                                  | The legal checklist `hr-payroll.md` 17.3 (A to E), financial data as specific data (L-P3), retention (L-P5, L-P6), erasure (L-P7), backups (L-P8), breach (L-P9), transfers (L-P10), notice (L-P11) | **Not yet consulted**; sign-off block 17.4 is blank |
| Employees or their representatives             | Where the controller decides it is appropriate (ISO/IEC 29134)                                                                                                                                      | Controller's decision                               |
| Security                                       | Independent review of this register against the code                                                                                                                                                | Recommended before signature                        |

Evidence location: this repository (`docs/awcms/`) unless counsel prefers a
private location; if private, record the hash and reference in `hr-payroll.md`
17.4.

## 7. Decision and sign-off (left blank on purpose)

**Not completed, not approved.** The controller may approve, approve with
conditions, or not approve. Review cycle proposed: on any change to data
categories, a new processor, a new jurisdiction profile, a breach, or at least
once a year.

| Field                                                         | Entry |
| ------------------------------------------------------------- | ----- |
| Name of the data controller's representative                  |       |
| Position                                                      |       |
| Date                                                          |       |
| Decision (approved / approved with conditions / not approved) |       |
| Conditions or required changes (each to become an issue)      |       |
| Residual risks accepted (list ids)                            |       |
| Name and position of the DPO or advisor consulted             |       |
| Name of the legal counsel who reviewed                        |       |
| Signature                                                     |       |

Checklist (from the decision-support comment on #976), none answered by this draft:

- [ ] O5 decided for the reference deployment (#1449).
- [ ] Legal basis per category (L-P2); financial data classification (L-P3).
- [ ] Retention in years per record class (L-P5); archive-then-purge accepted or a purge route required (L-P6) (#1447).
- [ ] Erasure (L-P7) and backup (L-P8) posture accepted.
- [ ] Breach duty, period and notifier (L-P9) (#1448).
- [ ] Hosting location, cross-border position, DPO requirement (L-P10).
- [ ] Employee notice adequate (L-P11).
- [ ] This DPIA signed; residual risks above accepted or treated.
- [ ] Evidence location recorded in `hr-payroll.md` 17.4.
- [ ] Per-deployment addendum template published and made a go-live gate (#1449).
- [ ] `hr-payroll.md` 13.2 corrected if counsel confirms financial data is specific data.
- [ ] Counsel confirms that treating the DPIA as document (A) plus per-deployment addendum (B) satisfies the intent of the statute; if not, the gate in #957 stays as written.

## 8. Sources

[`hr-payroll.md`](hr-payroll.md) (2.3, 7, 10, 11, 13.2, 13.3, 16 O5, 17 PS-04 and the
17.3 checklist); ADR-0132, ADR-0136, ADR-0137, ADR-0138 (geolocation DPIA per tenant,
not duplicated), ADR-0141, ADR-0094, ADR-0123; Issue #976 and its decision-support
comment; PR #1439 and Issue #1095. UU PDP article numbers: verify against the
official text on JDIH with counsel.
