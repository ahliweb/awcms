🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `hr_workforce`

The **employment context** (Issue #945,
[ADR-0132](../../../docs/adr/0132-hr-payroll-module-family-admission.md), phase 1
of the `hr_*` family). The design pack is
[`docs/awcms/hr-payroll.md`](../../../docs/awcms/hr-payroll.md) sections 2.1, 3 and
4.1; this file is the map of the code.

## What is here, and what is not

This is the **foundation**: employments, effective-dated terms, settings and
employee-sees-own. **Not here yet:** attendance, corrections, shifts, the
staff-availability port, commission and payroll (later issues of the same ADR) —
and **never** a photo, biometric or device-fingerprint field (owner decision O6).

Status is `experimental`: the flag is off, no admin screen exists, and the module
declares no `navigation`. It flips to `active` with its first screen.

## The rules that make it safe

- **A reference, not a copy.** `awcms_hr_employments.profile_id` is a composite
  `(tenant_id, profile_id)` foreign key to `awcms_profiles`. No name, contact,
  birth date, NIK or NPWP column exists on any HR table; display reads
  `profile_identity`. A test asserts no such column appears.
- **One active employment per profile and per login**, by partial unique indexes
  (`sql/180`), not by handler code. Rehire is a new employment after the first is
  terminated.
- **Terms are append-only and effective-dated.** A change closes the open row and
  inserts the next; terms never overlap; `terminated` is terminal and stamps the
  header; the manager chain is acyclic and at most ten deep. Each of those is a
  trigger, so a bypassing session cannot break it.
- **Profile merge** between two actively employed profiles is refused by a trigger
  on `awcms_profiles` (ADR-0132 section 2).
- **Employee sees own** is an `ownershipGrant` (ADR-0063) on the persisted
  `tenant_user_id`, passed through `defineTenantRoute`'s new `ownershipGrant`
  option. It only widens `employments.read`; ABAC deny, scope and SoD still apply,
  a machine credential never carries it, and a missing id and someone else's row
  are the same 403. The link itself is `employments.assign`: high-risk and audited.
- **High-risk actions** (`create`, terms change, `assign`, `delete`, `restore`,
  `configure`) require an `Idempotency-Key` and are audited without any name,
  title, number, reason or account id.

## Subject-rights decision (ADR-0094 coverage)

| Table                         | `subjectData`                                              | Why                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `awcms_hr_employments`        | covered: `profile_id`, `tenant_user_id` + stamps; exported | The subject's own employment record. Retained under the employer's labour/tax/social-security obligations (`retain_under_obligation`); the link stays and resolves to the anonymised profile.                                                                                                                                   |
| `awcms_hr_employment_terms`   | covered: actor stamp only; **not exported**; retained      | Reaches the person only through `employment_id`, which a direct subject column cannot express. The subject reads their own history through the ownership-granted `GET .../terms`. Append-only, so an erasure could not rewrite it. A direct employment-to-subject join in the export is a recorded follow-up (see Limitations). |
| `awcms_hr_workforce_settings` | `NO_SUBJECT_DATA` (reason recorded)                        | A tenant configuration row; only an `updated_by` stamp.                                                                                                                                                                                                                                                                         |

All three tables are registered with `data_lifecycle` as `delegated`, with no
purge: HR history is retained for the employer's legal periods (counsel's, not
asserted here); archive-then-purge for HR rows is a recorded follow-up.

## Layout

| Path                                        | What it is                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| `module.ts`                                 | Descriptor: 8 permissions, `dataLifecycle` + `subjectData`                |
| `domain/hr-workforce-types.ts`              | Employment types and statuses — pure                                      |
| `domain/hr-workforce-validation.ts`         | Strict request validators (no personal field, no derived end date) — pure |
| `domain/hr-workforce-permissions.ts`        | Literal guard objects passed to `authorizeInTransaction`                  |
| `application/hr-workforce-directory.ts`     | All SQL: list/get, create, terms change, assign, delete/restore, settings |
| `application/hr-workforce-route-support.ts` | Idempotency, body validation and the ownership basis shared by the routes |
| `src/pages/api/v1/hr-workforce/**`          | 6 thin route files, each authorizing through `defineTenantRoute`          |

## Limitations

- No admin screen; `experimental`.
- Existing tenants need `bun run identity-access:permissions:backfill` to receive
  the seeded permissions (the limitation every permission seed carries).
- The employee number and hire date cannot be edited in place (delete and recreate
  while it is a mistake); a header edit endpoint is a later issue.
- The terms table is not joined into the subject export (see above).
- `btree_gist` is not used: terms overlap is a trigger, not an exclusion constraint.
