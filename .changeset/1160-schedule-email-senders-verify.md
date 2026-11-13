---
"awcms": minor
---

feat(email): schedule `email:senders:verify` hourly as a named `awcms_app` exception (Issue #1160, ADR-0162). The job that reads each tenant Mailketing account's credit and verified senders (read-only GETs) and records account health is now on the generated crontab at `0 * * * *`, six times more often than the 360-minute `EMAIL_SENDER_HEALTH_MAX_AGE_MINUTES`, so tenant senders no longer go stale and get held. It remains a no-op unless `EMAIL_SENDER_ROUTING_ENABLED` is `true`.

The app-role scheduled jobs (`hr-commission:intents:post`, `omnichannel-inbox:sla`, and now this one) are a named, reasoned list, `APP_ROLE_SCHEDULED_EXCEPTIONS`, instead of a set hand-written inside two tests; `tests/jobs-app-role-exceptions.test.ts` holds it to the crontab in both directions (an unlisted crontab job that keeps `DATABASE_URL`, a stale entry, a missing ADR or reason, or a wrong entrypoint turns it red). The runner's own derivation of which jobs keep `DATABASE_URL` is unchanged; every other crontab job is still withheld it.

Open decision (ADR-0162 O1): moving the job to a dedicated database role. Operator action: reinstall the regenerated `ops/awcms-jobs.crontab`; no migration, no new variable.
