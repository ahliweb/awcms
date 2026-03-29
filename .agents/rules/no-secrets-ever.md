---
description: Prevent secrets from entering version control or logs
---

# No Secrets Ever

## When This Rule Applies

- Every commit, PR, and code review
- Any file that references environment variables, API keys, or credentials
- Configuration changes to `.gitignore`, `.env.example`, or CI workflows

## Required .gitignore Patterns

The following **MUST** be in `.gitignore`:

```gitignore
**/.env
**/.env.local
**/.env.development.local
**/.env.test.local
**/.env.production
**/.env.production.local
**/.env.remote
```

## Allowed Patterns

- ✅ `.env.example` with placeholder values (no real secrets)
- ✅ `VITE_`-prefixed variables for client-side config (non-secret)
- ✅ `PUBLIC_`-prefixed variables for Astro public config (non-secret)

## Never Do

- ❌ Commit `.env` files with real values
- ❌ Print secrets in console.log, error messages, or audit logs
- ❌ Hardcode `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, or any API key
- ❌ Pass secrets via URL query parameters
- ❌ Store secrets in database tables without encryption

## Scanning Guidance

```bash
# Quick scan for potential secrets in staged files
git diff --cached --name-only | xargs grep -l -i \
  'secret\|password\|api_key\|token\|private_key' 2>/dev/null

# Check .env files are not tracked
git ls-files '*.env*' | grep -v '.example'
# Expected: empty output
```

## Environment Variable Architecture

| Variable | Location | Client-Exposed |
|----------|----------|----------------|
| `VITE_SUPABASE_URL` | `awcms/.env` | Yes (public) |
| `VITE_SUPABASE_ANON_KEY` | `awcms/.env` | Yes (public, safe) |
| `SUPABASE_SECRET_KEY` | Edge Functions env only | **Never** |
| `SUPABASE_DB_URL` | CI / local dev only | **Never** |
| `CONTEXT7_API_KEY` | MCP config only | **Never** |

## References

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) — Security mandates
- [AGENTS.md](../../AGENTS.md) — Env variable constraints
