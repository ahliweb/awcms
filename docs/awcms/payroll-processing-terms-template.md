🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](payroll-processing-terms-template.id.md)

# Payroll processing terms — template (controller and operator)

> **STATUS: TEMPLATE, not a contract and not legal advice.** It is a structure for
> counsel to turn into an agreement, nothing more (owner decision K13). It does
> **not** decide owner decision **O5** (the legal role of the operator per
> deployment): it carries both outcomes, **variant A** and **variant B**, and the
> deployment keeps the one its addendum records. Any legal point the author is not
> sure of is marked **verify with counsel**; no statute article is quoted as
> fact. Issue #1449, DPIA residual R-11; companion of
> [`dpia-addendum-hr-payroll-template.md`](dpia-addendum-hr-payroll-template.md)
> and of the operational numbers in
> `payroll-breach-notification-runbook.md` (draft, section 5).

Square brackets in `[[...]]` are blanks to fill. This file is a template: nothing
in the repository reads it.

## 0. Which variant

| Variant | When it applies                                                                             | Operator is                                  |
| ------- | ------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **A**   | The tenant decides purposes and means; the operator only runs the platform for it.          | Processor of tenant payroll data             |
| **B**   | The operator also decides some purpose or means for payroll data, or the DPIA concludes so. | Joint controller, or the role the DPIA finds |

The deployment's addendum, section 1, records which one applies. Counsel decides
whether a mixed case needs both.

## 1. Parties and subject matter

- Controller: [[tenant legal entity]] ("the Tenant"). Operator: [[operator legal entity]] ("the Operator").
- Subject matter: the Operator makes the AWCMS payroll module available to the
  Tenant. Categories of data and of data subjects are those of the addendum,
  sections 2 and 3. Duration: the term of the service agreement plus the periods
  in section 9.

## 2. Instructions and purpose limitation

