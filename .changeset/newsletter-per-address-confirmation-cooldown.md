---
"awcms": patch
---

fix(newsletter): the subscribe endpoint would mail-bomb any address, one IP at a time

`POST /api/v1/newsletter/subscribe` is anonymous and sends mail. Its only
defence was a per-IP limiter — 5 requests per 300 s — and the upsert behind it
re-issued a confirmation token on **every** submission for an address that was
not already `active` or `suppressed`. So each accepted request enqueued another
email to whatever address the body named.

**A per-IP limiter cannot defend the person being mailed, because that person
contributes no IP to the request.** One IP alone sustains 1,440 messages a day
at the default; rotating IPs removes even that. The mail goes out in this
deployment's name, from its sending domain, on its sending reputation — and for
a newsroom the resulting complaint is about the newsroom.

This was reachable only from 27 August. Until ADR-0118 the endpoint answered no
preflight and no browser could call it, so the omission had cost nothing; making
it reachable made it live.

## The fix: a ceiling on the other axis

`confirmation_sent_at` already existed on the row — no migration. The upsert's
`WHERE` gains one predicate, so a second confirmation to the same address is
refused until the cooldown has passed (`NEWSLETTER_CONFIRMATION_COOLDOWN_SEC`,
default 900 s).

It is a predicate **inside the existing statement**, not a read-then-write: two
concurrent submissions for one address would both read a stale timestamp and
both send. `ON CONFLICT` serialises them on the row, so the second sees the
first's write and is refused.

**The refusal is silent, and had to be.** A new row, a re-subscribe, an already
active address, a suppressed one and an address inside its cooldown now all
return the same neutral 200. Giving the cooldown a distinguishable answer would
have rebuilt the subscriber-enumeration oracle ADR-0103 designed the endpoint
not to be — from the one place nobody would look for it.

**A refused repeat leaves the row untouched.** It does not rotate
`confirmation_token_hash`, so the link already sitting in somebody's inbox keeps
working. Rotating it would have let an attacker invalidate a real subscriber's
confirmation link simply by submitting their address — turning the ceiling into
a denial of the subscription it was added to protect.

## Why not Turnstile

Six anonymous surfaces already call `enforceTurnstileIfRequired`, and adding a
seventh looked like the obvious move. It is not a fit here:
`TURNSTILE_EXPECTED_HOSTNAME` is a single value and the widget would be solved
on the SITE's hostname, not this one — that check exists to fail closed, and
cross-origin is the case it was not designed for. A challenge also asks the
wrong question: it bounds who may submit, and the defect was about who receives.
The two are complementary rather than alternative, and only one of them is
needed to close this.

## Proven against a real database

Six integration tests, because the ceiling is SQL and a mocked `Bun.SQL` would
answer however the test told it to: first submission issues a token; an
immediate repeat issues none; the stored token hash and timestamp are unchanged
by a refused repeat; a genuine retry after the window is served again (a ceiling
that never lifts is an outage, not a ceiling); a cooldown of zero reproduces the
old behaviour exactly; and a suppressed address stays refused however far its
timestamp is aged. Removing the predicate turns two of the six red.
