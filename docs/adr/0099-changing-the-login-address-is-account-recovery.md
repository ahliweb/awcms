🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0099-changing-the-login-address-is-account-recovery.id.md)

# ADR-0099 — Changing the login address is account recovery, and is built like it

- **Status:** Accepted (not yet implemented)
- **Date:** 2026-08-15
- **Decision maker:** @ahliweb
- **Related:** [ADR-0096](0096-your-own-account-is-not-an-administrative-surface.md) (excluded it deliberately), [ADR-0087](0087-mfa-moves-to-the-principal.md) (step-up assurance), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.md) (maker/checker), `src/modules/identity-access/`, `src/modules/email/`

## Context

`/admin/account` renders the sign-in address and says, in as many words, that it cannot be changed here because doing so "needs proof that the new address is yours". ADR-0096 put it outside its own scope on purpose: everything else on that screen is profile editing, and this is not.

The reason it is not is worth stating precisely, because it decides the whole design. **The login address is the account.** It is the identifier a password reset is sent to, so whoever controls it can obtain the account without knowing the password. A control that changes it is therefore a control that can _transfer_ an account, and it sits one hijacked session away from an attacker who has no credential at all — the classic chain being: borrow a session for sixty seconds, repoint the address, walk away, and reset the password at leisure from an address the real owner cannot see.

That makes this the highest-risk self-service action in the product, above the password change beside it: changing a password with a stolen session locks the owner out _visibly_, while changing the address locks them out _silently_ and hands over the recovery channel.

So the question is not "how do we let somebody edit this field". It is "what proof, and what notice, make an address transfer safe" — and the brief for this decision is the most secure option available, not the most convenient.

## Decision

1. **Two addresses must both be proven, and they are proven differently.**

   - The **new** address is proven by a one-time token emailed to it and returned by the person. Nothing changes until it is returned; an unconfirmed request is inert.
   - The **old** address is not asked to prove anything — it is _notified_, immediately, with a single-click **cancel** link that is valid for longer than the confirmation window. The owner does not have to notice in time to stop it; they have to notice at all.

   A design that only verifies the new address is the common one and is exactly the silent-transfer hole above: the victim's mailbox never hears about it.

2. **The change requires fresh proof of the CURRENT session's owner.** Re-authentication immediately before the request: the current password, and a second factor when the principal has one (ADR-0087's step-up, `aal2`). A session alone is not sufficient authority to move the recovery channel — that is the whole threat.

3. **The token is single-use, short-lived, hashed at rest, and BOUND.** It is stored as a hash — the same treatment as a session token — and carries the identity, the current address and the requested address. Binding is what stops a token minted for one change being replayed after a later one; an unbound token is a bearer credential for "change this account's address to whatever it says now".

   The confirmation window is deliberately short (hours, not days) while the **cancellation** window from decision 1 is longer. The asymmetry is the point: the safe action gets more time than the dangerous one.

4. **Confirmation revokes every other session and every outstanding reset token.** If the request was an attacker's, the confirmation is the moment their access must end; if it was the owner's, being signed out elsewhere is a mild cost they can explain. The reset tokens matter as much as the sessions — leaving one alive would leave a second key under the mat pointing at the _old_ address.

5. **It is rate-limited per identity and per address, and it is audited as high-risk** — requested, confirmed, cancelled and expired all recorded, with both addresses masked per doc 04. The audit row is what answers "when did this account's recovery channel move, and who asked", which is the first question of any incident that starts here.

6. **The address is not free-form: uniqueness is enforced at confirmation, not at request.** Checking uniqueness when the request is _made_ turns the form into an account-existence oracle — type an address, learn whether somebody already signs in with it. Checking at confirmation means the prober must already control the address they are asking about, at which point they have learned nothing they could not learn by trying to log in.

7. **This is self-service only. There is no administrative sibling.** ADR-0096's reasoning holds: changing somebody else's sign-in address is account takeover with a permission attached. The recovery path for a person who has lost access to their address is an _invitation_ to a new identity plus deactivation of the old one — two audited actions by two surfaces that already exist — not one silent repoint.

## Consequences

- **Positive:** the account transfer chain is closed. A borrowed session cannot move the recovery channel: it fails at decision 2 without the password, at decision 1 without the new mailbox, and it announces itself to the old mailbox regardless.

- **Positive:** every failure mode is _reversible from the victim's side_. Decision 1's cancel link, decision 4's session revocation and decision 5's audit trail mean the worst case is an interruption rather than a lost account.

- **Trade-off, and it is real:** this is more machinery than any other control on `/admin/account` — a token table, two email templates, four endpoints and a confirmation screen — for a field most people change once. The alternative is the version that exists on many products and quietly loses accounts, and this repo has already recorded what it costs to discover a control was decorative only after production.

- **Trade-off:** an owner who has lost access to the old address cannot use this flow at all, by construction. Decision 7 names the path that serves them, which is deliberately administrative and audited rather than automatic.

- **Neutral:** the outbound mail rides `src/modules/email`'s existing outbox and suppression list. Both notices are transactional and must be exempt from suppression logic that would let a prior bounce silence the security warning in decision 1.

- **Rejected: change-on-confirm without notifying the old address.** It verifies the right thing and tells the wrong person. The notification is the only part of this design that helps somebody who has _already_ been compromised, which is precisely the case the rest of it cannot reach.
