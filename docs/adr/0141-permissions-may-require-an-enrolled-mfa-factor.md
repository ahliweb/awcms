🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0141-permissions-may-require-an-enrolled-mfa-factor.id.md)

# ADR-0141 — A permission may require an enrolled MFA factor to be exercised

- **Status:** Accepted
- **Date:** 2026-10-14
- **Decision maker:** @ahliweb
- **Related:** Issue #977 (this ADR and its implementation; finding PS-13 of the phase-3 security review of [`docs/awcms/hr-payroll.md`](../awcms/hr-payroll.md) §17); [ADR-0027](0027-mfa-totp-session-assurance-step-up.md) (MFA, session assurance, the tenant MFA policy); [ADR-0087](0087-mfa-moves-to-the-principal.md) (the factor belongs to the person); [ADR-0053](0053-platform-scoped-permissions.md) (the precedent for a code-declared permission property enforced at the chokepoint); [ADR-0031](0031-segregation-of-duties-conflict-enforcement.md) (the precedent for an additive, deny-only chokepoint check); [ADR-0136](0136-configurable-payroll-segregation-of-duties-mode.md) §3 and [ADR-0137](0137-payout-account-encryption-at-rest-and-keyed-hashing.md) §4 (the two decisions whose step-up this makes load-bearing); blocks the acceptance wording of #959 and #960; refs #956

## Context

ADR-0136 §3 and ADR-0137 §4 apply step-up to the payroll-critical actions **conditionally**: required when the acting person has an enrolled factor, not demanded of a person who has none. That is the right shape, for the reason `password-change.ts` already spells out — `requireStepUp` denies any session that is not currently `aal2`, and a person with no factor can never reach `aal2`, so an unconditional step-up permanently locks out everyone without MFA.

The consequence was finding PS-13: **a holder with no enrolled factor performs reveal, relax-SoD, approve, finalise, pay and reverse with no second factor at all.** Both ADRs say a tenant "enforces it through its existing MFA policy", and that does not hold up:

- The tenant policy (`awcms_tenant_mfa_policies`, ADR-0027) is `optional` by default and is a setting for the **whole tenant**, decided by whoever administers it, not by the module whose permissions are at stake.
- `required_for_privileged` classifies "privileged" as holding **any** permission whose action is not `read`/`analyze`/`check`. It is enforced **at login** (an enrolment grant instead of a full session), so it asks every non-read holder in the tenant to enrol — a heavy lever for "the six permissions that move money" — and it says nothing at the moment of exercise.
- Nothing, anywhere, connects "this permission" to "its holder must be able to give a second factor". No issue built that, so the sentence in the ADRs described a control that did not exist.

> **A note on the citation.** The repository (ADR-0136, ADR-0137, `password-change.ts`) cited "ADR-0058 §E" for the rule _step-up must be conditional_. ADR-0058 as written is about four permissions with no enforcer, and its §E is the revocation migration; what it contributes is the **class** of trap — a requirement that nothing can satisfy denies everyone, while the call site reads as correctly guarded. The rule is correct; this ADR states it in its own words (§4) so that it no longer rests on a section that does not say it.

## Decision

### 1. A permission declares the requirement; the chokepoint enforces it at exercise

`ModulePermissionDescriptor.requiresMfaEnrolment?: boolean` (`MODULE_CONTRACT_VERSION` **4.3.0**, MINOR: purely additive, omitting it means "no requirement", which is what every existing descriptor meant). In `authorizeInTransaction`, **after** an ordinary decision has allowed, a request for a flagged permission is refused when the acting person has no **active** factor:

`403 MFA_ENROLMENT_REQUIRED`, with `details.reason` of `not_enrolled`, `enrolment_unavailable` or `machine_credential`, and a message that says what to do (see §3). It is recorded as **one** decision-log row (`deny`, `matched_policy = mfa_enrolment_required`), not an allow followed by a contradicting deny.

It is **deny-only** and runs only on a decision that already allowed: a caller who lacks the permission gets plain `ACCESS_DENIED` and learns nothing about the action or what it needs; and no grant, ownership basis or policy can make an unenrolled caller pass it. Enrolment is read fresh on every flagged decision and is never memoised in the authorization read cache — a self-service disable or an administrative reset must take effect on the very next request.

`evaluateFieldAccessInTransaction` applies the same check, so a field gated on a flagged key is not a way round the endpoint; it learns whether the request is a machine credential from the authorised context (`authorizeInTransaction` stamps `viaMachineCredential`), not from an argument a caller could omit. `POST /api/v1/access/evaluate` applies it to the caller's own enrolment so the preview agrees with the endpoint. An any-of caller (`defineTenantRoute`, `loadAdminScreen`) surfaces `MFA_ENROLMENT_REQUIRED` in preference to a sibling candidate's generic `ACCESS_DENIED`. The injected-keys test seam is **additive only** (unioned with the registry), so it can never narrow enforcement. There is **no migration**: the flag is declared in code and never read from a database column, for the reason ADR-0053 §3 gives for `scope` — a flag a row could clear is a requirement one `UPDATE` removes while every check stays green.

