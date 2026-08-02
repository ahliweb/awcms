---
"awcms": minor
---

Build the `awcms` half of ADR-0050: a BFF obtains a human session with a one-time handoff code, never by proxying a password.

ADR-0049 answered half the question — a BFF that already holds a session token can ask "whose session is this". Where the token came from was still document-only. `awcms_session` is an httpOnly cookie on the `awcms` origin; a browser on the `awcms-astro` origin will never send it, and must not.

The obvious workaround — a login form in `awcms-astro` proxying `POST /api/v1/auth/login` — was rejected twice over: a password would cross a repo that is not the identity store, and **login here is not one step**. It can answer `401 MFA_REQUIRED`, redirect into a tenant's OIDC provider, or demand a Turnstile token, so proxying means a second implementation of MFA continuation, OIDC callback, and the Turnstile widget in a second repo.

**Two endpoints, two different principals:**

- `POST /api/v1/auth/session-handoff/issue` — the already-authenticated human asks for a code. Self-service rather than permission-gated: the identity and assurance come from the presented **session**, never from the body, so a caller can only ever mint a code for themselves. Inventing a permission here would be the latent-authz trap this repo has shipped twice.
- `POST /api/v1/auth/session-handoff/redeem` — a registered client, server-to-server, with a client secret. The only endpoint in this repo authenticated that way, which is why `_shared/tenant-route.ts` gains a third factory: this is the request that *obtains* a session, so there is none to present, and a machine credential (read-only by construction) minting a human session would be an escalation path.

**What binds the security:**

- **Exact-match `redirect_uri` allow-list.** ADR-0050 names the open redirect here as the way this design fails. Not a prefix — `https://app.example.com` prefix-matches `https://app.example.com.evil.test` — and not an origin match either, since an attacker who can choose the path on a permitted origin is enough. Query strings and fragments are refused rather than stripped.
- **The code carries no token.** The row stores `identity_id` plus the assurance the login actually *reached*; redemption mints a fresh session. Nothing credential-bearing is stored but the one-way hash of the code, and assurance never rises, so an `aal1` login cannot be laundered into an `aal2` session.
- **Single-use under concurrency**, claimed with `UPDATE … WHERE redeemed_at IS NULL RETURNING …`. The read-then-write version lets two simultaneous redemptions both succeed.
- **The spent row is kept**, so a replay is answered from evidence — a deleted row and a code that never existed are indistinguishable, and that difference is what an incident needs.
- **One answer for every failure** (`401 HANDOFF_REJECTED`), including a malformed body: a 400 for "you forgot a field" and a 401 for "your secret is wrong" already separates well-formed guesses from malformed ones.
- The ≤60 second TTL is a database CHECK, not only a TypeScript constant.

**A trap the integration test caught, and reading would not have.** `created_at DEFAULT now()` is the *transaction start* instant while `expires_at` is derived from the application clock — two different clocks, so the `expires_at <= created_at + 60 seconds` CHECK rejected perfectly ordinary codes once a transaction had been open for a moment. The application now writes both from one clock.

Ten integration tests, including two concurrent redemptions on separate connections (mutation-proven: dropping the `redeemed_at IS NULL` guard mints two sessions from one code) and cross-tenant isolation. Eighteen pure tests over the redirect-uri and redemption decisions.

What remains is `awcms-astro`'s: `/internal/login`, server-side BFF session storage, the portal cookie, and CSRF.
