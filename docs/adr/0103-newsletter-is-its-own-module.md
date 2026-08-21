🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0103-newsletter-is-its-own-module.id.md)

# ADR-0103 — A subscriber list is its own module, and the public endpoint tells nobody anything

- **Status:** Accepted
- **Date:** 2026-08-21
- **Decision maker:** ahliweb
- **Related:** Issue #598; PRD LenteraKalteng §22, §30, FR-NWL-002, FR-NWL-004, FR-NWL-005; ADR-0055 (the reuse gate); ADR-0041 (`comments` — the other anonymous public write); ADR-0094 (subject rights)

## Context

There is no newsletter capability of any kind, and this is easy to mistake for something that already exists.

The `email` module is complete and mature: templates with a per-category variable allow-list, an outbox dispatcher with lease claiming, retry and backoff, a circuit breaker, and per-address suppression. **It can send mail.**

What is missing is a different thing: **a subscriber list a reader can join from a public page.** No subscriber table, no endpoint anyone can POST to, no double opt-in, no unsubscribe, no admin screen. "The email module can send" and "there is a subscription list" are two capabilities, and only one exists.

The legacy portal has this and it is live (`subscribe.php` + `newsletter_subscribers` + an admin screen, since 16 August 2026). So migrating SeputarBorneo as the second tenant would be a functional REGRESSION, not a feature gap.

### The reuse gate, run before building anything

ADR-0055 requires asking whether a desired capability extends an existing module.

**`email` — rejected, and this is the interesting one.** It is the obvious home: the list is a list of email addresses, and `email` already owns addresses, suppression and delivery. The reason it is wrong is CONSENT. `email` answers "may this address be written to, and did the message arrive" — an operational question about deliverability. A subscription answers "did a person ask for this, when, from where, and can they prove they stopped asking" — a legal question about consent, whose record has to survive independently of whether any message was ever sent.

Folding them together would make `awcms_email_suppressions` do two jobs: it would mean "this address bounced" and "this person withdrew consent" in one column, and the first is an operational fact an operator may clear while the second is a decision they must not. That collision has a name in this repo — one word covering two things, where the half that ends up wrong is the legal one (`sql/137` made the same argument about `media.verify`).

**`profile_identity` — rejected.** A subscriber is not a user. They have no account, no session, and no tenant membership, and giving them a row in the identity graph would make "who has access to this tenant" a question with a much larger and much less interesting answer.

**`comments` — rejected**, though it is the closest structural analogue (anonymous public write, moderation, per-tenant isolation). Its charter is discussion attached to a resource. A subscription is attached to nothing.

## Decision

**`newsletter` is its own module**, owning one table, three anonymous public endpoints, and one admin screen.

### The lifecycle is four states, and the fourth is not the third

`pending` → `active`, with `unsubscribed` and `suppressed` as terminal branches.

`unsubscribed` is the SUBSCRIBER's decision. `suppressed` is the OPERATOR's or the provider's — a hard bounce, an abuse report, a legal instruction. They are kept apart because re-subscribing is allowed from one and not the other: a person who unsubscribed in March may sign up again in June, and letting them is correct. An address suppressed for abuse must not be re-addable by whoever is abusing it, and a single `inactive` state would make that a matter of remembering rather than of the type.

### Double opt-in, and the confirmation token is hashed

A row starts `pending` and carries no consent timestamp. `consent_at` is written when the confirmation link is followed — never at submission — so the record says what actually happened.

Both tokens are stored HASHED, never raw. They are bearer credentials: whoever holds the confirmation token can confirm a subscription, and whoever holds the unsubscribe token can end one. A database read must not hand either over, for the same reason session tokens are stored hashed.

The unsubscribe token is STABLE for the row's lifetime, because it is printed in the footer of every message the subscriber will ever receive. Rotating it would break every link already in someone's inbox.

### The public endpoint is not an enumeration oracle

`POST /api/v1/newsletter/subscribe` is anonymous and rate-limited per IP. It answers **the same neutral body for every outcome**: a new address, an address already `active`, an address that is `suppressed`, and a malformed one that passed the shape check. It never says which.

This is the decision that costs something and is worth it. A distinguishing response turns a public endpoint into a way to ask "is this person subscribed to this newsroom's list", and for a news site in Central Kalimantan that is a question with consequences for the person being asked about. The cost is that a reader who mistypes their address gets no feedback beyond "check your mail" — accepted, and the same trade `POST /api/v1/auth/password/forgot` already makes here.

Idempotency (FR-NWL-005) falls out of the same design: a second POST for the same address does not create a second row, and does not tell the caller that it did not.

### Unsubscribe never requires a login

PRD §30. The unsubscribe endpoint takes the token and nothing else — no session, no tenant header, no email address. Requiring any of those would mean a person who wants out has to prove who they are first, which is both hostile and unnecessary: the token already proves they hold the link.

### Tenant isolation is FORCE RLS, and it is tested negatively

FR-NWL-002. One tenant's subscribers must be invisible to another, and the anonymous endpoints resolve the tenant from the request host rather than a header, so a caller cannot choose whose list they are writing to.

### The retention and subject-data descriptors are not optional

An email address is personal data. `subject-data:coverage:check` demands a descriptor and would refuse the table without one. A `pending` row whose confirmation was never followed is retained briefly and purged — it is a record of an unfinished request, and keeping it forever means keeping an address nobody consented to.

## Consequences

- One more module, one more table, three more public routes to rate-limit.
- The neutral response makes debugging a subscription harder for support staff; the admin screen is where the real state is visible, behind a guard.
- A tenant that has not configured a `derived.newsletter_confirmation` template gets no confirmation mail, and a subscription therefore stays `pending`. That is the correct failure — silently activating without confirmation would be the wrong one — and the admin screen shows the count so it is discoverable.
