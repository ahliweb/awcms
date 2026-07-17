---
"awcms": patch
---

Fix profile identifier masking and duplicate handling (Issue #144, Issue #150),
both ported from awcms-mini.

- `maskIdentifierValue` now masks email-shaped values the way awcms-mini's
  `maskIdentifier` does: the domain and the local part's first character stay
  readable (`budi.santoso@example.com` -> `b***********@example.com`) instead
  of collapsing every address into an identical star run ending in `.com`. The
  masked columns exist so an admin can tell recipients apart in the email
  outbox and suppression lists; the generic tail mask made
  `to_address_masked`/`recipient_masked` useless for that. The email branch is
  detected from the value itself, so the `maskIdentifierValue(value)` signature
  and every existing call site are unchanged.
- `maskIdentifierValue` no longer leaks the last character of a short value:
  `"7788"` now masks to `****` (was `***8`) and `"12"` to `**` (was `*2`).
  A value of four characters or fewer has no non-leaking tail to show.
- `POST /api/v1/profiles/{id}/identifiers` now answers `409
  IDENTIFIER_ALREADY_EXISTS` when the identifier already exists for the tenant,
  instead of surfacing the unique-index violation as an unhandled `500`.
  `addIdentifierToProfile` translates Postgres `23505` into a new
  `DuplicateIdentifierError`; any other Postgres error is rethrown untouched.
  The route catches it inside `withTenant` so the translated error cannot count
  against the shared database circuit breaker.
