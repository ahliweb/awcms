🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](ci-local.id.md)

# Running every CI job locally (`bun run ci:local`)

> **What this is.** One command that runs, on your machine, the jobs GitHub
> Actions runs for a pull request — `ci.yml` (`quality`, `hygiene`,
> `integration-tests`, `minimum-supported`, `e2e-smoke`) and `changesets.yml`
> (`policy-check`) — with the same commands in the same order, and prints a
> summary table. Issue #1001.
>
> **What this is not.** It does not replace the ruleset. The required status
> checks in ruleset `11653326` still gate merging, exactly as before
> ([`branch-protection.md`](branch-protection.md)). `ci:local` is the
> verification **before push**: it exists so a branch is not pushed just to find
> out whether it is green.

## Quick start

```bash
bun run ci:local                         # every job
bun run ci:local --job quality           # one job (repeatable: --job a --job b, or --job a,b)
bun run ci:local --job hygiene --job changesets   # the two that need nothing but git

# the database jobs need a PostgreSQL SUPERUSER connection string:
CI_LOCAL_DATABASE_URL=postgres://postgres:...@127.0.0.1:5432/postgres \
  bun run ci:local --job integration --job e2e
```

Commit first. The `changesets` job diffs **committed** history against the base
(`origin/main` by default, `--base <ref>` to change it), so a changeset you have
not committed yet is invisible to it — the runner warns when the tree is dirty.

## The jobs

Jobs run **sequentially**, cheapest first (the order below), because they share
`dist/` and the machine.

| Local job           | Mirrors (`workflow` > job)        | What it runs                                                                                                                                     | Needs                          |
| ------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `hygiene`           | `ci.yml` > `hygiene`              | The Bun-only grep over `package.json` scripts; no tracked `.env` files. The workflow's shell, verbatim.                                          | bash, git                      |
| `changesets`        | `changesets.yml` > `policy-check` | Fetch the base, `bun install --frozen-lockfile`, `bun run changesets:policy:check` with `CHANGESET_POLICY_BASE_REF=<--base>`.                    | git history with a merge-base  |
| `quality`           | `ci.yml` > `quality`              | Fetch tags (the `version:check` gate needs them), frozen install, the **full** `bun run check` with `DATABASE_URL` blank.                        | —                              |
| `integration`       | `ci.yml` > `integration-tests`    | Throwaway database, frozen install, `bun run db:migrate`, `bun test tests/integration/ --timeout 60000`, then the legacy ad-hoc suite file list. | PostgreSQL superuser           |
| `minimum-supported` | `ci.yml` > `minimum-supported`    | On **Bun 1.3.0**: frozen install, `typecheck`, `build`, `family:conformance:check`.                                                              | Bun 1.3.0 (see below)          |
| `e2e`               | `ci.yml` > `e2e-smoke`            | Throwaway database, migrate, build, start the server, seed through `POST /api/v1/setup/initialize`, `bun run test:e2e`.                          | PostgreSQL superuser, Chromium |

The workflow job ids (`policy-check`, `integration-tests`, `e2e-smoke`) are
accepted as `--job` aliases.

## Options, results and exit codes

| Option         | Effect                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `--job <name>` | Run only this job. Repeatable or comma separated. Jobs always run in the fixed order.                 |
| `--base <ref>` | Base ref for the `changesets` job (default `origin/main`). An `origin/<branch>` ref is fetched first. |
| `--fail-fast`  | Stop at the first job that fails; the rest are reported as `skipped (not run)`.                       |
| `--keep-going` | The default: run every selected job even after a failure, so one run shows every red job.             |
| `--allow-skip` | Exit 0 when nothing failed but some job was skipped. The summary still says INCOMPLETE.               |
| `--list`, `-h` | List the jobs and their workflow counterparts; show help.                                             |

Within a job a failing step stops the job (as in Actions). Each job ends as one
of three results, and **a job that cannot run is never reported as `PASS`**:

| Result    | Meaning                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------- |
| `PASS`    | Every step exited 0.                                                                                      |
| `FAIL`    | A step failed; the detail names it and its exit code. The child's output is above the table.              |
| `SKIPPED` | The job could not run here; the reason is in the table (no database URL, no Chromium, no Bun 1.3.0, ...). |

| Exit code | Verdict      | When                                                            |
| --------- | ------------ | --------------------------------------------------------------- |
| `0`       | `PASS`       | Every selected job passed (or only skips, with `--allow-skip`). |
| `1`       | `FAIL`       | At least one job failed.                                        |
| `2`       | `INCOMPLETE` | Nothing failed, but at least one job was skipped: not verified. |
| `64`      | —            | Usage error (unknown job or option).                            |

So `bun run ci:local && git push` refuses to push after a skip, on purpose.

## Requirements

- **bash and git** on `PATH`. The workflow `run:` steps are bash scripts and are
  executed with `bash -e -c`, as Actions does. On Windows use WSL.
