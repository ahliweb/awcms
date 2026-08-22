---
"awcms": patch
---

fix(tenant-domain,media-library,workflow-approval): three declarations nothing read

PROJECT_STATE §4 **D7**, **D8**, **D15**. One habit: a value is declared, it
passes every shape check, and no runtime code reads it — so a gate that verifies
STRUCTURE reports "present" for something that decides nothing, and the next
reader takes the declaration as evidence of behaviour. The three resolved
differently on purpose.

**D7 — deleted, not wired.** `tenant_domain` declared
`defaults: { defaultVerificationMethod: "manual" }` that nothing read, so every
domain is created with `verification_method = NULL` and `verify` answers
`missing_verification_method`. The repair that suggests itself — apply the
default at creation — is the one that must not be made: `verifyTenantDomain`
performs no verification of any kind. It checks the column is non-NULL and sets
`status = 'active'`; there is no DNS lookup anywhere on the route path. A NULL
`verification_method` is currently the only step between "a tenant created a
hostname row" and "that hostname is active" in host→tenant resolution, the
redirect allow-list and the canonical host. The settings block is gone with the
reasoning in its place, and the test that asserted the default now asserts its
absence plus the behaviour that must not change.

**D8 — moved from judgement to ledger.** `media_library.enforcement.read`/
`.enable` were filed as deliberate screening decisions reading "belongs with
/admin/security, not an object console" — and `/admin/security` carries the MFA
enforcement level and nothing about media. A relocation nobody performed is not
a judgement, and filing it as one kept both surfaces off the shrink-only ledger,
the one list that is supposed to say how much is unbuilt. Now 13 deliberate and
36 awaiting a screen, where it was 15 and 34.

**D15 — the comments, which is what the finding said the live defect was.** Two
composition roots explained the missing notification port with "the `email`
module has not been ported yet"; `email` is live and owns the adapter, whose own
header says "only a composition root may import this file" while having zero
importers. The two were each other's alibi. Both are corrected, and the port is
deliberately still not injected: nothing can reach the path (`startWorkflowInstance`
has no caller and no route creates an instance), so wiring it would add a second
declared-and-never-run thing and put an announcement enqueue inside the decision
transaction with no way to exercise its failure. A test pins the absence so the
change that gives instance creation a caller has to remove the pin deliberately.

Found while closing D7 and recorded as a new §4 item rather than fixed here:
**`POST /api/v1/tenant/domains/{id}/verify` verifies nothing.** Closing it needs
a real verification step plus a decision about what `manual` is allowed to mean,
which is a security change with an ADR in it — not a settings cleanup.
