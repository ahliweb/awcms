---
"awcms": patch
---

feat(identity-access): a partner's access now really ends when its grant runs out, not merely stops working

The gate landed first: an expired delegated grant has been refused at the
chokepoint since the previous change, from the instant on its row. What was
still missing is what ADR-0090 actually promised — that expiry "deactivates the
membership in the same transaction". Until now it did not deactivate anything.
The grant stayed `revoked_at IS NULL`, the partner's person stayed an **active
member** in the customer's user list, and their session row stayed live. Access
had stopped; the record said otherwise, and a customer reads that record as
fact.

`bun run identity-access:delegated-access:expiry` closes it: the grant is
revoked with reason `expired` and **no actor** (`sql/117`'s CHECK anticipates
this — "what is forbidden is an actor without a time"), the delegated tenant user
goes `inactive`, and its live sessions are revoked. Hourly, bounded per pass,
`maintenance` work class, offset from the business-scope sweep. `--dry-run`
counts the backlog and mutates nothing.

**The interesting part is where the privilege lives.** The job runs as
`awcms_worker`, which holds neither `UPDATE` on `awcms_tenant_users` nor anything
on `awcms_sessions` — and must not. The column that deactivates a member also
writes `'active'`; the column that revokes a session also writes `NULL`. Both are
escalations, in the role whose whole purpose is that it cannot escalate, and
column-scoped grants do not help because the dangerous value lives in the same
column as the wanted one.

So `sql/142` puts the privilege in a narrow `SECURITY DEFINER` function instead —
the `sql/048` / `sql/119` / `sql/124` precedent — with a dedicated memberless
NOLOGIN owner, policies scoped to that role alone, and a boundary that is not a
column list but the statements themselves: **it takes a tenant id and a batch
size and nothing else**, so no caller-supplied value is ever written. Every
literal is in the migration. Each of its three statements is guarded so it can
only ever REMOVE access. The worst a compromised worker can do by calling it in a
loop is end support episodes early.

`awcms_app` deliberately gets no `EXECUTE`: the request path has its own
revocation, which names the human who performed it, and a privilege granted for a
caller that does not exist is a privilege granted for nothing.

Proven against a real database: the worker can run the sweep and is refused
`42501` on a direct `UPDATE` of either table; the sweep and the human revocation
path reach the same end state (the anchor against two implementations drifting);
an ordinary member of the same tenant is untouched; a grant still in date is left
alone; a second pass sweeps nothing; and a batch size a caller invents is clamped
inside the function rather than obeyed.
