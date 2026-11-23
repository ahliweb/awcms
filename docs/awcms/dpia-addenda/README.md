🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# Approved payroll DPIA addenda (per deployment)

This directory holds the **approved** addendum of a deployment that uses the
`hr_payroll` module (Issue #1449). It is empty in the template on purpose: the
template carries no deployment's addendum, and an empty directory is the
fail-closed state (payroll cannot be enabled).

- The template to copy:
  [`../dpia-addendum-hr-payroll-template.md`](../dpia-addendum-hr-payroll-template.md).
- The processing terms to turn into an agreement:
  [`../payroll-processing-terms-template.md`](../payroll-processing-terms-template.md).
- One file per approved addendum: `<ref>.md`, where `<ref>` is lowercase letters,
  digits and hyphens.

## How the gate uses it

`HR_PAYROLL_DPIA_ADDENDUM_REF`, `HR_PAYROLL_DPIA_ADDENDUM_APPROVED_ON` and
`HR_PAYROLL_DPIA_ADDENDUM_SHA256` name the file, its approval date and its
digest. Without all three, well formed, the `hr_payroll` module cannot be
enabled for a tenant (`409 PAYROLL_DPIA_ADDENDUM_REQUIRED`) and every guarded
endpoint of it answers `403 PAYROLL_DPIA_ADDENDUM_REQUIRED`, whatever the caller
holds. `bun run config:validate` and `bun run security:readiness` additionally
check that the file exists, matches its digest, has `status: approved`, names a
signatory and a counsel review date, keeps every required section, and has no
unfilled double-bracket marker.

Editing an approved addendum changes its digest: the gate goes red until the
controller re-approves it and the digest variable is updated. That is the
intended speed bump, not a defect.

## What the gate does not prove

That the signatory is who the record says, or that the content is legally
adequate. It proves a deployment cannot go live without a completed, signed-off,
unmodified document. Legal sufficiency stays with the controller and counsel
(owner decision K13); this repository is not legal advice.

The design, and why it is enforced at the module-enable path and at the
`authorizeInTransaction` chokepoint, is in
`src/modules/_shared/payroll-dpia-addendum-gate.ts`.
