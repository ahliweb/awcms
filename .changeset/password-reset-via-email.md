---
"awcms": minor
---

Add email password reset — the flow this repo has shipped a template for since
`sql/014` and never had a caller for.

`email`'s `auth.password_reset` category, default template, and declared
variables (`userName`/`resetUrl`/`expiresInMinutes`) have existed unused all
along, so an operator who locked themselves out had no in-band recovery. Two
public endpoints (`POST /api/v1/auth/password/{forgot,reset}`), two pages
(`/forgot-password`, `/reset-password`), and one table (`sql/073`,
`awcms_password_reset_tokens`, RLS `FORCE`, only a `sha256` of a 256-bit CSPRNG
token ever stored) close it. Adapted from awcms-micro Issue #496.

**Neither endpoint is an oracle.** `forgot` returns one fixed 200 body for
every outcome — unknown identifier, inactive identity or tenant-user, SSO-only
identity, a non-mailable identifier, and a queued email are indistinguishable.
`reset` returns one generic rejection for not-found, expired, already-used,
deactivated-since-issue and password-login-disabled-since-issue. The specific
reason survives only in the tenant-scoped, RLS-protected audit trail.

**Single use is enforced by the database, not by JavaScript.** Redemption reads
the token `FOR UPDATE`; without that lock two requests carrying the same link
both observe `used_at IS NULL` and both reset the password. That is
mutation-proven — removing the lock turns the concurrency test red.

**An SSO-only identity cannot recover a password**, checked on the request path
and re-read at redemption so a live link does not survive the tenant turning
password login off. Without it, reset would be a supported, unauthenticated way
to mint a working password on a tenant that deliberately disabled them.
Break-glass identities are exempt, matching `login.ts`.

**A completed reset revokes every session of that identity**, `aal2` included,
and clears the lockout counters — the link holder proved control of the mailbox.

**Delivery goes through a new `auth_notification` capability port**, not an
`INSERT` into `awcms_email_messages`. That table belongs to `email` (ADR-0013
§6) and the micro original wrote into it directly; it also cannot be a
`dependencies` edge, because `email` already depends on `identity_access` and
the reverse would close a cycle. A tenant with no active template reports
`delivery_unavailable` — logged and audited for the operator, invisible to the
caller.

Optional hardening: with `AUTH_URL_PARAM_ENCRYPTION_KEY` set, the emailed link
carries one opaque AES-256-GCM `?p=` value instead of `?token=…&tenantId=…`.
Unset, it falls back to plain params — the token is a 256-bit CSPRNG value
either way, so this tightens a deployment rather than gating the feature.

Also: `/login`'s auth styles move to a shared `src/styles/auth.css` and its
tenant picker to `tenant-admin`'s `tenant-picker-directory.ts`, both now used by
all three auth pages instead of being copied twice.
