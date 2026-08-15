🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](branch-protection.id.md)

# Branch Protection — Required Status Checks

> **Document status.** The `awcms` repo is a reusable base modular monolith
> ([ADR-0001](../adr/0001-rebuild-on-awcms-foundation-erp-scope.md), amended
> by [ADR-0022](../adr/0022-erp-modules-live-in-extension-repos.md)) — 10
> foundation modules already exist (see `../ARCHITECTURE.md`), ERP domain
> modules live in separate extension/derived repos, never in this repo.
> `.github/workflows/ci.yml`, `codeql.yml`, and `changesets.yml` **already
> exist** in this repo (adapted from awcms-mini). Since Issue #166, `ci.yml`
> also has an `e2e-smoke` job (Playwright + Bun) that runs on **every**
> push/PR — see the table below for details and for its status (not yet
> required). `ci.yml` also already has an `integration-tests` job
> (`Integration tests (RLS + DB role separation)`) that brings up a live
> ephemeral Postgres per job and runs, in separate steps, `bun test tests/integration/`
> (the harness-based suite) and then `bun test` over 9 legacy ad-hoc files — two
> separate `bun test` processes, not one bare `bun test`, because those two
> suites collide when run together in a single process (see the step's
> comments) — see its status note below (also not yet required). There is no
> `docker-compose*.yml` to validate yet, so compose file validation is
> **absent** here (unlike the awcms-mini base) — it will be added once the
> infrastructure is built.

Acceptance criterion this document exists to satisfy: "Branch protection
documentation identifies required checks." This document is that
reference — it does **not** itself configure GitHub.

**Important: this repo's protection lives as a Repository Ruleset, not as
classic branch protection.** The classic endpoint this document used to
recommend (`gh api repos/ahliweb/awcms/branches/main/protection`)
**404s** in this repo (`{"message":"Branch not protected", ...}`) — not
because protection is inactive, but because the configuration now lives
in GitHub Rulesets (the feature that replaces/coexists with classic
branch protection), which has its own API endpoint. Verify the real
state with:

```bash
# 1. List the rulesets in this repo (look for the one targeting branch `main`):
gh api repos/ahliweb/awcms/rulesets

# 2. Details of that ruleset (replace <id> with the id from step 1):
gh api repos/ahliweb/awcms/rulesets/<id>
```

For reference, as of this document's writing the repo has one active
ruleset: id `11653326`, name **"main only"**, `target: branch`,
`enforcement: active`, applying to `~DEFAULT_BRANCH` (that is, `main`).
Do not assume anything in this document is already in effect without
running the steps above first — the ruleset configuration can change at any
time via the UI or the API by a repo admin, independently of any commit to
this document. Enabling/changing a ruleset is a repo-admin, shared-state
change (it affects every contributor's merge flow) and deliberately left to a
maintainer to apply explicitly, not done automatically by this doc or by
CI itself.

## Required status checks (current, as configured in ruleset `11653326`)

The check names below are the `required_status_checks` genuinely
installed in ruleset `11653326` as of this document's writing (confirmed
via `gh api repos/ahliweb/awcms/rulesets/11653326`) — a check is
referenced by `context` (the job/check run name) plus `integration_id`
(the App that reports it), not by name alone:

