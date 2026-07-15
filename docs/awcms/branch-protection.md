# Branch Protection — Required Status Checks

> **Document status.** Repo `awcms` is at the foundation-rebuild stage
> ([ADR-0001](../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)) — no
> ERP module code exists yet. This document adapts the generic branch
> protection / required-checks policy from the awcms-mini base (a
> repo-hygiene mechanism, not domain-specific) for this repository. Some
> checks listed below (e.g. `E2E smoke (Playwright)`, the exact step
> count in `bun run check`) reference workflows/scripts that will be
> mirrored into `awcms` as its own CI is built out — verify against this
> repo's actual `.github/workflows/` before relying on any specific
> number or name.

Acceptance criterion this document exists to satisfy: "Branch protection
documentation identifies required checks." This document is that
reference — it does **not** itself configure GitHub. As of this writing,
verify current protection state with `gh api
repos/ahliweb/awcms/branches/main/protection` before assuming any of the
below is already enabled. Enabling branch protection is a repo-admin,
shared-state change (affects every contributor's merge flow) and is
deliberately left to a maintainer to apply explicitly, not done
automatically by this doc or by CI itself.

## Required status checks (recommended)

These are the check names GitHub should report for `.github/workflows/ci.yml`
and `.github/workflows/codeql.yml` once those workflows exist in this repo —
a branch protection rule's "required status checks" list must reference these
names verbatim (GitHub matches on the job's `name:`, not its internal id).
Adjust this table to match the actual workflow files as they are built —
do not assume it is already in sync:

| Check name (verbatim)                                  | Workflow / job                    | What it gates                                                                                                                                                                                        |
| ------------------------------------------------------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Quality (lint + docs + contracts + typecheck + test)` | `ci.yml` / `quality`              | Prettier, docs checks, `api:spec:check` (OpenAPI/AsyncAPI + route parity + public-operation allow-list), `modules:dag:check`, `i18n:parity:check`, typecheck, `bun test` (unit + integration), build |
| `E2E smoke (Playwright)`                               | `ci.yml` / `e2e-smoke`            | Real-browser smoke coverage against a live app + isolated Postgres (login, admin/security both gate states, admin/analytics access control)                                                          |
| `Repo hygiene (Bun-only + no secrets)`                 | `ci.yml` / `hygiene`              | Bun-only tooling convention, no committed `.env`, both `docker-compose*.yml` files parse                                                                                                             |
| `Analyze (actions)`                                    | `codeql.yml` / `analyze`          | CodeQL static analysis of GitHub Actions workflow files                                                                                                                                              |
| `Analyze (javascript-typescript)`                      | `codeql.yml` / `analyze`          | CodeQL static analysis (security-extended + security-and-quality queries) of the TypeScript/Astro source                                                                                             |
| `Changeset required for behavior changes`              | `changesets.yml` / `policy-check` | Fails a PR touching non-docs/non-agent-tooling files without a new `.changeset/*.md` — see `release-process.md` §PR-time gate (belum ditulis di awcms)                                               |

`GitGuardian Security Checks` (a GitHub App check, not a workflow file in
this repo) should also be included in the required list once the org's
GitGuardian integration is enabled for this repo; it is not configured by
anything in `.github/workflows/`, so it isn't itemized above with the rest.

## Applying this (maintainer action, not automated)

Via the GitHub UI: **Settings → Branches → Add branch protection rule**,
pattern `main`, enable **Require status checks to pass before merging**,
then search for and add each check name from the table above (GitHub only
offers checks that have reported at least once — merge/re-run a PR first
if a check is missing from the picker). Recommended alongside it,
consistent with a PR-based workflow (every merge should go through a PR,
never a direct push):
**Require a pull request before merging**, **Require branches to be up to
date before merging**.

Equivalent `gh api` command (run by a repo admin, adjust `required_status_checks.contexts`
if the check list above has since changed):

```bash
gh api -X PUT repos/ahliweb/awcms/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f required_status_checks.strict=true \
  -f 'required_status_checks.contexts[]=Quality (lint + docs + contracts + typecheck + test)' \
  -f 'required_status_checks.contexts[]=E2E smoke (Playwright)' \
  -f 'required_status_checks.contexts[]=Repo hygiene (Bun-only + no secrets)' \
  -f 'required_status_checks.contexts[]=Analyze (actions)' \
  -f 'required_status_checks.contexts[]=Analyze (javascript-typescript)' \
  -f 'required_status_checks.contexts[]=Changeset required for behavior changes' \
  -f enforce_admins=true \
  -f required_pull_request_reviews=null \
  -f restrictions=null
```

(`required_pull_request_reviews=null`/`restrictions=null` here mean "don't
additionally require review approvals / don't restrict who can push" —
tighten those separately if desired; they're independent of the status
check requirement this doc is about.)

## Why `bun run check` and CI must stay the same source of truth

Once this repo's `package.json` `check` composite and `.github/workflows/ci.yml`
exist, they must be kept in lockstep: every step added to `bun run check`
needs a matching named step in `ci.yml`'s `quality` job in the same PR (or
an explicit documented reason why it stays release-only). The awcms-mini
base found and closed exactly this kind of drift more than once (`api:spec:check`
and `modules:dag:check` were missing from CI for a period; `api:docs:check`,
`repo:inventory:check`, `i18n:pot:check`, `config:docs:check`, and
`logging:lint:check` still only run in `release.yml` there, not in `ci.yml`'s
`quality` job) — treat that history as a warning to design against from the
start in awcms, not a problem to rediscover later. Concretely: an
API-docs drift, a repo-inventory drift, an i18n `.pot` drift, a config-docs
drift, or a raw-error-logging violation must not be able to merge to `main`
via a green PR and only surface when a release tag is pushed.

## See also

- `06_github_issues_detail.md` — issue tracking for platform-hardening
  work (out of scope for this adaptation; will be added as issues are
  opened for this repo).
- [`07_sprint_testing_production_readiness.md`](07_sprint_testing_production_readiness.md)
  — testing pyramid and production readiness checklist this CI
  orchestration serves (belum ditulis).
- `.github/workflows/ci.yml` / `.github/workflows/codeql.yml` — the
  actual workflow definitions this doc describes, once created.
- [`release-process.md`](release-process.md) — the `changesets.yml`
  (PR-time changeset policy gate, table row above) and `release.yml`
  (tag-triggered build/SBOM/sign/attest/publish pipeline) once
  documented for this repo, including its own repo-admin manual step
  (the `release` GitHub Environment's required reviewers) that follows
  this same "document, don't self-apply" pattern.
