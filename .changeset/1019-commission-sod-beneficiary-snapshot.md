---
"awcms": patch
---

security(hr_commission): commission separation of duties no longer switches off while the beneficiary employment has no linked login (#1019). Each accrual now snapshots the beneficiary's login at creation (`sql/236`, set by trigger, backfilled from the current link); approve, release and pay are refused for both the snapshotted and the current login, and are refused outright (`409 BENEFICIARY_LOGIN_UNRESOLVED`, `sql/237`) while the employment has neither. Closes the unlink, self-approve, relink bypass. Re-linking an employment's login now also counts an unsettled commission accrual (not paid or voided) as history, so it needs the ADR-0141 step-up and stays critical. Commission for an employee without a login now needs a login linked before it can be approved, released or paid.