### 2. Options considered, and why this one

**Where the requirement is declared**

| Option                                                      | Security                                                                   | Operability                                                           | Compatibility                                                                                                     | Verdict                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **A. Flag on the permission descriptor (chosen)**           | The module that knows a permission is dangerous states it, in shipped code | No tenant setting to forget; costs nothing for unflagged requests     | Additive descriptor field; downstream templates mark their own permissions without editing an upstream file       | **Chosen**                                               |
| B. A central registry inside `identity_access`              | Same                                                                       | Every module author edits a security module to protect their own code | The shape ADR-0134 removed for domain-event consumers; a downstream template would have to patch an upstream file | Rejected                                                 |
| C. A per-tenant policy table (tenant picks the permissions) | Weakest: the requirement is exactly as strong as the tenant's diligence    | One more screen and one more thing a new tenant starts without        | Needs a migration and a default; a tenant that never opens the screen is the unprotected one — PS-13 again        | Rejected                                                 |
| D. Reuse `required_for_privileged` as the answer            | Coarse: forces every non-read holder to enrol, and only at login           | Tenant-wide, default `optional`                                       | Nothing new to build, and nothing that closes the gap at exercise time                                            | Kept as the tenant's own, separate lever; not the answer |

**Where it is enforced**

| Option                                                                     | Security                                                                                                                                                                                                                                                           | Operability                                                                                                                                                                                                                                                                                                      | Verdict    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **Exercise-time, at the chokepoint (chosen)**                              | One place that every grant path reaches: roles, groups, business-scope assignments, delegated access, the owner's blanket grant, a restored backup                                                                                                                 | The person is told what to do at the moment it matters and can fix it themselves; nobody is blocked from being granted a role before they have heard of the requirement                                                                                                                                          | **Chosen** |
| Grant-time (refuse to assign a flagged permission to an unenrolled person) | Not sufficient alone: the permission reaches people through at least five paths, one of them transitive (grant a role to a group and everyone in it holds it); and a factor removed _after_ the grant leaves a holder with the permission and nothing to stop them | Hostile: an administrator cannot pre-assign a payroll role to someone who has not yet been asked to enrol; a new tenant's owner is granted the **whole catalogue** at creation, before any factor can exist, so grant-time refusal either blocks tenant creation or needs an exemption that is itself the bypass | Rejected   |
| Both                                                                       | Adds nothing the exercise-time gate does not already guarantee                                                                                                                                                                                                     | Two code paths to keep in agreement across five grant surfaces in a sensitive module                                                                                                                                                                                                                             | Rejected   |

The early warning grant-time refusal would have given is provided instead by a **readiness report** (§5), which can list every holder — from every grant source, through the same `activeRoleGrants` fragment the chokepoint uses — without being a second enforcement point.

### 3. What the three refusals say, and why they differ

- **`not_enrolled`** — the person can fix this now: the message names `/admin/account`, which needs a session and no permission.
- **`enrolment_unavailable`** — `AUTH_MFA_ENABLED` is off, so nobody on the deployment can enrol. The message names an administrator rather than a screen that cannot help. This is **fail-closed**, deliberately unlike ADR-0027 §9 (where an unenforceable _login policy_ was left inert): an inert flag here would silently re-open the hole it exists to close on the deployments least likely to have noticed. The readiness report makes the configuration a go-live finding (§5).
- **`machine_credential`** — a credential can never hold a factor, and the account it is bound to may be a person who has one, so "enrolled" would be true of a request in which nobody presented anything. Refused outright; the message says no remedy exists for it.

### 4. Step-up stays conditional; this is not an unconditional step-up

The gate asks whether a factor **exists**. It never demands a fresh proof, never calls `requireStepUp`, and a test pins that. The rule from ADR-0136/0137 is unchanged and now has teeth:

| Person                  | Before                             | After                                                                                      |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| No factor               | allowed, no second factor, audited | **refused with the way to enrol** (not locked out: every unflagged permission still works) |
| Enrolled, stale session | step-up required                   | step-up required                                                                           |
| Enrolled, fresh session | allowed                            | allowed                                                                                    |

The owning module keeps calling `getMfaStatus` + `requireStepUp` exactly as `password-change.ts` does; with the flag set, the condition ("has a factor") is no longer something a person can avoid by simply not enrolling.

### 5. Bootstrap, and the readiness report

