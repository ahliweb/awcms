---
"awcms": minor
---

feat(omes-control): add GitHub repository-progress projection for Progres Hermes (ahliweb/omes#249)

Replaces `/admin/omes/progres-hermes`'s former "not implemented yet" empty state with a
real, polled GitHub milestone/issue progress projection, per ADR-0030 in `ahliweb/omes`
(re-vendored at commit `7ce1e40937dae990f59a35f0e2a00401f1a19a71`: the new
`repository-progress-view` v1 contract, plus the regenerated `architecture-capabilities-view`
fixture).

- Per-tenant configuration (owner/name of the GitHub repository to observe, plus an
  OPTIONAL token opt-in) via a new admin form on the Progres Hermes screen and
  `GET/PUT/DELETE /api/v1/omes/repository-progress/config`, gated by a NEW permission,
  `omes_control.repository_progress.configure` (sql/167). A `secret_ref` never holds a
  raw token — the only supported v1 shape resolves to one fixed env var,
  `OMES_REPOSITORY_PROGRESS_GITHUB_TOKEN`.
- A scheduled poller (`bun run omes:repository-progress:poll`, every 15 minutes by
  default) polls the GitHub REST API (milestones + issues, excluding pull requests),
  using conditional requests (ETag), respects GitHub's rate-limit headers, validates
  every assembled payload against the vendored contract (fail closed), and upserts a
  tenant-scoped, `FORCE ROW LEVEL SECURITY` projection (sql/166) — never discarding the
  last successful observation on a later poll failure.
- `GET /api/v1/omes/repository-progress` (reusing `omes_control.hermes_orchestration.read`)
  serves the projection to the screen, which renders four explicit states — unconfigured,
  awaiting-first-poll, fresh, and stale/error — with accessible milestone progress bars
  and an issues table linking out to GitHub.
- No issue body, comments, or assignee/author PII is ever stored — only number, title,
  state, label names, a derived `kind`, `html_url`, and `updated_at`.
