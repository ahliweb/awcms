---
"awcms": patch
---

fix(ops): edge-cache:purge had no working scheduled runner, and the 18 reviewed jobs are now live

Two separate bugs, found while diagnosing why edited content stayed stale past its TTL on a real
deployment.

**`edge-cache:purge` was never actually running.** It's the documented exception in
`DOCUMENTED_EXCEPTIONS` (no module to hang a descriptor on, ADR-0043) — by design it never appears
in the generated `ops/awcms-jobs.crontab`, so nothing in `jobs:crontab:check` could ever catch its
absence. The only thing invoking it on the affected host was a hand-rolled, pre-existing cron entry
that had drifted (stale container/database names from an earlier rename) and had been failing on
every run. Its correct spec — every 10-30 seconds, per its own script header and
`docs/awcms/deployment-profiles.md` — needs a small stack of staggered cron lines (cron's native
grain is 60s); it uses per-row claim-lease (`FOR UPDATE SKIP LOCKED`), so those staggered runs are
safe to overlap, unlike the `runJob`-model jobs elsewhere in this file.

**`ops/run-job.sh`'s env whitelist was separately missing `EDGE_CACHE_*`.** Even a correctly
scheduled `edge-cache:purge` line would have silently run with `mode=off` regardless of the
deployment's real `EDGE_CACHE_MODE`/`EDGE_CACHE_PURGE_ENDPOINT` — confirmed by running it manually
and getting `endpointConfigured=false` against a container where both were set. One line added to
the `grep -E` allowlist.

**Separately: the 18 jobs `job-schedules-are-data` shipped commented out are now reviewed.** Found
all 18 enabled directly on a live host's crontab in one shot, bypassing the "uncomment ONE at a
time, after running it with `--dry-run`" process that same changeset put in place. 13 had already
been running for hours with zero real effect (empty queues on that deployment); the other 5
(`analytics:purge`, `comments:retention`, `data-lifecycle:archive-purge`, `push:queue:purge`,
`sync:objects:purge`) had never had a first run — one was minutes from firing blind. Paused those
5, ran each with `--dry-run`, confirmed zero pending items across the board, then reclassified all
18 descriptors from `backlog: "review-before-first-run"` to `"bounded"` and regenerated the
crontab. `jobs:crontab:check` now reports 23 active, 0 awaiting review, 9 operator-run.
