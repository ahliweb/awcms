---
"awcms": patch
---

fix(access): a guard may now only demand a permission some module declares, and the scanner stopped inventing one out of a ternary

`access:permissions:enforcement:check` has asked one question since ADR-0057 §F:
does every permission a module descriptor **declares** have an
`authorizeInTransaction` guard? It never asked it backwards — does every guard
name a permission some descriptor declares? — and the reverse is the direction
with the worse failure behind it.

`authorizeInTransaction` answers from `grantedPermissionKeys`, built by joining
the actor's active role grants to `awcms_permissions`. A key no descriptor
declares has no catalogue row to join to, so **no role can hold it**, so
`evaluateAccess` returns `default_deny` — for the tenant owner, for the platform
tenant, for every actor in every deployment, permanently. The endpoint is not
weakly guarded; it is dead, and it answers 403 in a shape indistinguishable from
a legitimate refusal.

This repo has shipped that exact defect twice.
`POST /api/v1/identity/business-scope/assignments` refused every input in every
deployment (#180 F2), and `blog_content.pages.publish` meant no page could be
published by any code path while public search filtered on
`status = 'published'` and therefore always returned nothing (ADR-0057). Both
were found by hand, months later, by someone who set out to build a screen.
Neither is visible to the forward question: a key nobody declared is not in the
set the forward loop walks.

**The gap was not theoretical, and the proof came from the gate's own scanner.**
Asked backwards, the repo produced exactly one violation:
`seo_distribution.redirect.purge`, from
`src/pages/api/v1/seo/redirects/[id]/lifecycle.ts`. That route guards on

```ts
action: (lifecycleAction === "purge" ? "delete" : "update") as "delete" | "update"
```

and `readActionValues` collected **every** string literal in the expression,
including the one the ternary tests **against**. So the scanner invented a third
permission the route never demands. Harmless for exactly as long as nothing read
the enforced set back — which is what the reverse direction does.

Both halves are fixed. Comparison operands are dropped before literals are
collected, and only the operand rather than the whole condition, because the two
comments routes write `decision === "approve" ? "approve" : "reject"` where
`approve` is both tested for and yielded. The operand is removed **whole, quotes
included**: blanking it to `""` re-pairs the surrounding quotes so the gaps
between the real literals start matching as literals themselves — this fix's own
first draft did that and invented four permissions per route, which is why it is
pinned by a test.

The staleness rule had to change with it. It was "an exception is stale if the
permission is not declared", and that makes an exception excusing an
**undeclared guard** impossible to write — recording one would immediately
report it stale. An exception is now stale only when it excuses nothing: neither
a declared permission that lacks an enforcer, nor a guard that lacks a
declaration.

The gate ships with the exception list still **empty**, both directions:
244/244 declared permissions have a guard, and every guard names a declared
permission.