- **A PostgreSQL superuser connection** for `integration` and `e2e`, from
  `CI_LOCAL_DATABASE_URL` (falling back to `DATABASE_URL`). It is only ever an
  _admin channel_: each job creates a uniquely named database
  (`awcms_cilocal_<job>_<pid>_<time>`) on that server, points `DATABASE_URL` at
  it, and **drops it when the job ends, also on failure or Ctrl-C**. The runner
  itself creates and drops only that database (the migrations and the integration
  harness also create and alter cluster-scoped roles; see the next section). The
  password is never printed.
  The role must be a superuser (CI's is): the migrations run
  `ALTER ROLE ... SET` on a customised setting and the integration harness
  creates roles.
- **PostgreSQL version.** CI uses `postgres:18.4`. **16 and newer are accepted**
  (the version the migrations and RLS behaviour were verified on, and what local
  containers use); the summary notes when it is not 18. **Older than 16 is
  refused** (the job is skipped with the reason). Either way the GitHub job is
  authoritative for version-specific behaviour.
- **Bun 1.3.0** for `minimum-supported`: the `bun` on `PATH` if it is exactly
  that version, otherwise `bunx bun@1.3.0` (the npm package carries the binary;
  once cached it also works offline). It is placed first on `PATH` for that job
  only, so every nested `bun run` uses it. If neither works the job is
  **skipped**, never run on the wrong Bun. The other jobs use the `bun` on `PATH`;
  the runner prints it next to the version CI pins (1.4.2), because a different
  Bun is a source of "green locally, red on GitHub".
- **Playwright Chromium** for `e2e`. The workflow runs
  `bun run test:e2e:install` (`playwright install --with-deps`), which needs
  root/apt and the network, so the runner **verifies** the browser instead: the
  revision the installed `@playwright/test` expects must exist under
  `PLAYWRIGHT_BROWSERS_PATH` (or the default cache), or
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE` must point at a Chromium binary
  (`playwright.config.ts` honours it). Otherwise the job is skipped and says how
  to install it.

## What it does to your machine, and what to avoid

- **Use a dedicated PostgreSQL server** (a throwaway container is ideal), not the
  cluster behind a dev app you are running. The integration harness flips the
  **cluster-scoped** roles `awcms_app` and `awcms_worker` to `LOGIN` and back to
  `NOLOGIN` with a fixture password, and migration `019`/`022` create them. Two
  runs against one server therefore interfere with each other (the failure reads
  "not permitted to log in"), and so does anything else logging in as those
  roles. In CI every job has its own server; here that is on you. A server that is
  short of connections fails the same way ("too many clients already").
- It writes `dist/` (the build) and `playwright/.auth/` (both gitignored), as CI
  does, and reads `bun.lock` with `--frozen-lockfile`, so it cannot rewrite it.
- **Ctrl-C, SIGTERM and SIGHUP are handled.** The runner stops starting anything,
  terminates the process trees of the children _it_ spawned (a `bun run check`
  and everything under it), drops the throwaway database, and exits 130 / 143 / 129. It walks parent links from its own PIDs and never matches by name or
  command line, so another session's `bun` is never touched, and it never runs
  `pkill` or `killall`. Signalling only the direct child is not enough: `bun run`
  exits on SIGTERM and leaves its script's processes running.
- **`.env` is auto-loaded by Bun and CI has none.** The runner warns when one
  exists. It pins `DATABASE_URL`, `SETUP_DATABASE_URL` and `WORKER_DATABASE_URL`
  for every child (blank for the jobs without a database, the throwaway database
  for the two with one), so a URL for a real database can never leak into a test
  run — but any _other_ variable from `.env` or your shell still applies.
  [`awcms-testing`](../../.claude/skills/awcms-testing/SKILL.md) explains why the
  mere existence of `.env` can switch the DB-gated suite on.
- `CI=true` is set for every job, as on GitHub-hosted runners (Playwright
  retries and `forbidOnly`, `bun test` snapshot behaviour).
- The e2e job picks a **free port** instead of the workflow's fixed 4321 so it
  cannot collide with a running `bun run dev` (whose 404 would satisfy the
  readiness probe and send the seed to the wrong database).

## How it stays in step with the workflows

`scripts/ci-local.ts` is a hand-written mirror, and a hand-written mirror
drifts. [`tests/ci-local-parity.test.ts`](../../tests/ci-local-parity.test.ts)
parses `ci.yml` and `changesets.yml` and fails when:

- a workflow **job** has no local counterpart (or the runner maps one that no
  longer exists);
- a workflow **step** is neither mirrored nor listed under `omitted` with a
  reason, or a mirrored step's `run:` text differs from the workflow's (shell
  steps carry the workflow text **verbatim**);
- the pinned facts diverge: the Bun versions (1.4.2 current, 1.3.0 floor), the
  PostgreSQL major, the e2e environment and seed body, the default base ref.

It matches shell steps by what they execute rather than by label, so renaming a
step does not break it but changing a command does. The last block of that file
mutates a copy of the real workflow and demands the guard complain.

Steps that cannot be the workflow text are **native** and say why in
`scripts/ci-local.ts` (`adapted`): the Postgres `services:` container and
`$GITHUB_ENV` (a throwaway database instead), the `uses:` actions (checkout,
setup-bun, cache, upload-artifact), the `playwright install` step, and the e2e
start/seed script (free port, `fetch` instead of `curl` + `jq`, the server is
always killed).

## Not covered

`codeql.yml` (CodeQL runs only on GitHub), the GitGuardian app, and
`release.yml` (tag-triggered) have no local equivalent. A green `ci:local` is
necessary, not sufficient: GitHub's required checks still decide the merge.

## See also

- [`branch-protection.md`](branch-protection.md) — the ruleset and its required checks.
- [`alur-pengembangan.md`](alur-pengembangan.md) §12 — where this sits in the flow.
- [`07_sprint_testing_production_readiness.md`](07_sprint_testing_production_readiness.md) — the testing strategy these jobs implement.
- [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) — validating before a PR.
