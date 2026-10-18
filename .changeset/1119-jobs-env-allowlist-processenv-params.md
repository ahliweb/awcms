---
"awcms": patch
---

fix(ops): scan `ProcessEnv`-typed parameters so the jobs env allow-list carries the VAPID and Telegram hash keys (#1119).

`ops/awcms-jobs.env-allowlist` is generated from the same scanner as `config:env:coverage:check`, and that scanner only recognised an environment object bound with `= process.env`. A function that merely RECEIVES the environment (`parseVapidConfig(env: NodeJS.ProcessEnv)`) was invisible, so a host running `push:dispatch` through `ops/run-job.sh` started the dispatcher with push enabled and no `PUSH_VAPID_*` material.

- The scanner now also treats a name DECLARED as `NodeJS.ProcessEnv` / `ProcessEnv` / `Readonly<…>` / `typeof process.env` as the environment (parameter, field or local, with or without a default), accepts generic annotations with commas (`Record<string, string | undefined> = process.env`), reads `env["X"]`, `env?.X`, `process.env["X"]` and `const { X } = env`, and no longer counts `env.X = …` assignments as reads.
- Newly on the allow-list: `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_VAPID_SUBJECT`, `TELEGRAM_CHAT_HASH_KEYS` (the encryption-ring resolver `telegram:dispatch` calls checks distinctness against it, so a job without it passed that guard vacuously; removed from `WEB_ONLY`), `DATABASE_POOL_MAX`, `DATABASE_WORK_CLASS_QUEUE_MULTIPLIER`, `TAX_TAXDATE_PAST_DAYS`, `TAX_TAXDATE_FORWARD_DAYS`.
- Computed reads the scanner cannot see are now declared in `COMPUTED_ENV_READS`, each with a code-shape `needle` that is matched against the file with comments stripped (so a doc comment cannot keep a stale entry alive): `WORKER_DATABASE_URL` (read only as `process.env[name]`, so every job silently fell back to the `awcms_app` connection instead of `awcms_worker`) and `DATABASE_POOL_MAX_WORKER` join the allow-list. Declared but kept web-only in `WEB_ONLY`: `SETUP_DATABASE_URL`, `DATABASE_POOL_MAX_SETUP`, `AUTH_IP_HASH_SECRET`, `PLATFORM_TENANT_ID` (no cron job imports `client-fingerprint` or `platform-tenant`, directly or transitively), every `DATABASE_CAPACITY_*` (read only by the pool-health route and `database:capacity:check`), and `SETUP_RATE_LIMIT_MAX` / `SETUP_RATE_LIMIT_WINDOW_SEC`.
- `.env.example` gains commented placeholders for the pool override, capacity and work-class variables.

Deployments that already pass the whole env file (compose `env_file:`) are unaffected. Hosts using `ops/run-job.sh` must redeploy `ops/awcms-jobs.env-allowlist` beside it and make sure the new names exist in the app container's environment.

**Rollout note (production hosts).** Hosts that set `WORKER_DATABASE_URL` will now run worker-client jobs through `ops/run-job.sh` as the least-privilege `awcms_worker` role instead of silently using `DATABASE_URL`. That is the documented behaviour but it is a role switch:

- Before redeploying `ops/awcms-jobs.env-allowlist`, verify grants (for example `has_table_privilege('awcms_worker', '<table>', …)` for each job's tables) or run one manual tick per job with the worker DSN.
- Watch the first ticks, especially `push:dispatch`, `booking:*`, `tenant-domain:dns:sync` and `idn-regions:*`.
- Do not roll back to `DATABASE_URL`; fix the grant instead.

See `docs/awcms/deploy-coolify.md` (§Rollout: jobs started through `ops/run-job.sh` now use `WORKER_DATABASE_URL`).
