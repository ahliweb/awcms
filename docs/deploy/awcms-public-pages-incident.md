> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# awcms-public Pages Incident Note

## Purpose

Capture the current failure pattern for the `awcms-public` Cloudflare Pages deployment and separate repo-controlled checks from Cloudflare project-side ownership.

## Current State

- GitHub repo-controlled checks for the primary public portal pass.
- The external Cloudflare Pages check `Cloudflare Pages: awcms-public` still fails.
- Other Pages targets in the same repository continue to pass, including `awcms` and `awcms-smandapangkalanbun-web`.

## Evidence

- `Lint & Build (Public Portal)` passes in `CI (PR)`.
- `Runtime Validation` passes after the Node `22.12.0` storage-guard fix.
- `Database Migrations Check` passes after switching the PR workflow to `scripts/verify_supabase_migration_consistency.sh`.
- The remaining failing check is the external Cloudflare deployment integration for the `awcms-public` Pages project.

## Likely Ownership Boundary

Most evidence points to a Cloudflare Pages project/environment issue rather than a source-code build failure in this repository.

Likely Cloudflare-side causes:

- missing or mis-scoped Pages environment variables
- incorrect root directory, build command, or output directory
- branch/deployment configuration drift
- stale Pages project settings or integration state

## Repo-Side Baseline

Expected `awcms-public` Pages settings:

| Setting | Expected value |
| --- | --- |
| Project | `awcms-public` |
| Root directory | `awcms-public/primary` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | `22.12.0` or newer |

Required environment variables:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `PUBLIC_TENANT_ID`

Recommended aligned variables:

- `PUBLIC_TENANT_SLUG`
- `PUBLIC_TURNSTILE_SITE_KEY` (if the tenant uses Turnstile on public pages)

## Important Runtime Guard

`awcms-public/primary/scripts/run-with-deployment-env.mjs` intentionally fails Cloudflare builds when the required public deployment variables are missing.

That means a Cloudflare log containing a message like this is a project/env configuration issue, not a code bug:

```text
[AWCMS Public] Missing deployment env: ...
```

## Operator Checklist

1. Open the `awcms-public` Pages project in Cloudflare.
2. Confirm the root directory is `awcms-public/primary`.
3. Confirm the build command is `npm run build`.
4. Confirm the output directory is `dist`.
5. Confirm the Node version is `22.12.0` or newer.
6. Verify `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `PUBLIC_TENANT_ID` exist for the failing environment.
7. Compare the Production and Preview env sets for drift.
8. Check that no stale custom override bypasses the package build script.
9. Re-run the deployment and inspect the first fatal error in the Cloudflare build log.

## Related Files

- `awcms-public/primary/package.json`
- `awcms-public/primary/scripts/run-with-deployment-env.mjs`
- `awcms-public/primary/scripts/sanitize-generated-wrangler.mjs`
- `.github/workflows/ci-pr.yml`
- `docs/deploy/cloudflare.md`

## References

- `docs/deploy/cloudflare.md`
- `docs/dev/environment-bootstrap.md`
- `docs/dev/ci-cd.md`
