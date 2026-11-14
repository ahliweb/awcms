---
"awcms": minor
---

feat(email): `/admin/email-senders`, the operator screen for the tenant's Mailketing accounts and sender identities (Issue #1162, ADR-0151 sections 2, 6 and 7, ADR-0149). A sidebar entry gated on `email.senders.read`; no migration (the permissions were seeded by `sql/347`). It reuses the screens beside it rather than building a second mail console: templates, suppression and newsletter stay where they are, and connecting, replacing a credential or disconnecting an account stays on `/admin/channel-accounts/{id}`, which this page links to and does not duplicate.

**What it shows:** each Mailketing account with its connection state, API v2 label, credit and last check; each sender identity with the verification the provider last reported, the dispatcher's own hold reason, its queue and whether it is the default of its brand; the deployment sender's lane; and the v1 to v2 migration notice of the deployment sender (not Mailketing, still v1, v2 not yet acknowledged through `EMAIL_MAILKETING_V2_VERIFIED`, invalid version, verified).

**Stale is not unknown.** A check older than `EMAIL_SENDER_HEALTH_MAX_AGE_MINUTES` reads "out of date", one that never happened reads "never checked", and neither is shown as verified. "Can send now" is `evaluateEmailSenderHealth`, the freshness gate the dispatcher holds mail by, so the page cannot say ready about a sender the queue would hold.

**Isolation:** accounts come from the channel registry under its own rules (assignment gate, business scope decided per row at the access chokepoint), and lanes and policies go through the new `filterVisibleEmailSenders`, which `GET /api/v1/email/senders` now also calls (same behaviour, one rule instead of two). Another tenant, another brand and an account assigned to someone else are invisible; an account whose Mailketing login the caller may not see contributes no credit, so its senders read "credit unknown" and are held. A channel registry that cannot be loaded reads "unavailable", never an empty list. No token, credential reference or whole address reaches the page: the sender address is masked to its first letter and its domain.

**One control, "Make default sender"** (`PUT /api/v1/email/sender-policy`, already permission-gated, idempotent and audited at `warning`), offered only where that endpoint would accept it and otherwise rendered disabled with its reason. A test send and remote list or campaign management are shown as not available yet, disabled and explained; Mailketing is outbound only and the page says so. No behaviour of the API, the queue or the dispatcher changes.

**Not delivered, recorded in the module README:** the webhook callback management and the provider-event quarantine review queue, a message-level queue list, an explicit "use the deployment sender" default, a connect wizard, a test send, and an approval flow for disconnect and rotation.
