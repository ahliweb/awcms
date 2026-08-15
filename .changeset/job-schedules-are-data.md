---
"awcms": minor
---

feat(jobs): the schedule becomes data, and the jobs image ships from the release

`crontab -l` on the production host carried **one** of the 32 declared jobs.
Scheduled posts never published, the domain-event outbox was never drained, push
delivery was inert, reporting projections went stale, DNS never reconciled,
business-scope and subscription expiry never ran — so access outlived its
validity — and the **entire retention family** never ran, which means the
retention guarantees ADR-0094 states were enforced by nothing at all.

Nothing reported any of it, because a job that is never scheduled does not
produce an error. It produces silence.

`modules:jobs:check` already required every worker script to HAVE a descriptor
carrying a `recommendedSchedule`. That closed the half that could be closed
without deciding anything: the descriptor existed and the schedule was **prose**.
"Every 1-2 minutes via cron/systemd timer." is readable and unexecutable, so the
schedule lived in a document, the crontab lived on a host, and nothing compared
them.

**The schedule is now data.** `ModuleJobSchedule` is either
`{ mode: "cron", expression, backlog }` or `{ mode: "manual", because }`, and
`jobs:crontab:generate` renders `ops/awcms-jobs.crontab` from the registry.
`jobs:crontab:check` fails when the artefact drifts and when any job declares no
schedule — a new job can no longer be born dormant. Of the 32: **23 belong on a
timer, 9 are structurally operator-run** (one-shot migrations, deploy gates, a
rollback), and each of those 9 states a structural reason rather than an
omission.

**The risky ones ship commented out, and that is the point.** Enabling these on a
deployment that has been up for months is not "resuming a schedule". For 18 of
them the first tick is one unbounded action against a backlog that accumulated
the whole time: every overdue post published at once, every queued push delivered
to real devices, every expired grant revoked mid-session, every row past
retention deleted in one pass. Each is the *correct* behaviour, and each deserves
to be seen once before it happens. So each renders as a commented line carrying
its own first-run note — installing the file cannot fire a mass delete, and
enabling one is a deliberate edit after a `--dry-run`.

**The other half: the jobs image now comes from CI.** The runtime image carries
only `dist/`, so no job target can execute in it — verified on the running
production container:
`bun run logs:audit:purge` → `Module not found "scripts/audit-log-purge.ts"`.
A `jobs` stage carries the same commit's sources, and `release.yml` publishes it
as `ghcr.io/ahliweb/awcms-jobs`. It replaces a hand-copied source snapshot on the
host that did not follow releases — so after every deploy the cron ran the
*previous* release's code against the *new* schema until someone remembered to
refresh it.

The new stage is placed **before** `runtime`, not after, and both build steps now
name their `target:` explicitly. `docker build` with no target builds the last
stage, and several things build this file that way; a jobs image published as the
application image is a deploy that succeeds and serves nothing.
