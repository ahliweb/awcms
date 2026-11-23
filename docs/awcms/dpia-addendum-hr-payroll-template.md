🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](dpia-addendum-hr-payroll-template.id.md)

# DPIA addendum template — HR payroll, one per deployment (document B)

> **STATUS: TEMPLATE.** Not an addendum, not approved, not legal advice. It has
> no legal effect until a controller copies it, completes it and signs it
> (owner decision K13: accountability under UU PDP, Law No. 27 of 2022, cannot be
> delegated to an agent or to this repository). Any legal reference below that the
> author is not sure of is marked **verify with counsel**; none is quoted as fact.

This is **document B** of the payroll DPIA pair. **Document A** is the
platform-level DPIA of the phase 3 design (`dpia-hr-payroll-phase-3.md`, #976,
draft until the controller signs). Document A answers "is the design safe enough
to build". This addendum answers what only a deployment can: for **this**
deployment, who is controller, for what purpose, how many people, how long, with
which processors, to which countries, who at the operator can see what, and what
the employees were told. It closes residuals **R-11** (operator access and O5)
and **R-13** (cross-border processing) of document A (#1449), and it parallels
the per-tenant DPIA that ADR-0138 requires before geolocation evidence.

## How to use it

1. Copy this file to `docs/awcms/dpia-addenda/<ref>.md` (`<ref>`: lowercase
   letters, digits and hyphens, for example `acme-prod-2026`).
2. Replace **every** double-square-bracket marker (the blanks in the tables and
   in the Gate record) with the deployment's answer, and change the status line
   at the top to say the document is an approved addendum. A single leftover
   marker anywhere in the file, including in this "How to use" section, keeps the
   go-live gate closed, so delete this section once you have followed it. Delete the assumption you do not use in
   section 1 (A or B) and keep the other; keep every
   `<!-- addendum-section: ... -->` line, they are what the gate looks for.
3. Have counsel review it and the controller sign (section 11). Then fill the
   **Gate record** at the end of the file and set `status: approved`.
4. Compute `sha256sum docs/awcms/dpia-addenda/<ref>.md` **after the last edit**
   and set `HR_PAYROLL_DPIA_ADDENDUM_REF`, `HR_PAYROLL_DPIA_ADDENDUM_APPROVED_ON`
   and `HR_PAYROLL_DPIA_ADDENDUM_SHA256` (see `.env.example`).
5. `bun run config:validate` and `bun run security:readiness` verify the file;
   the `hr_payroll` module cannot be enabled for any tenant, and refuses every
   request, until this is in place. Any later edit changes the digest and closes
   the gate again until the controller re-approves.

The three variables are the deployment's go-live switch for **payroll as a
module**. They do not replace the per-tenant steps of the module itself.

## 1. Deployment and legal role of the operator (owner decision O5)

<!-- addendum-section: o5-outcome -->

| Item                                       | Entry                                                 |
| ------------------------------------------ | ----------------------------------------------------- |
| Deployment name and environment            | [[deployment name, production or other]]              |
| Operator (legal entity)                    | [[legal name, address]]                               |
| Tenant(s) that will use payroll            | [[tenant codes and the legal entity each represents]] |
| Owner decision O5 outcome, this deployment | [[A or B: delete the assumption that does not apply]] |

**Assumption A: the tenant is controller, the operator is processor.** Each
tenant decides why and how its employees' pay data is processed; the operator
processes it on the tenant's documented instructions only. The operator may be a
controller of its **own** data (operator accounts, security and audit data of its
own staff), which this addendum lists in [[list or "none"]].

- The tenant answers data-subject requests and decides whether a breach is
  notifiable (the operator supplies evidence on request).
- A processing agreement between each tenant and the operator is **required**
  (`payroll-processing-terms-template.md`, variant A).

**Assumption B: the operator is a joint controller, or has another role as
decided by the DPIA.** [[describe: which purposes and means the operator decides, for which data, and why; for example the operator sets the retention of backups or chooses the hosting country]].

- Who answers which data-subject request: [[allocation table]].
- A joint-controller arrangement (essence made available to data subjects) or the
  appropriate instrument for the role: **verify with counsel** whether UU PDP
  requires a specific form and content.
- The operator's own duty to notify for the part it controls is triggered as well
  (**verify with counsel**).

Either way, the technical isolation is the same and does not depend on this
decision: per-tenant RLS, per-tenant audit, per-tenant subject-data export
(`hr-payroll.md` 13.2, ADR-0094 decision 1).

## 2. Purposes and lawful basis

<!-- addendum-section: purposes-and-basis -->

| Item                                   | Entry                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| Purposes of payroll in this deployment | [[for example: paying employees, withholding and contributions the employer owes]] |
| Lawful basis relied on, per purpose    | [[basis and its source in law; consent is not the proposed basis]]                 |
| Purposes expressly NOT pursued         | [[for example: profiling, performance scoring, marketing, sharing for sale]]       |

Document A, section 1.1, proposes the employment relationship and the employer's
legal obligations as candidate bases and records that consent is unsuitable
because an employee cannot freely refuse. Which basis applies under UU PDP, and
whether any category needs another: **verify with counsel**.

## 3. Headcount and data

<!-- addendum-section: headcount-and-data -->

| Item                                                   | Entry                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Number of data subjects per tenant (now, in 12 months) | [[numbers]]                                                                         |
| Larger than a small cohort? (scale indicator)          | [[yes or no, with the reasoning]]                                                   |
| Categories actually used (document A, section 1.2)     | [[compensation, payout accounts, run lines, payslips, commission accruals, others]] |
| Tax identifiers (NIK, NPWP) used by a run              | [[yes or no; they stay in the identity module, never copied]]                       |
| Specific personal data position                        | [[counsel's conclusion on personal financial data; document A, section 1.3]]        |

A tenant with one employee, or a department of one, makes a pay figure identify a
person; payroll reports therefore stay behind the data boundary
(`payroll-data-boundary.ts`) whatever the headcount.

## 4. Retention

<!-- addendum-section: retention -->

No statutory retention period is asserted by the repository. Fill each record
class from counsel's advice (document A, section 2.3, residual R-07).

| Record class                       | Period and legal source      | Mechanism that ends it                |
| ---------------------------------- | ---------------------------- | ------------------------------------- |
| Compensation history               | [[period, source]]           | [[purge route, or "none exists yet"]] |
| Run lines and payslips             | [[period, source]]           | [[...]]                               |
| Payout accounts (after retirement) | [[period, source]]           | [[...]]                               |
| Commission accruals                | [[period, source]]           | [[...]]                               |
| Backups containing the above       | [[period, how they age out]] | [[...]]                               |
| Audit and read-audit rows          | [[period, source]]           | [[...]]                               |

## 5. Processors and sub-processors

<!-- addendum-section: processors-and-subprocessors -->

List every party that can reach payroll data, including backup and email
providers if enabled. Nothing is outbound by design today: no payment provider,
no bank file, no transfer of an account number exists (document A, section 1.5).

| Party                | Role               | Data reachable              | Agreement and date | Country     |
| -------------------- | ------------------ | --------------------------- | ------------------ | ----------- |
| [[hosting provider]] | [[hosting]]        | [[all, encrypted at rest?]] | [[reference]]      | [[country]] |
| [[backup provider]]  | [[backup storage]] | [[...]]                     | [[reference]]      | [[country]] |
| [[other, or "none"]] |                    |                             |                    |             |

## 6. Cross-border transfers (residual R-13)

<!-- addendum-section: cross-border-transfers -->

| Question                                                                                                           | Entry                                                 |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Does any party in section 5 store or access payroll data outside Indonesia (including backups and support access)? | [[yes or no, per party]]                              |
| Lawful transfer position (adequacy, safeguards, consent) per transfer                                              | [[position]]                                          |
| Where the answer is "no safeguard yet"                                                                             | [[decision: keep data in-country, or do not go live]] |

The conditions UU PDP sets for transfers and the form of the safeguard:
**verify with counsel** (L-P10). Do not leave this section blank on the
reasoning that "the provider is reputable"; the answer is a legal position.

## 7. Operator-staff access to tenant payroll data (residual R-11)

<!-- addendum-section: operator-staff-access -->

This section states **who at the operator may see tenant payroll data and how
that is recorded**. The default, to be kept unless this section says otherwise:
**no operator staff member has standing access to any tenant's payroll data.**

**What the repository enforces today (verified in code):**

- Payroll tables are granted to the request role (`awcms_app`) only. `PUBLIC` and
  the worker role hold nothing on them (`PAYROLL_ALLOWED_GRANTEES`,
  `payroll:catalog-boundary:check`).
- Row-level security is `FORCE`d and tenant-scoped: an operator staff member who
  logs in to the **platform tenant** does not see another tenant's rows, and the
  payroll permissions are tenant-scoped, not platform-scoped, so there is no
  platform-level payroll read permission to grant.
- Reads through the application leave a sensitive-read audit row (who, which
  permission, which ids and counts, never the amounts), at the severities of the
  sensitive-read registry.

**What the repository can NOT see:** a person with database or hosting
administrator rights (a superuser, the table owner, a provider console, a
backup restore) bypasses every application control, and their reads appear in no
application audit. This is the real R-11 exposure and it is controlled by the
deployment's own practice, recorded below.

| Question                                                                                                   | Entry                                                                      |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Named roles at the operator who hold database or hosting administrator rights                              | [[roles, not personal data; count]]                                        |
| Is access to payroll rows by those roles allowed at all, and when?                                         | [[for example: only to restore or repair at the tenant's written request]] |
| Approval needed (who approves, is a second person required)                                                | [[...]]                                                                    |
| Notice to the tenant before or after the access                                                            | [[timing and channel]]                                                     |
| Where the access is recorded outside the application (ticket, session recording, database audit extension) | [[system and retention; mark "not configured" if it is not]]               |
| Review cadence of the access list                                                                          | [[for example quarterly]]                                                  |
| Staff confidentiality undertaking                                                                          | [[reference]]                                                              |

Any access under variant A is on the tenant's documented instruction; under
variant B record the operator's own basis.

## 8. DPO position

<!-- addendum-section: dpo-position -->

| Item                                                                      | Entry                           |
| ------------------------------------------------------------------------- | ------------------------------- |
| Is a data protection officer required for this controller (and operator)? | [[yes, no, with the reasoning]] |
| Name or role and contact, if appointed                                    | [[...]]                         |

Whether UU PDP requires the appointment for this processing: **verify with
counsel** (document A section 6 lists it as a consultation item).

## 9. Employee notice (L-P11)

<!-- addendum-section: employee-notice -->

| Item                                                                                                           | Entry                               |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Where and how each employee is told (purposes, categories, retention, rights, contacts, recipients, transfers) | [[channel, language, version]]      |
| Date the notice was first given, before payroll goes live                                                      | [[date]]                            |
| How a data-subject request reaches the controller                                                              | [[contact]]                         |
| Who answers it, within what period                                                                             | [[role, period; follows section 1]] |

## 10. Treatment of document A's open residual risks

<!-- addendum-section: residual-risk-treatment -->

Document A lists risks with no residual reduction yet, which the controller must
treat before go-live. For each, record the treatment or the acceptance and who
accepted it.

| Risk                                         | Treatment or acceptance in this deployment                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| R-07 retention not fixed                     | [[see section 4]]                                                                                       |
| R-11 operator access and O5                  | [[see sections 1 and 7]]                                                                                |
| R-12 breach not detected or notified in time | [[runbook adopted, contacts filled, first exercise date; see `payroll-breach-notification-runbook.md`]] |
| R-13 cross-border                            | [[see section 6]]                                                                                       |
| Others still open in document A, section 3.2 | [[list]]                                                                                                |

## 11. Controller sign-off (owner decision K13)

<!-- addendum-section: controller-sign-off -->

- [ ] Counsel reviewed this addendum and the processing terms (or the joint
      arrangement), including every item marked "verify with counsel".
- [ ] O5 is decided for this deployment and sections 1 and 7 follow it.
- [ ] The processing agreement or equivalent instrument is signed by every party
      that needs to sign.
- [ ] Employees were given the notice (section 9) before go-live.
- [ ] The breach notification runbook is adopted: contacts filled, first exercise
      scheduled.
- [ ] Every risk in section 10 has a recorded treatment or acceptance.

| Field                         | Entry          |
| ----------------------------- | -------------- |
| Controller (legal entity)     | [[...]]        |
| Signatory (name and capacity) | [[...]]        |
| Date signed                   | [[YYYY-MM-DD]] |
| Counsel (firm or person)      | [[...]]        |
| Date counsel reviewed         | [[YYYY-MM-DD]] |

This document is not legal advice. Signing it is the controller's act.

## Gate record

The machine-readable part the go-live gate reads. Keep one `- key: value` per
line. Values are replaced when the addendum is approved; an unfilled value
(a double-bracket marker, `TBD`, empty, or in angle brackets) keeps the gate
closed.

- status: draft
- template-version: 1
- o5-outcome: [[A or B]]
- approved-on: [[YYYY-MM-DD]]
- controller-signed-by: [[name and capacity]]
- controller-signed-on: [[YYYY-MM-DD]]
- counsel-reviewed-on: [[YYYY-MM-DD]]
