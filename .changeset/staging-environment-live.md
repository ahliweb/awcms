---
"awcms": patch
---

Record the real state of the deployed environments: staging is live at
`awcms-staging.ahlikoding.com` (own Coolify app and database, R2/email/sync off),
production DNS and app already existed, and `awcms-micro-staging` has been
removed.

Also documents why `db:migrate` cannot run via `docker exec` on the production
image — it is runtime-only and does not ship `scripts/` — and gives the one-shot
container command instead. Staging has no schema until that is run.

Documentation only.
