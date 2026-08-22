---
"awcms": patch
---

fix(security,identity-access,blog-content): three costs that grew with something nobody was watching

Three PROJECT_STATE §4 items whose common shape is a cost that is invisible at
the size everything was tested at, and that grows with something the code never
looks at: how many clients have ever connected, how many roles a tenant has
defined, how many tags an article could match.

**B6 — the in-process rate-limit map had no eviction.** One entry per distinct
client IP, created on first contact and never removed. Redis is off by default,
so this map is the live path for the topology this base documents as its
default, and the end state is an OOM of the process that also holds every other
cache. Two mechanisms now, because a sweep alone is not a bound: an amortised
sweep drops entries whose window has elapsed (`checkRateLimit` already treats
that as a fresh start, so they hold no information), and a hard cap of 50,000
evicts — in one batch, down to 45,000 — the entries CLOSEST TO EXPIRING, which
is the least harmful choice available when nothing has expired to reclaim. The
bucket now stores its own `windowMs`: eviction happens outside any call for that
key, and the map is shared by callers with windows in seconds and in minutes, so
sweeping by the triggering caller's window would expire the other family's
counters early. Forgetting a LIVE counter hands its owner a fresh allowance,
which is the one failure a memory fix must not introduce, and it is asserted
alongside the size.

**C6 — `/admin/roles` was an N+1 plus a payload that grew as roles × catalogue.**
`listRolePermissions` was awaited once per role, sequentially (concurrent
queries on one transaction connection leak it), so a 40-role tenant paid 40
summed round trips to render one screen; `listRolePermissionsForRoles` answers
the set in one, with an entry for every requested id so no caller has to tell
"no grants" from "not in the result". The single-role reader is deleted rather
than left unused — a zero-caller export is how the next screen quietly
reintroduces the N+1. The ~230-row permission catalogue was also rendered as
`<option>`s once per role — ~23,000 options in one document, of which at most
one is ever chosen. It is now emitted once in a `<template>` and cloned into a
role's picker on first open, minus what that panel already lists as granted. The
server still decides whether a picker exists at all, and the endpoint's
`configure` guard remains the only authority on the grant itself.

**C7 — `prepareCandidates` re-escaped every tag name inside the sort
comparator.** A comparator runs O(n log n) times: 1090 `escapeHtml` calls per
sort at the 100-candidate cap instead of 100, on by default on every public
article render. Decorate-sort-undecorate, with the escaped name carried on the
row the dedupe loop and the caller both already need.

One thing worth knowing before the next screen: C6's client-side picker costs
~540 B and leaves **161 B** of headroom under `build:asset-budget:check`'s
192,000 B app ceiling. The trade is good in itself, but the next client script
to land will fail that gate for reasons unrelated to whatever it did.
