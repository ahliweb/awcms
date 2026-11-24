---
"awcms": minor
---

feat(admin/email): `/admin/email-webhooks` (Mailketing callback addresses with issue, rotate and revoke, and the quarantine of unauthenticated provider events with confirm-into-suppression and dismiss), `/admin/email-queue` (the outbound queue, keyset-paged, with cancel for queued and retry-waiting messages) and an explicit "use the deployment sender as the default" control on `/admin/email-senders` (Issue #1162). No new endpoint and no migration: every permission (`email.webhook.read`/`.configure`, `email.provider_events.approve`, `email.message.read`/`.cancel`) was already seeded and enforced; they leave the not-yet-screened ledger. Recipients stay masked, the callback address is shown once and never rendered by the server, the sender address stays masked, and the test send is tracked in #1521. The client asset budget is raised by 3,525 B for the two page scripts.
