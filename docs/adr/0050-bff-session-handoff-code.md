🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0050-bff-session-handoff-code.id.md)

# ADR-0050 — The BFF `awcms-astro` obtains a human session through a SINGLE-USE HANDOFF CODE, not by proxying passwords

- **Status:** Accepted
- **Date:** 2026-08-01
- **Decision maker:** @ahliweb
- **Closes the question deliberately left open by** [ADR-0048](0048-frontend-role-split-awcms-astro-internal-admin.md) §"What is NOT decided here" — "the shape of internal authentication in `awcms-astro`"
- **Continues:** [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md) (the BFF is the only data path), [ADR-0049](0049-machine-credentials-and-session-introspection.md) (`GET /api/v1/auth/session` already exists and is used here)
- **Related:** ADR-0027 (MFA/step-up), ADR-0028 (OIDC/SSO), ADR-0029 (Turnstile)

## Context

ADR-0048 gave `awcms-astro` owner/internal admin screens and **deliberately did
not answer how their users log in**. ADR-0049 solved half of it: a BFF that
ALREADY holds a session token can ask "whose session is this and is it still
alive?" through `GET /api/v1/auth/session`. What remained unanswered is the step
before it — **where that token comes from**.

What already exists in the code and constrains the answer:

| Fact                                                                                                                                          | File                             |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `POST /api/v1/auth/login` returns `{token, expiresAt}` **and** sets two httpOnly cookies (`awcms_session`, `awcms_tenant_id`, `SameSite=Lax`) | `src/pages/api/v1/auth/login.ts` |
| Login may return NO token: `401 MFA_REQUIRED` + an `mfaChallengeToken` to be redeemed at a separate endpoint                                  | ditto, ADR-0027                  |
| Login may be diverted entirely to the tenant's OIDC provider (redirect + callback)                                                            | ADR-0028                         |
| Login may require a Turnstile token on the full-online profile                                                                                | ADR-0029                         |
| Sessions are revoked en masse on password reset **and** when a tenant user is deactivated                                                     | `session-revocation.ts`          |

Those cookies belong to the `awcms` origin. A browser on the `awcms-astro` origin
will never send them, and must not — that is not a shortcoming needing a patch,
it is an origin boundary doing its job.

## Decision

**`awcms` remains the only place credentials are accepted.** `awcms-astro`
obtains a session through a **short-lived single-use handoff code**:

```
browser ──► awcms-astro /internal/login  (no credential form)
        ──► redirect to awcms /login?handoff=<BFF id>&redirect_uri=…
            ── the user logs in AT awcms: password, MFA, OIDC, Turnstile —
               every flow that already exists, not one of them reimplemented
        ──► redirect back to awcms-astro with a single-use `code`
BFF     ──► POST /api/v1/auth/session-handoff/redeem  (server-to-server)
        ◄── { token, expiresAt }   → stored server-side, mapped to a portal cookie
```

The rules that bind that shape:

1. **A password never crosses `awcms-astro`.** That repo is not an identity
   issuer (ADR-0047 §Alternatives, ADR-0048 §2); accepting passwords there makes
   it a credential surface with every obligation that comes with one.
2. **A handoff code is not a session.** Single use, short lived (≤60 seconds),
   bound to one registered BFF client and one `redirect_uri`, and exchanged
   **server-to-server** with the BFF client's credentials — not by the browser.
   A code leaked through logs/Referer is useless without those credentials.
3. **The session token never reaches the browser.** The BFF stores it server-side
   and only gives the browser its own portal cookie (`HttpOnly`, `Secure`,
   `SameSite=Lax`).
4. **Introspection is the source of truth, not a cache.** The BFF calls
   `GET /api/v1/auth/session`; a `401` means the session has ended and the portal
   logs out **right then**. This is not a formality: since PR #319, deactivating
   a tenant user revokes sessions immediately, so "already deactivated but still
   looking at internal screens" is a state that must be impossible.
5. **Reversing the logout order is a bug.** Call the `awcms` logout FIRST, then
   clear the portal cookie — the other order leaves a live session at the source
   of truth while the user believes they are out.
6. **CSRF at the BFF**: origin/Referer check **and** a double-submit token for
   every mutation. Either one alone is not enough (ADR-0045 §4).
7. **No shared cache** between the internal surface and the public surface
   (ADR-0048 §3).

## Rejected alternatives

**The BFF proxies the password** (login form in `awcms-astro`, the BFF calls
`POST /api/v1/auth/login` on the user's behalf). Rejected for two separate
reasons, and it is the second that decides it:

- The password would cross, and (however briefly) live in the memory of, a repo
  that is not the identity store.
- **Login here is not a single step.** It can answer `401 MFA_REQUIRED` +
  `mfaChallengeToken`, it can be diverted to the tenant's OIDC provider, and it
  can require Turnstile. Proxying it means reimplementing the MFA continuation,
  the OIDC callback, and the Turnstile widget **in a second repo** — three
  security flows that are already mature, tested, and ADR-backed here. A second
  copy of the MFA flow is the most expensive place to make a first mistake.

**A cross-site cookie (`SameSite=None`) for `awcms_session`.** Rejected: it moves
tenant selection, CSRF, and CORS to the client — exactly what ADR-0045 §3 rejects
— and it loosens a cookie that the `awcms` admin itself also uses.

**Making `awcms` an OIDC provider.** Rejected for now: `awcms` is an OIDC
**consumer** (ADR-0028). Becoming a provider means building a full protocol
surface (discovery, JWKS, token/refresh/userinfo, consent) for a single trusted
client on the same network. The handoff code is the part of that flow that is
genuinely needed, without the rest. If a third, untrusted client ever appears,
this decision gets revisited — and that is its own ADR.

**Machine credentials (ADR-0049) for the internal screens.** Rejected: they are
read-only by construction, so they cannot perform any admin action — and more
importantly, they erase per-user attribution. The internal screens are precisely
the surface that most needs "who pressed this button".

## Consequences

**What must be built in `awcms`** (not present when this ADR was written): a
handoff code table + registered BFF clients, `handoff`/`redirect_uri` parameters
on `/login` with a **strict `redirect_uri` allow-list** (an open redirect here
means handing the code to an attacker), and
`POST /api/v1/auth/session-handoff/redeem` which redeems the code once — under a
row lock, not read-modify-write.

**What must be built in `awcms-astro`**: the `/internal/login` route,
server-side BFF session storage, the portal cookie, CSRF, and a per-request
introspection call.

**Accepted cost.** One extra redirect on internal login, and the obligation to
keep the `redirect_uri` allow-list narrow. Both are paid once; a second copy of
the MFA flow would be paid every time that flow changes.

**Risks named so they can be refused.** A handoff code is short-lived credential
material. It must not appear in access logs, must not be forwarded through
`Referer`, and its redemption must be atomic. If any one of those three is not
met, this shape is no safer than the one rejected above — it merely looks safer.
