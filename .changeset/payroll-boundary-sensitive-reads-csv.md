---
"awcms": minor
---

feat(security): forbid payroll tables in projections and exports, neutralise CSV formulas, add the sensitive-read audit helper (#978, finding PS-18). One list of forbidden payroll table names (`src/modules/_shared/payroll-data-boundary.ts`) is now enforced by the reporting projection registry and its engines, the site-search and comments registries, `edge-cache:surfaces:check` and report exports; every CSV writer goes through `src/lib/security/csv-formula.ts` (the data-lifecycle archive stays exactly reversible); and `recordSensitiveRead` (rate-aware, ids and counts only, fail-closed, `sql/224`) plus the new `bun run sensitive-reads:check` gate make an unaudited read of compensation, line-level pay, other employees' payslips or an export impossible once `hr_payroll` exists. No behaviour change for existing modules.