| Check name (verbatim)                                          | Integration (App)                                                       | Workflow / job                                           | What it gates                                                                                                                                                                                                                                       |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Quality (lint + docs + contracts + typecheck + test + build)` | GitHub Actions (`integration_id: 15368`)                                | `ci.yml` / `quality`                                     | Prettier, `check:docs` (mermaid/links/naming), `api:spec:check` (OpenAPI/AsyncAPI + route parity + public-operation allow-list), `modules:dag:check`, `logging:lint:check`, typecheck, `bun test` (unit), build                                     |
| `Repo hygiene (Bun-only + no secrets)`                         | GitHub Actions (`integration_id: 15368`)                                | `ci.yml` / `hygiene`                                     | Bun-only tooling conventions, no committed `.env`                                                                                                                                                                                                   |
| `Changeset required for behavior changes`                      | GitHub Actions (`integration_id: 15368`)                                | `changesets.yml` / `policy-check`                        | Rejects a PR that touches non-docs/non-agent-tooling files without a new `.changeset/*.md` — see `scripts/changeset-policy-check.ts`                                                                                                                |
| `Analyze (actions)`                                            | GitHub Actions (`integration_id: 15368`)                                | `codeql.yml` / `analyze`                                 | CodeQL static analysis over the GitHub Actions workflow files                                                                                                                                                                                       |
| `Analyze (javascript-typescript)`                              | GitHub Actions (`integration_id: 15368`)                                | `codeql.yml` / `analyze`                                 | CodeQL static analysis (security-extended + security-and-quality queries) over the TypeScript/Astro source                                                                                                                                          |
| `CodeQL`                                                       | **CodeQL app** (`integration_id: 57789`) — different from the App above | Code scanning umbrella check (not a job in `codeql.yml`) | The App-level summary check from GitHub Code Scanning over the results of `codeql.yml`; separate from the two per-language `Analyze (...)` checks above — the App reporting it is different even though the data source is the same CodeQL analysis |
| `GitGuardian Security Checks`                                  | **GitGuardian app** (`integration_id: 46505`)                           | External GitHub App (not a workflow file in this repo)   | Secret scanning by the organisation's GitGuardian integration — **already active and configured live** in this repo (not aspirational)                                                                                                              |

`GitGuardian Security Checks` was previously documented here as
"nothing configured in this repo yet, add it once it is enabled" —
that is no longer accurate: the integration is **already active** and has become
one of the `required_status_checks` in ruleset `11653326` as of this
document's rewrite.

### `E2E smoke (Playwright)` — exists and runs, but not yet required

The `e2e-smoke` job in `ci.yml` **already exists** (since Issue #166) and runs
on every `push`/`pull_request` to `main`, just like `quality` and
`hygiene` — it is no longer something "not yet built". But as of this
document's writing, `E2E smoke (Playwright)` is **not** in the
`required_status_checks` list of ruleset `11653326` above. This can be read two
ways — this document does not decide which:

- **A deliberate choice**: E2E smoke is slower and (by design) tests a
  narrower path (login → session → SSR render) than `quality`, so the repo
  admin may have chosen not to block merges on it for now.
- **A candidate to be added**: because the job is already stable and runs on
  every PR, adding it to `required_status_checks` is a reasonable option for
  the repo admin to consider going forward.

Adding/not adding `E2E smoke (Playwright)` as a required check is a repo-admin
operational decision (see the `gh api` command in the "Applying this" section
for how), not something this document settles.

### `Integration tests (RLS + DB role separation)` — exists and runs, informational only

`ci.yml` also has an `integration-tests` job (check name:
`Integration tests (RLS + DB role separation)`) that brings up its own
ephemeral Postgres (separate from the one `e2e-smoke` uses), migrates against
it, then runs TWO separate `bun test` steps: `bun test tests/integration/`
(the harness-based suite, `tests/integration/*.integration.test.ts` — which
skips cleanly in the `quality` job, because that job deliberately runs without
`DATABASE_URL`) and `bun test <9 legacy ad-hoc files>` (`office-directory-postgres`,
`workflow-approval-concurrency`, and so on). Both are split into their own `bun
test` processes, not one bare `bun test`, because the two suites are proven to
collide (data collision/ordering) when run together in a single process — see
the step's comments in `ci.yml` and `tests/integration/harness.ts`.
`release.yml`'s `validate` job uses the same step pattern. RLS and database role
separation are verified for real, not merely with unit tests and mocks. Just
like `E2E smoke (Playwright)`, as of this document's writing this check is
**not** in the `required_status_checks` list of ruleset `11653326` above —
adding it as a required check is a repo-admin operational decision of its
own (see the `gh api` command in the "Applying this" section), not
something this document settles or recommends in either direction.

### The bypass actor installed in this ruleset

Ruleset `11653326` also configures one `bypass_actors` entry:
`actor_type: RepositoryRole`, `actor_id: 5`, `bypass_mode: always`. In
GitHub's built-in role numbering scheme for ruleset bypass actors, id `5`
corresponds to the built-in **Admin** role (order: `1` = Read, `2`
= Triage, `3` = Write, `4` = Maintain, `5` = Admin) — meaning anyone
with Admin access to this repo can bypass **every rule** in this ruleset
unconditionally, including all the required status checks and the pull
request requirement above (`current_user_can_bypass: "always"` is visible when
calling the endpoint above as an admin). This is not a bug — "always" Admin
bypass is the GitHub default and is commonly kept so that repo admins
cannot lock themselves out when an emergency fix is needed —
but it is recorded here because the effect is real: an admin can merge straight
to `main` with no PR/status check at all, and this document previously did not
mention it at all.

**Cloudflare Pages** (if the "Cloudflare Workers and Pages" GitHub App
is installed on this repo) **must not** enter the required checks list —
this repo has no Cloudflare Pages/Wrangler configuration whatsoever (no
`wrangler.toml`, no valid Pages build command for the current Astro/Bun
skeleton), so that check will always fail to build.
If it shows up as a failing check on a commit/PR, it is a leftover
Cloudflare GitHub App installation from the old repo (pre-ADR-0001) that needs
to be detached from the Cloudflare side (Cloudflare dashboard → Workers & Pages
→ the relevant project → Settings → disconnect Git, or delete the project) —
not something that can be fixed by a commit to this repo.

## Applying this (maintainer action, not automated)

Via the GitHub UI: **Settings → Rules → Rulesets** (not **Settings →
Branches** — that is the classic branch protection UI, and this repo does not
use it), open or create a ruleset targeting branch `main`, add the
**Require status checks to pass** rule, then find and add each
check name from the table above (GitHub only offers checks that have been
reported at least once — merge/re-run a PR first if a check does not
appear in the picker yet). Other rules already active in ruleset
`11653326` and consistent with a PR-based flow (every merge must go through a
PR, never a direct push): `deletion` (block branch deletion),
`non_fast_forward` (block force-push), and `pull_request` (requires a PR
before merge, `required_approving_review_count: 0` — a PR is mandatory, but an
explicit approval is not required at this time).

Equivalent `gh api` command (run by a repo admin; this **creates a new
ruleset** — to change the existing ruleset `11653326`, use `PUT
repos/ahliweb/awcms/rulesets/11653326` with a similar body, or edit it via the
UI above):

```bash
gh api -X POST repos/ahliweb/awcms/rulesets \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "name": "main only",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": { "required_approving_review_count": 0 } },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "Quality (lint + docs + contracts + typecheck + test + build)" },
          { "context": "Repo hygiene (Bun-only + no secrets)" },
          { "context": "Changeset required for behavior changes" },
          { "context": "Analyze (javascript-typescript)" },
          { "context": "Analyze (actions)" },
          { "context": "CodeQL" },
          { "context": "GitGuardian Security Checks" }
        ]
      }
    }
  ],
  "bypass_actors": [
    { "actor_type": "RepositoryRole", "actor_id": 5, "bypass_mode": "always" }
  ]
}
JSON
```

(The `PUT .../branches/main/protection` command previously
documented here targets classic branch protection — it does
**not apply** to this repo because its protection has been moved to a
ruleset; running it will not error, but it also will not change
anything GitHub sees as active protection for `main` in this
repo.)

## Why `bun run check` and CI must stay the same source of truth

`package.json`'s `check` composite and `.github/workflows/ci.yml`'s
`quality` job must stay in lockstep: every step added to
`bun run check` needs a matching same-named step in `ci.yml`'s `quality` job
in the same PR (or an explicit documented reason why it is
release-only). The awcms-mini base once found and closed exactly this kind of
drift more than once (`api:spec:check` and `modules:dag:check`
went missing from its CI for a period) — treat that history
as a warning to design for from the start in `awcms`, not a problem to be
rediscovered later.

## Deferred (not yet adapted — needs infrastructure that does not exist yet)

- **`docker-compose*.yml` validation** (part of the `hygiene` job in
  awcms-mini) — this repo does not have a `docker-compose.yml`/`Dockerfile.production` yet.
- **`release.yml`** (build image + SBOM + cosign sign + attestation +
  GitHub Release) — needs a Dockerfile/image publish that does not exist yet; see
  [`release-process.md`](release-process.md) for when this becomes relevant.

Both will be adapted once their prerequisites exist — see
[`scripts/README.md`](../../scripts/README.md) for the same pattern applied to
tooling scripts.

(`E2E smoke (Playwright)` is **no longer** part of this "deferred" list —
the job exists and runs on every push/PR since Issue #166; see the
section above about its status as a required check.)

## See also

- [`07_sprint_testing_production_readiness.md`](07_sprint_testing_production_readiness.md)
  — testing pyramid and production readiness checklist this CI
  orchestration serves.
- `.github/workflows/ci.yml`, `codeql.yml`, `changesets.yml` — the actual
  workflow definitions this document describes.
- [`release-process.md`](release-process.md) — `release.yml` (the tag-triggered
  build/SBOM/sign/attest/publish pipeline) documented once for
  this repo, including its own manual repo-admin step (required
  reviewers on the `release` GitHub Environment) which follows the same
  "document it, do not self-apply" pattern.
