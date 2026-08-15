🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0063-ownership-grants-run-through-the-authorization-chokepoint.id.md)

# ADR-0063 — Ownership-based grants run THROUGH the chokepoint, they do not replace it

- **Status:** Accepted
- **Date:** 2026-08-04
- **Decision makers:** @ahliweb
- **Related:** [ADR-0053](0053-platform-scoped-permissions.md) (platform-scope gate at the chokepoint), [ADR-0060](0060-business-scope-hierarchy-provided-by-tenant-admin.md) (business-scope facts at the chokepoint), [ADR-0057](0057-blog-page-lifecycle.md) §F + [ADR-0058](0058-unenforced-permissions-disposition.md) (permission coverage gate — and its limits), [ADR-0049](0049-machine-credentials-and-session-introspection.md) (machine credentials never authorize), [ADR-0062](0062-skills-are-gated-against-the-code-they-describe.md) (precedent: a rule not written in a skill is not followed)

## Context

### 1. Three handlers decide permissions outside the chokepoint

`authorizeInTransaction` is the single place where these four layers are
evaluated: the ABAC evaluator (`evaluateAccess`), the platform-scope gate
(ADR-0053), business-scope facts (ADR-0060), and action-time SoD (#181).

Three handlers do not call it and assemble their own decision out of
`fetchGrantedPermissionKeys` + domain rules:

- `PATCH /api/v1/blog/posts/{id}`
- `POST /api/v1/blog/posts/{id}/submit-review`
- `PATCH /api/v1/blog/pages/{id}`

The concrete consequence: **a tenant that writes an ABAC `deny` policy over
`blog_content.posts.update` finds its policy honoured on some routes and ignored
on these three** — no error, no red test, no red gate.

### 2. None of the three is an OVERSIGHT — the chokepoint genuinely cannot hold them

This is the part that changes the shape of the decision.

All three handlers enforce a rule that deliberately exists in the product
document (#538): **an author may edit their own unpublished content EVEN IF they
do not hold `blog_content.posts.update`.** That is an authorization axis the
**permission catalogue cannot express** — it is a property of the subject↔resource
relation, not a property of a role.

`authorizeInTransaction` returns `denied` **before** any domain rule gets a
chance to be consulted. So putting it in front of `evaluatePostUpdateAccess`
would **delete the author pathway**: an author without the permission is denied
at the chokepoint, and the specified feature disappears.

In other words: those three routes are not taking a shortcut. **They are the only
road available.** The defect is in the chokepoint's seam, not in their authors'
discipline — and fixing it with "just call the chokepoint" is a functional
regression that would pass review because it looks like a security tightening.

### 3. A correction to the assessment that triggered this ADR

[`../awcms/repo-assessment-2026-08-04.md`](../awcms/repo-assessment-2026-08-04.md) §2
writes this finding up as **one** deviating route, with
`PATCH /api/v1/blog/posts/{id}` as **an example of the CORRECT pattern** ("calls
`authorizeInTransaction` first, then `evaluatePostUpdateAccess`").

**That is wrong.** The file `blog/posts/[id].ts` calls `authorizeInTransaction`
twice — in `GET` (line 83) and in `DELETE` (line 431) — while `PATCH` in the same
file does not at all. A FILE-level reading merged all three into one flow and
concluded a compliance that does not exist.

The class is exactly the one ADR-0058 §1 recorded and ADR-0059 repeated: a guess
written down as a finding, then copied into a document as a decision. This time
the victim was the assessment itself. The assessment has been corrected in the
same PR as this ADR, and the gate in §Decision **slices per HANDLER precisely
because that is the error that actually happened**.

### 4. Why the permission coverage gate did not see it

`access:permissions:enforcement:check` asks **"does this permission have an
enforcer?"**. `blog_content.posts.update` does — `GET`/`DELETE` in the same file,
and other routes. It never asks **"does EVERY enforcement site use the
chokepoint?"**. A repeat of the PR #351 lesson: coverage gates and correctness of
the enforcement site are two different questions, and a control can pass the
first while being wrong on the second.

## Decision

### §A — `ownershipGrant`: it WIDENS, it does not SHORT-CIRCUIT

`authorizeInTransaction` accepts a new option:

```ts
options?: { ownershipGrant?: { granted: boolean; reason: string } }
```

When `granted`, the guard **adds the requested permission key to the set being
evaluated** — and then runs `evaluateAccess` as usual. It does not return allow
early, and it skips not a single layer.

The consequence is exactly the one wanted: tenant isolation, ABAC (including an
explicit `deny`), business-scope, and SoD **can still deny**. Ownership only
answers "may this subject be treated as holding the permission", not "is this
action allowed".

**Machine credentials are excluded.** They AUTHENTICATE and never AUTHORIZE
(ADR-0049 §3), so a build token pointed at an author's account must not inherit
that author's ownership.

**The decision log marks an ownership-based allow** (`ownership_grant:<reason>`).
Without it the row reads identically to an RBAC allow, and an auditor asking "who
can do this, and why" gets the wrong answer for the one case whose answer is not
"a role conferred it". DENY is never relabelled.

### §B — The `access:chokepoint:check` gate, sliced per HANDLER

Every handler that calls `fetchGrantedPermissionKeys` must also pass through
`authorizeInTransaction`/`defineTenantRoute`, or be registered as a reasoned
exception keyed `<file>#<METHOD>`.

**Per-handler, not per-file, is the decision that carries the weight** — §3 above
is the proof that a per-file reading fails precisely on the real case. The
METHOD-keyed key also ensures an exception never widens to a neighbouring handler
in the same file, which is exactly how the original defect hid.

Two exceptions, both verified:

- `auth/login.ts#POST` — **pre-authentication**: there is no subject yet to authorize.
- `access/evaluate.ts#POST` — **self-introspection**: it reflects the
  `evaluateAccess` decision for the CALLER'S OWN request and calls the same
  evaluator directly, so ABAC is **applied**, not bypassed.

**Dead** exceptions (whose handler no longer bypasses, or no longer exists) are
reported too — the same rule ADR-0058 and ADR-0062 use.

## Consequences

**What we get.** Zero handlers decide permissions outside the chokepoint. A
tenant's ABAC policy now applies uniformly. The ownership rule stays alive, and is
now **readable in the decision log for what it is**.

**What we pay.** One new option on the security spine — a surface that has to be
protected. Its protection: the guard must not SHORT-CIRCUIT, and that is enforced
as a contract over the guard's own source text, because the wrong implementation
(`if (ownership.granted) return { allowed: true }`) is one line, passes every
behavioural test of `evaluateAccess`, and would never be seen by any evaluator
test.

> **One claim that was briefly written into this ADR's test was ALSO WRONG, and a
> mutation disproved it.** The first draft stated the safety came from ordering —
> "ABAC is matched BEFORE the RBAC key check, so ownership cannot beat a deny".
> Mutated by hoisting the RBAC check above the ABAC block: **the test stayed
> green**, because `deny` returns a result in either order. The ordering is
> irrelevant. The real property is **not short-circuiting**, and that is what is
> now tested — including at the level of the guard's source.

**Zero migrations, zero new permissions, zero OpenAPI changes.** The only
behaviour that changes moves in one direction: an action that previously passed
because it bypassed ABAC can now be denied by tenant policy — which is exactly the
point.
