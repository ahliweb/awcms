---
"awcms": minor
---

feat(newsletter): a reader can join a list, and leave it without logging in (#598, ADR-0103)

There was no newsletter capability of any kind, and it is easy to mistake for
something that already existed. The `email` module is complete and mature —
templates with a per-category variable allow-list, an outbox with lease claiming,
retry and backoff, a circuit breaker, per-address suppression. **It can send
mail.** What was missing is a different thing: a subscriber list a reader can
join from a public page. No subscriber table, no endpoint anyone could POST to,
no double opt-in, no unsubscribe, no admin screen.

The legacy portal has all of it and is live, so migrating a second tenant without
this would be a functional **regression**, not a gap.

### Why not part of `email`

The reuse gate rejected the obvious home on the interesting ground. `email`
answers "may this address be written to, and did the message arrive" — an
operational question about deliverability. A subscription answers "did a person
ask for this, when, from where, and can they prove they stopped asking" — a legal
question about consent, whose record must survive independently of whether any
message was ever sent.

Folding them together would make `awcms_email_suppressions` mean both "this
address bounced" and "this person withdrew consent" — the first an operational
fact an operator may clear, the second a decision they must not.

### Four states, and the fourth is not the third

`pending` → `active`, with `unsubscribed` and `suppressed` as terminal branches.
Re-subscribing is allowed from one and not the other: somebody who unsubscribed
in March may sign up again in June, and letting them is correct, while an address
suppressed for abuse must not be re-addable by whoever is abusing it. A single
`inactive` state would make that a matter of remembering rather than of the type
— so the refusal lives in the `ON CONFLICT` statement itself, where no future
caller can forget it.

### The public endpoints tell nobody anything

All three are anonymous, per-IP rate-limited, and answer the **same neutral
body** for every outcome: a new address, one already active, one suppressed, and
a host that resolves to no tenant. A distinguishing response turns a public
endpoint into a way to ask "is this person subscribed to this newsroom's list",
and for a news site in Central Kalimantan that has consequences for the person
being asked about.

The tenant is resolved from the request **host**, never a header, so a caller
cannot choose whose list they are writing to (FR-NWL-002). Idempotency
(FR-NWL-005) rests on the unique index over `(tenant_id, email_normalized)` and
one statement — not a read-then-write two concurrent submissions could interleave
with.

### Consent is recorded when it is given

`consent_at` is written when the confirmation link is **followed**, never at
submission, so the record says what happened rather than what was asked for.
There is no consent field on the request at all, which is stronger than
defaulting one to false (PRD §30). A CHECK refuses an `active` row with no
consent, and another refuses a suppression with no reason.

Both tokens are stored hashed — they are bearer credentials — and the unsubscribe
token is stable for the row's lifetime because it is printed in the footer of
every message the subscriber will ever receive.

### Unsubscribing never requires a login

The endpoint takes the token and nothing else: no session, no tenant header, no
address (PRD §30). The row is **kept** — "this person asked to stop, on this
date" is what answers a later complaint, and deleting it leaves nothing to answer
with.

### The admin screen cannot add a subscriber

There is no form, deliberately: a subscription is a person's decision, and an
admin-side "add" would be a way to put an address on a list without consent. It
cannot display either token either. Suppression is the one write, and it requires
a reason, because it is the one state a subscriber cannot leave.

The pending count in the summary is load-bearing rather than decorative: a tenant
with no active `derived.newsletter_confirmation` template collects `pending` rows
that never advance, and this is where that becomes visible instead of silent.

Retention purges only unconfirmed `pending` rows — an unfinished request, and
keeping it forever means keeping an address nobody consented to. `active`,
`unsubscribed` and `suppressed` rows are never touched by it.
