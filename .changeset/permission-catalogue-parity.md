---
"awcms": patch
---

fix(access): three permissions existed in the catalogue and in no descriptor, which is how an entire authorization surface came to have no screen

`awcms_permissions` is what `authorizeInTransaction` reads: a row there is what a
role can be granted. The module descriptors are a SECOND register of the same
facts, and they are the one every static gate trusts —
`access:permissions:enforcement:check` asks "does each DECLARED permission have
an enforcer?", `admin:screen-coverage:check` asks "does each DECLARED permission
have a screen?". Both iterate what modules declare.

Nothing compared the two registers, in either direction.

`identity_access.abac_policies.{read,configure,analyze}` were seeded straight
into `sql/032` and declared nowhere, on the reasoning written into that
migration — _"rather than via a module descriptor `permissions` array which this
module does not use"_ — which was true when written and stopped being true
afterwards. The endpoints worked, so nothing looked broken. What broke was that
the three became **invisible to every gate that would have interrogated them**.

**What the blindness concealed.** The DSL policy surface those three guard —
`/api/v1/access/policies/*`, the ONLY surface producing policies the evaluator
consumes — has had **no admin screen at all**, for its whole life. ADR-0033
anticipated one. `admin:screen-coverage:check` exists to say exactly that, and
could not: it iterates declared permissions and these were not among them. The
gate was not wrong; it was never given the question.

**And six description drifts, which were not cosmetic.** Every permission-seed
migration ends `ON CONFLICT DO NOTHING`, so a description is written exactly
once and a later descriptor edit never reaches the catalogue.
`comparePermissions` reports that as `mismatched_description` and the module
health signal counts it as a failure — so `blog_content`, `identity_access`,
`tenant_admin` and `idn_admin_regions` had all been reporting
`permission_catalog_synced = fail` on every migrated deployment. Measured
against a real database, not inferred. `sql/148` corrects five of them; the
sixth is fixed in the DESCRIPTOR instead, because there the catalogue had the
better sentence. The rule applied was "make both registers say the better
sentence", not "make the catalogue obey the code".

**The gate is a test, not a `scripts/*-check.ts`, deliberately.** The obvious
pure gate parses `sql/*.sql` — two INSERT column shapes, plus five migrations
that DELETE catalogue rows in at least two predicate shapes, applied
cumulatively. A regex that silently mis-parses one produces a gate that is
confidently wrong. The migrated database has already applied all of it exactly,
so `tests/integration/permission-catalogue-parity.integration.test.ts` reads the
answer instead of re-deriving it, and reuses `comparePermissions` so CI and the
health endpoint cannot drift into disagreeing about the same two registers.
Mutation-proven: dropping one declaration reports
`orphaned: identity_access.abac_policies.read`.

**`/admin/access-policies`** gives the surface its screen: the policy list, with
an **In force** column, and a decision simulator (pick role codes, name a
module/activity/action, get allow|deny plus the matched policy). `isDslManaged`
is now on the record and in the API response because neither a client nor a
screen could otherwise tell a stored policy from one in force — this list
returns flat and DSL rows alike.

`abac_policies.configure` is recorded in `DELIBERATELY_UNSCREENED` rather than
built, on the precedent this repo already accepted for `workflow.definition.*`:
authoring a condition DSL needs a real editor, and a JSON textarea that accepts
a malformed policy until the API rejects it is a worse affordance than none. The
objection is sharper here — a malformed workflow graph is a bad diagram, a
malformed access policy is an authorization rule.

**Two smaller honesty fixes.** The health signal COMPUTED `orphaned` and then
filtered it out of its verdict; it now reports orphans in the detail while still
only failing on `missing`/`mismatched_description`, because an orphan is a
governance gap rather than a runtime fault and should not block a release.
And `/admin/abac-policies` now says out loud that policies created there are
stored but never evaluated — true since ADR-0033 and deliberate, but the screen
had only ever said the table is empty by default, which reads as "nothing here
yet" rather than "nothing here takes effect".
