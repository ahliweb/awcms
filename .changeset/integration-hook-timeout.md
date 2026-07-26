---
"awcms": patch
---

Stop the DB-gated integration suite racing bun's 5s per-hook default, and stop
it misreporting the result.

`setupIntegrationDatabase()` creates an ephemeral database and applies every
file in `sql/` as a subprocess, inside `beforeAll` — thirteen files each do
that, and the cost grows with every migration added. The CI step now passes
`--timeout 60000` (~30x the ~1-2s a warm setup takes, still far under the job
timeout) in both `ci.yml` and `release.yml`.

When it does get killed, the harness now says so. Exit 143 is 128 + SIGTERM: the
migration did not fail, it was terminated. The old message read "db:migrate
failed against the ephemeral integration database (exit 143)", which points a
reader at `sql/` — the one place the problem is not. Observed on PR #259 (run
30188228406), green on a re-run with no code change.
