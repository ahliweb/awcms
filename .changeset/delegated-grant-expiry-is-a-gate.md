---
"awcms": patch
---

fix(identity-access): a delegated access grant that had run out kept conferring its role

`sql/117` gave every partner grant an `expires_at`, ADR-0090 wrote that
revocation **and expiry** deactivate the membership in the same transaction, and
`expireDelegatedAccessGrants` exists to do it. Nothing has ever called it — no
job descriptor, no script, no `package.json` target — and both request-time
resolvers filtered on `revoked_at IS NULL` alone. A partner engagement approved
"until 30 September" therefore conferred its role for as long as nobody revoked
it by hand, and the 31-day `CHECK` that caps the date was enforcing a ceiling on
a value nothing read. `sql/117` even ships a `(tenant_id, expires_at)` index
built for the sweep that was never wired.

**Expiry is now a gate, not a sweep.** `resolveDelegatedGrantState` carries
`expires_at > now()` in the same statement that reads the partner's registry
status, and the chokepoint refuses `403 DELEGATED_GRANT_EXPIRED` above
`fetchGrantedPermissionKeys`, so no grant row can influence it. That is the shape
this module already uses twice — `isBusinessScopeAssignmentCurrentlyActive` and
`isSoDConflictExceptionCurrentlyValid` both refuse an elapsed row at decision
time and leave `status` to a job. A sweep alone would leave a window between the
second on the row and the second the timer next fires, which is precisely when
the access was supposed to have stopped.

`now()` rather than a parameter, because it is the transaction-start instant from
the same clock that wrote the column; comparing against a JavaScript `Date` would
make the gate depend on two clocks agreeing.

**The refusal is named accurately, and that is not cosmetic.** An expired grant
also reads as "no live row" to the partner-registry resolver, so it would have
fallen through the existing `partner_suspended` branch and written a decision-log
row asserting a suspension that never happened — sending a customer to ask a
vendor about it. The new branch runs first and files under
`delegated_grant_expired`. The attribution resolver is deliberately left
unfiltered: a refusal that cannot name the engagement is where an investigation
stops, and the id reaches audit rows only, never a decision.

Redemption now also stamps the grant's own `expires_at` onto the role it writes
(`effective_to`), so `activeRoleGrants` — whose `effective_to IS NULL` branch
means "in force forever" — stops answering yes on its own. Both timestamps are
written together: `sql/102` constrains `effective_to > effective_from`, and
`effective_from` DEFAULTs to `now()`, so supplying only the end date would
compare this process's clock against PostgreSQL's and could refuse a legitimate
redemption whenever the two disagree.

Still outstanding, and deliberately a separate change: the sweep that ends the
membership row and its sessions. Until it lands an expired actor is refused every
authorization but keeps an `active` row in the customer's user list — bookkeeping,
not access. It is separate because giving `awcms_worker` blanket `UPDATE` on
`awcms_tenant_users` and `awcms_sessions` would hand a scheduled job the ability
to re-activate a deactivated member and un-revoke a session, which is a wider
privilege than the sweep needs and warrants its own decision.
