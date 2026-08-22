---
"awcms": patch
---

fix(seo-distribution): the middleware cost the performance gate could not see

PROJECT_STATE §4 **B5**. The performance standard lists "queries per hot read
request ≤ 3" as **measured**, citing two budget suites. Both hand a counting
`tx` to a directory function — so everything a public request pays BEFORE the
route (resolving the tenant from the host, opening the tenant transaction,
asking `seo_distribution` whether the path redirects) was not merely unmeasured,
it was outside what the tool could measure at all. `countQueries` can only be
given a `tx`, which means it can only see code the test has already put inside a
transaction.

**Measured first.** `countPoolQueries` wraps the POOL and the transaction opened
on it, and `tests/integration/middleware-query-budget.integration.test.ts` pins
the real numbers against a real PostgreSQL: **5** statements for a passthrough,
**7** when the request redirects, **0** for a path the redirect vocabulary does
not cover. Exact rather than ceilings — a ceiling with slack cannot tell an
improvement from a regression into the slack — and explicitly a floor, because
`BEGIN` and `COMMIT` are two more round trips `sql.begin` issues itself that no
Proxy can see. A budget that quietly under-counts is how "measured" came to mean
something other than measured.

**Then reduced, by one read rather than a short-circuit.**
`resolveTenantAllowedHosts` and `resolveTenantPrimaryHost` read the same table
under the same active/not-deleted filter, differing only by `is_primary`, and
the redirect path called them one after the other on every eligible public
request. `resolveTenantDomainSet` answers both from one round trip: 6 → 5, and
8 → 7, proven by running the new budget against the pre-fix code and watching it
report the old numbers. The "does this tenant have any live rule?" short-circuit
the file's own perf note considered is still NOT applied, for the reason that
note gives: the passthrough branch needs the server-derived host to attribute a
404, and the legacy-blog auto-redirect fires from settings rather than a rule
row.

**The standard now states its scope.** The ≤ 3 ceiling was always a ROUTE budget
and the table did not say so; the middleware budget is a separate row rather
than folded into the same number, because the two are paid by different code and
one sum would hide which half moved.

**Also corrected: two comments that asserted a live code path was dead.** Both
`redirect-resolution-service.ts` and `redirect-middleware.ts` said the middleware
passes `locale = null` "all the way through", so locale-scoped redirect rules
could never match. That was true under ADR-0039 and false since ADR-0098's
locale routing landed and the middleware began passing the served locale for a
prefixed URL.
