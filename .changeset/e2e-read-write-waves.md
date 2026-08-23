---
"awcms": minor
---

test(e2e): the sweeps were accidentally immune, and the fix had to come first

Every e2e spec shares one seeded tenant. Some of them change it tenant-wide, and under `fullyParallel: true` a reader could observe that change mid-flight. The previous round fixed one symptom of this; this one fixes the cause, and then fixes what the cause had been hiding.

### Two waves, ordered

`playwright.config.ts` now runs `setup` → `read` → `write`. Read-wave specs see the tenant as the bootstrap left it; writers run afterwards. Within each wave everything is still parallel, so the cost is one barrier, not serialization — the suite still finishes in ~19s.

Reads run first rather than last on purpose. Running them last would depend on every mutator reverting cleanly, which is true today but is an invariant nobody could enforce: a mutator that fails halfway leaves residue by definition, and the reader would then be asserting against the wreckage of a different failure.

### The classification is checked, not trusted

A list of filenames is normally the wrong answer in this repo — a gate that checks its own matrix rather than what exists is the recurring failure here. So it is held from both ends:

- `tests/e2e-wave-classification.test.ts` requires every `*.e2e.ts` on disk to appear in exactly one wave. A new spec fails CI until its author decides which it is, and an unclassified spec would not run at all.
- Membership of the read wave is enforced **at run time**: read-wave specs import `test` from `tests/e2e/support/e2e-read-wave.ts`, which fails any test that issues a mutating `/api/` request. Verified by mutation — adding one `fetch(…, {method: "POST"})` to a read-wave spec turns that spec red, naming the request.

Session endpoints are the only allowed exception, because three specs must authenticate as somebody other than the shared owner.

### What the ordering unlocked: the sweeps were not actually checking anything

This is the part worth reading. `admin-screens-render.e2e.ts` asserted `200`, and **a denied screen also returns `200`** — denial renders here, it never redirects. So the sweep would have stayed green if a screen started refusing the owner: a module switched off, a grant dropped from the bootstrap, a tenant-wide `deny` authored. It was accidentally immune rather than correct, and it could not be tightened while a mutator might be running concurrently.

It now asserts the screen rendered its **contents** — no denial hook anywhere in the page. Verified by mutation: disabling the `reporting` module makes it fail on `/admin` **and** `/admin/reporting` together, which is exactly the interference that used to be indistinguishable from a defect. Under the old assertion that scenario was green.

### A read-only operator is now covered, and it is where ADR-0053 gets its runtime check

`tests/e2e/admin-read-only-access.e2e.ts` — written a round ago, held back because it failed roughly one run in three through no fault of its own — lands unchanged. It drives a user granted every tenant-scoped `read` and nothing else: the grant comes from the permission catalogue, the expectation from each page's own `authorize` block, so the two halves come from different sources.

`/admin/tenants` and `/admin/partner-registry` must refuse that user. This is the only runtime check on ADR-0053 anywhere in the repo, and verified by mutation: granting the read-only role the two platform reads makes both screens serve their contents and the spec reports cross-tenant disclosure.

**It belongs here rather than in the owner sweep, and finding that out cost a failed run.** The first attempt asserted the owner is refused by those two screens. It failed — against an environment where the seeded tenant *is* the platform tenant, whose owner legitimately holds those permissions. What the owner is owed there depends on which tenant was seeded, which the sweep has no independent way to know, so those two screens are now exempt from the contents-vs-refusal question there and held to `200` + shell. For the read-only user it is unconditional: a `scope = 'tenant'` grant can never include a platform permission, whichever tenant they belong to.

### Corrected: the browser-test skill described a different repo

`.claude/skills/awcms-browser-test/SKILL.md` claimed specs for `/admin/analytics` and `/admin/security`, an `admin-responsive-nav.e2e.ts`, an `admin-a11y-smoke.e2e.ts`, and a `@axe-core/playwright` devDependency. **None exists here** — all of it was inherited from `awcms-mini` when the skill was ported.

It also described the CI job as running in **two phases** with `--grep-invert "@full-online-gate"`, restarting the server under `AUTH_ONLINE_SECURITY_ENABLED=true` for `admin-security-enabled.e2e.ts`. `ci.yml` has no second phase and neither spec exists. Both corrections are stated in place rather than silently overwritten, because the failure mode of a stale skill is that an agent follows it instead of looking — and a confident false description of CI is worse than none.

The Status section now lists the 15 specs that are actually present, and a new mandatory convention covers wave classification, so the next author is told about it by the skill rather than by a failing gate.
