---
"awcms": patch
---

docs(adr): the two decisions PROJECT_STATE was waiting on — locale in the cache key, and changing the login address

ADR-0098 and ADR-0099, both `Accepted (not yet implemented)` and both bound to
their promised artifacts by `tests/adr-implementation-status.test.ts`, so the
status flips to plain `Accepted` in the same PR that lands the code and cannot
float free of it.

## ADR-0098 — the cache key carries the locale, in the PATH

ADR-0095 localised **no** public surface, because `vcl_hash` hashes only
`(host, url)`: one public URL whose body varies by cookie serves the Indonesian
page to an English reader, minutes later, on a page neither can re-render. The
prerequisite was recorded rather than implemented. This decides it on the stated
brief — best performance and most secure — and both candidate mechanisms lose:

- **`Vary: Cookie`** multiplies cache objects by the number of *distinct cookie
  strings* (session ids, analytics ids, CSRF tokens), so nearly every reader
  gets a private copy of a public page and the origin ends up paying for the
  cache's misses too. It also puts a credential-bearing header in the key.
- **`Vary: Accept-Language`**, normalised in VCL, bounds the fan-out at two but
  cannot see an explicit click — a reader who chose Indonesian on an English
  browser gets English forever, making the language switcher decorative on the
  surface most readers see. This repo has already shipped, broken and fixed that
  switcher twice.

So the locale goes in the path. `vcl_hash` is not touched, no `Vary` is added to
any cacheable public response, and hit rate is *unchanged* rather than merely
acceptable — object count grows with the number of locales (2), not with readers
or header permutations. **No request header enters the cache key at all**, which
is what removes the cache-poisoning class: those attacks work by making the key
disagree with the body, and there is no disagreement available when the path is
both.

Selection happens by a `private, no-store` **307**, so the cookie is honoured
without ever reaching the cache — the property `Vary` cannot have. The
prohibition on `Vary: Cookie`/`Accept-Language` is to be *enforced* by
`edge-cache:surfaces:check`, not documented, or decision 1 is a convention the
next person reaches past.

## ADR-0099 — changing the login address is account recovery

ADR-0096 excluded it on purpose, and the reason decides the design: **the login
address IS the account**. It is where a password reset is sent, so whoever
controls it can take the account without knowing the password. That makes it the
highest-risk self-service action in the product — changing a password with a
stolen session locks the owner out *visibly*, while changing the address locks
them out *silently* and hands over the recovery channel.

Both addresses are proven, differently. The **new** one by a single-use,
short-lived, hashed, **bound** token (an unbound token is a bearer credential
for "repoint this account"). The **old** one is not asked to prove anything — it
is notified immediately, with a cancel link valid **longer** than the
confirmation window, so the owner does not have to notice in time, only to
notice at all. That notice is the only part of the design that helps somebody
who has *already* been compromised.

Plus: fresh re-authentication (password, and `aal2` where a factor exists),
because a session alone is not authority to move the recovery channel;
confirmation revokes every other session **and every outstanding reset token**;
uniqueness checked at confirmation rather than at request, so the form is not an
account-existence oracle; and deliberately **no administrative sibling**,
because changing somebody else's sign-in address is account takeover with a
permission attached.

The Indonesian mirrors carry the translated status qualifier
(`Accepted (belum diimplementasikan)`), matching ADR-0067's precedent — which is
also why the status gate scans them without a second map keyed by mirror name.
