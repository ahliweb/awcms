🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0096-your-own-account-is-not-an-administrative-surface.id.md)

# ADR-0096 — YOUR OWN account is not an administrative surface

- **Status:** Accepted (2026-08-14).
- **Context:** A product request — "user profile management". What was found
  when inspecting the code was not a missing feature, but rather **a feature
  that already exists entirely in the backend and has not a single surface**:
  seventeen self-service endpoints (`password/change`, `sessions` +
  `revoke-all`, MFA TOTP enroll/verify/disable, recovery codes,
  `sso/{provider}/link|unlink`, `auth/me`) and **ZERO** files in `src/pages` or
  `src/components` calling any one of them. All of them can only be reached
  with `curl`.
- **Builds on:**
  [ADR-0058](0058-unenforced-permissions-disposition.md) §E (the latent-authz
  trap — an action that is not seeded denies EVERYONE),
  [ADR-0063](0063-ownership-grants-run-through-the-authorization-chokepoint.md) (per-handler gate,
  ownership enters as an `ownershipGrant` that WIDENS),
  [ADR-0051](0051-admin-screens-consolidated-in-awcms.md) (SYSTEM admin screens
  live in this repo), and
  [ADR-0095](0095-the-interface-speaks-the-readers-language.md) (display
  preferences belong to the principal).

## Why an ADR for a single page

Because the page is not the hard part. The hard part is one sentence: **what
someone may change about themselves without any permission at all**, and the
wrong answer here is a privilege escalation disguised as a profile editor.

This repo has already decided half of it implicitly — `GET /api/v1/auth/sessions`
and its siblings are deliberately NOT permissioned — but that decision is
scattered across comments in seventeen files and was never written down as a
rule. Adding a write (`display_name`) without writing it down is how that rule
drifts.

## Decision 1 — A subject who IS the caller needs no permission

A self-service route is recognised by one structural property, not by intent:
**it does not accept a parameter that can point at anybody else.** Not
`tenantUserId`, not `profileId`, not `identityId`. Its subject is derived
SERVER-side from the calling session, so there is nothing to authorize beyond
"is this session alive".

Creating a permission for that is not merely excessive, it is **damaging**:
ADR-0058 §E records that an action which is not seeded denies everyone including
the tenant owner, while the code reads as though it were guarded correctly. An
`identity_access.own_profile.update` would land as a universal 403 on the page
that of all pages must not have a wall — and
[project memory](../awcms/agent-memory.md) records that this class of defect has
already claimed a victim in `awcms-admin-abac-write-notes`.

What is therefore NOT built: there is no permissioned sibling for these routes.
Changing SOMEONE ELSE'S language OR display name is not a feature; what exists
is `PATCH /api/v1/profiles/{id}`, which is administrative and is permissioned.

## Decision 2 — Self-service routes are SEPARATE from their administrative counterparts

`PATCH /api/v1/auth/profile` writes the same columns as
`PATCH /api/v1/profiles/{id}`. It remains a SECOND route, not a loosening of the
first.

The rejected alternative: adding an "…or this profile is yours" branch inside the
permissioned endpoint. That pushes an ownership check into an administrative
surface — exactly the shape ADR-0063 replaced with a per-handler gate plus an
`ownershipGrant` that WIDENS. Once a single endpoint has two authorization modes,
its reader must prove which branch applies before being able to state anything
about its security.

A separate route makes the question disappear: one of them does not accept an id
at all.

## Decision 3 — Self-service writes LITTLE, and the list is frozen

What someone may write about themselves: `display_name`, locale, theme, password
(with the old password), their own MFA factors, their sessions, their SSO links.

What they may NOT, even though it sits on the same table row:

| Column                              | Why not                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `legal_name`                        | `verification_status` exists precisely because the legal name is ASSERTED and then CHECKED. A subject who can rewrite it makes the verification meaningless. |
| `status`                            | Deactivating/activating yourself is a tenant decision, not a preference.                                                                                     |
| `verification_status`, `risk_level` | Assessments ABOUT that person, not statements BY that person.                                                                                                |
| identifier (email/phone)            | Changing the login address is account recovery, not profile editing — it requires proof of ownership of the new address, which is out of scope for this ADR. |

This list is frozen in the same sense as the ADR-0039 list: adding to it is an
edit that must be read as a security decision, not a field addition.

## Decision 4 — The page is CORE, not owned by a module

`/admin/account` goes into `CORE_NAV_ENTRIES`, alongside Dashboard.

`sidebar-menu.ts` already wrote the reason before the page existed:
`/admin/profile` is named as one of the "pages this base does not have … they
arrive if and when their pages do". This is that arrival.

It does not belong to `identity_access` because every navigation entry of that
module (`Users`, `Roles`, `Invitations`) is an administrative screen with a
`requiredPermission`, and this page has none — placing it there would group it
with things it is not, under a section implying authority over other people.

The topbar avatar becomes a link to it, fulfilling the seam `AdminLayout.astro`
already documented ("micro's points at `/admin/profile`, a page awcms does not
have").

## Consequences

- Seventeen endpoints that could previously only be reached by `curl` get a
  surface. This closes a gap `admin:screen-coverage:check` **cannot** see: that
  gate asks "is every PERMISSION claimed by a screen", and these routes are
  deliberately unpermissioned — so their zero surface never turned anything red.
- The theme is now stored per-human, not only per-device. `localStorage` remains
  the fast path (the toggle works without the network), and the stored value
  applies on a NEW device via the `data-tenant-default-theme` seam — without
  touching a byte of the init script, so its CSP hash stays intact (ADR-0095).
- Changing the login address is NOT included, stated as a knowingly accepted gap
  rather than passed over in silence: it demands proof of ownership of the new
  address and that is its own ADR.