**Variant A.** The Operator processes tenant payroll data only on the Tenant's
documented instructions (this agreement and the Tenant's use of the product), for
the purposes in the addendum, and for no other: no profiling, scoring, marketing,
AI training or sale. The Operator tells the Tenant at once if it believes an
instruction breaches the law (**verify with counsel** whether and how UU PDP
requires this).

**Variant B.** Each party's purposes and means are allocated in the table in the
addendum, section 1. The essence of the arrangement is made available to data
subjects (**verify with counsel** whether UU PDP requires this and in what form).

## 3. Operator staff access (the R-11 clause)

This clause makes the addendum's section 7 binding.

1. **No standing access.** No Operator personnel has standing access to the
   Tenant's payroll data. Application roles of the Operator's staff, including
   those in the platform tenant, carry no payroll permission for the Tenant.
2. **Break-glass only.** Direct access to payroll rows (database, backup restore,
   hosting console) is allowed only to [[purpose: restore, repair, incident response]], by [[named roles]], with approval by [[role]] and a second person
   present or reviewing, for the shortest time needed.
3. **Recorded.** Each such access is recorded outside the application: who, when,
   why, what was touched (counts, never amounts or account numbers), the approver,
   and the ticket. The record is kept [[period]] and shown to the Tenant on
   request. If the deployment has no such recording, the addendum says "not
   configured" and this clause is **not** claimed as met.
4. **Notice.** The Tenant is told [[before / within N hours after]] any access
   under item 2 (variant A: because it is the Tenant's data; variant B: for the
   part the Tenant controls).
5. **Confidentiality.** Personnel with possible access are bound by a written
   confidentiality undertaking that survives their engagement.
6. **Review.** The list of roles with access is reviewed [[cadence]] and after any
   staff change in those roles.
7. **What the product itself enforces** (verified in the repository at the time of
   writing): payroll tables are granted to the request role only; row-level
   security is forced and tenant-scoped; payroll permissions are tenant-scoped; a
   read through the application leaves a sensitive-read audit row. These do not
   bind a database administrator, which is why items 2 to 4 exist.

## 4. Security measures

The Operator maintains the measures in `docs/awcms/20_threat_model_security_architecture.md` and the
deployment's readiness gate (`bun run security:readiness` is green), including
encryption of payout account ciphertext with the deployment's key ring and the
data boundary that keeps payroll out of reports, search, public caches and
messaging channels. The Operator does not weaken them without telling the Tenant.
Additional measures agreed: [[list or "none"]].

## 5. Sub-processors

The Operator uses only the sub-processors listed in the addendum, section 5.
**Variant A:** it tells the Tenant [[N days]] before adding or replacing one and
the Tenant may object [[consequence]]; each sub-processor is bound to obligations
no weaker than these terms; the Operator remains answerable for it (**verify with
counsel** the exact requirements under UU PDP).

## 6. Transfers

Payroll data is stored and accessed only in [[country or countries]]. Any change,
including backup location and support access from elsewhere, needs the Tenant's
prior written agreement and a lawful transfer position recorded in the addendum,
section 6 (**verify with counsel**, L-P10).

## 7. Data-subject requests

**Variant A.** The Tenant answers requests. The Operator forwards one it receives
within [[N working days]] without answering it, and supplies the data or the
audit extract the Tenant needs, within [[N working days]]. The product's
subject-data export is per tenant (ADR-0094) and keeps earnings out of the
stored report.

**Variant B.** Requests are answered as allocated in the addendum, section 1; the
Operator's own part is answered by the Operator.

## 8. Breach notification

The statutory duty and clock rest with the controller (the runbook, section 3,
records what is and is not asserted; **verify with counsel**). The Operator's
operational commitments, which this clause fixes or replaces with the agreed
numbers:

| Step                                                                    | Commitment                                                                                          |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Heads-up to the Tenant once exposure of its payroll data is plausible   | as soon as practicable, and in any case within [[hours]]                                            |
| Notice to the Tenant after exposure is confirmed or cannot be ruled out | within [[hours; the runbook proposes 24 hours from confirmation]]                                   |
| Content of the notice and the evidence provided                         | as in the runbook, section 11.1 and section 8                                                       |
| Contacts on each side                                                   | [[named roles and channels]]                                                                        |
| Who sends notices to data subjects and the authority                    | **A:** the Tenant, unless it instructs the Operator in writing. **B:** each party for its own part. |
| Costs of notification                                                   | [[allocation]]                                                                                      |

The runbook is a draft until the controller adopts it; adopting it is a
condition of go-live (addendum, section 11).

## 9. Return and deletion

At the end of the service, or on the Tenant's written request, the Operator
[[returns / deletes]] the Tenant's payroll data within [[period]], subject to the
retention the addendum (section 4) records and to any legal hold. Backups age out
within [[period]]. The Operator confirms in writing. **Verify with counsel** how
legal retention duties of the Tenant interact with deletion (L-P7, L-P8).

## 10. Audit and information

The Operator makes available what is needed to show compliance with these terms
and allows reasonable audits by the Tenant or an auditor it appoints:
[[frequency, notice, cost, scope]]. Evidence the product can produce (the audit
trail, the sensitive-read audit, the readiness gate output) is offered first.

## 11. Liability, term, governing law

[[for counsel: not drafted here]]

## 12. Sign-off (owner decision K13)

| Party          | Signatory (name, capacity) | Date           |
| -------------- | -------------------------- | -------------- |
| Controller     | [[...]]                    | [[YYYY-MM-DD]] |
| Operator       | [[...]]                    | [[YYYY-MM-DD]] |
| Counsel review | [[...]]                    | [[YYYY-MM-DD]] |

This template is not legal advice. Statements the author could not confirm are
collected here for counsel: whether UU PDP requires a written processing
agreement and its minimum content; the processor's duty to flag unlawful
instructions; sub-processor conditions; the form of a joint-controller
arrangement; transfer conditions; the interaction of erasure with statutory
retention; whether the operator has a direct statutory duty to notify.
