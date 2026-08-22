---
"awcms": patch
---

fix(ops): scheduled jobs wrote archives into a container deleted seconds later, with 81 of 171 environment variables missing

`ops/run-job.sh` ran every scheduled job with `docker run --rm` and **no
volume**. `data-lifecycle:archive-purge` and `reporting:exports:dispatch` wrote
their artefacts into a filesystem that was destroyed seconds later, while
`awcms_data_lifecycle_archive_manifests` and `awcms_report_export_runs` recorded
them as PRESENT. The README's restore procedure could not be executed and a
scheduled export 404'd on download.

Nothing failed, and that is the whole difficulty: writing the file really did
succeed. The job exits 0, the row says the archive exists, and the first person
to find out is whoever needs the restore.

A host directory is now mounted over the container's `var/`. One mount covers
both, because both roots default to `./var/...` relative to the working
directory — and a test pins that container path to the image's actual `WORKDIR`,
so a Dockerfile change that moves one without the other cannot land quietly.

**The environment was worse than the finding said.** The hand-maintained prefix
pattern dropped **81 of the 171** variables this codebase reads, not ten. Among
them:

- `DATA_LIFECYCLE_ARCHIVE_ROOT_PATH` and `REPORTING_EXPORT_ROOT_PATH` — the two
  paths that decide where the artefacts above are written at all;
- every `TENANT_DOMAIN_CLOUDFLARE_*` variable, because `^CLOUDFLARE_` is anchored
  and those do not start with it, so `tenant-domain:dns:sync` ran with no API
  token and no zone;
- every `VISITOR_ANALYTICS_*` variable, including the retention windows
  `analytics:purge` exists to enforce;
- `SYNC_HMAC_ALLOW_LEGACY`, `SITE_SEARCH_*`, `TURNSTILE_*`, `TRUSTED_PROXY_*`.

A job that does not receive a variable takes the code's default, does the inert
thing, and reports success.

Selection is now by exact NAME from `ops/awcms-jobs.env-allowlist`, **generated**
by `bun run jobs:env-allowlist:generate` from the same source
`config:env:coverage:check` reads, and held by a new gate in `bun run check`. A
hand-kept pattern goes stale the day somebody adds a variable; a generated one
cannot fall behind the code without a gate going red. Exact-name matching also
means a lookalike (`DATABASE_URL_LOOKALIKE`) is not copied, which no prefix
pattern can promise.

Two refusals, because both silent alternatives produce a job that runs and
reports success: an unreadable allow-list, and copying zero variables, each stop
the run. A `*_ROOT_PATH` pointed outside the mount is named in the log rather than
tolerated — that is the same defect wearing a configuration, and its symptom is
identical to success.

The env selection is not merely asserted as source: the runner's own `awk`
expression is executed over a fixture environment against the real generated
allow-list, which is the only way to tell exact-name matching from a prefix
match.