**A tenant with no enrolled holder is not locked out.** Enrolment (`POST /api/v1/auth/mfa/totp/enroll/{start,verify}`) needs a session and no permission, and sits outside the chokepoint (pinned by a test), so the way to un-refuse yourself cannot itself be refused. The bootstrap is: the owner (or any holder) enrols in `/admin/account`; the very next request is served — no restart, no admin action, no policy change. Everything unflagged keeps working throughout, which is what lets the person reach the enrolment screen at all.

`bun run security:readiness` gains two checks:

- **MFA enrolment is available when a permission requires an enrolled factor** — `critical`. If any module flags a permission and `AUTH_MFA_ENABLED` is not `true`, nobody can satisfy it and every flagged action is refused for everyone.
- **Holders of permissions that require an enrolled MFA factor are enrolled** — `warning`, never `critical`. Lists the tenants with a holder who has no active factor (ids and counts only, no names), restricted to tenants where the module is actually usable (a disabled module's holders cannot exercise anything, and listing every tenant's owner for a module nobody there can reach is noise). A holder in that state is not a vulnerability — the chokepoint already refuses them — they are a person about to be asked to enrol, and a gate that blocked go-live on it would make enrolment a precondition of deploying, which is the lockout this ADR avoids.

Both pass loudly, with their reason, while no module flags anything (the state this base ships in).

### 6. What `hr_payroll` must do when it lands

Set `requiresMfaEnrolment: true` on exactly these permissions in its descriptor (spelling per the §9 catalogue of the pack at that time — the matrix spells the action `finalise`):

`payout_accounts.reveal`, `runs.approve`, `runs.finalise`, `runs.pay`, `runs.reverse`, `compensation.approve`, `sod_policy.configure`, `rules.publish`.

Not flagged, on purpose: `calculate`, `lock`, `release` and the `read`/`create` family — flagging a routine permission is a lockout the tenant did not choose. The implementing issues must (a) set the flag, (b) keep calling the conditional step-up, and (c) carry a test for each flagged permission that an unenrolled holder receives `403 MFA_ENROLMENT_REQUIRED` and an enrolled one with a stale session receives `403 STEP_UP_REQUIRED`. The acceptance wording for #959 and #960 is updated accordingly (see `hr-payroll.md` §17, PS-13).

## Consequences

- **Positive:** a control of the kind ADR-0136/0137 pointed at now exists (see the first negative bullet for how much it proves); one enforcement point covers every grant path; a new module protects its own permissions without touching `identity_access`; no migration, no new table, no tenant setting to forget; zero cost for an unflagged request (a `Set` lookup); the refusal is a way forward, not a lockout.
- **Negative / accepted trade-offs:**
  - **The gate proves a factor EXISTS on the account, not that the account's owner holds it.** Enrolment needs only a session, so a party who has an unenrolled holder's password can sign in, enrol their own authenticator, and then pass the gate (and the conditional step-up) as that holder. The requirement closes the "no second factor at all" hole of PS-13; it does not defend against password theft before the legitimate holder has enrolled. The mitigation is operational and belongs before the first payroll permission is usable: run the holders readiness report (§5) **before enabling `hr_payroll` for a tenant** and have the legitimate holders enrol first, so that the first factor on every holder's account is theirs. The structural fix — re-verifying the password or `aal2` to start enrolment for holders of flagged permissions, and notifying the person on first-factor enrolment — is tracked in ahliweb/awcms#1004 and is not part of this ADR.
  - A flagged permission can still be **granted** to an unenrolled person. They find out at first use, and the readiness report finds them earlier. This is the price of §2's rejection of grant-time refusal.
  - A flagged request costs two keyed reads (identity → principal → active factor). Only flagged requests pay.
  - With `AUTH_MFA_ENABLED` off, a flagged permission is refused for everyone. This is deliberate and surfaced as a `critical` readiness finding; a deployment that wants payroll must enable enrolment.
  - A person who disables their own factor (or whose factor an administrator resets) loses the flagged permissions on the next request. That is the point, but it is also a reason for an enrolled holder to keep their recovery codes.
  - The roles screen does not yet mark which permissions require enrolment. A follow-up.
- **Neutral:** `MODULE_CONTRACT_VERSION` 4.2.0 → 4.3.0 and the family manifest follow it. No base module sets the flag, so the in-repo blast radius is zero by construction; the first user is `hr_payroll` (#957, blocked on its DPIA).

## Alternatives considered

- **Make payroll step-up unconditional** — rejected (§4): it locks out everyone without a factor, permanently, including the tenant owner.
- **Tell tenants to set `required_for_privileged`** — rejected as the answer (§2 D): it is the status quo ADR-0136/0137 pointed at, and it is what left PS-13 open.
- **Enforce on the permission's _role_ (a role flagged "needs MFA")** — rejected: the permission is the unit that is dangerous, and a role is something a tenant edits freely; a requirement on the role disappears when someone grants the permission through another role.
