# CI/CD Pipeline Documentation

AWCMS uses GitHub Actions for Continuous Integration and Continuous Deployment.

---

## Overview

The CI/CD pipeline automatically:

1. **Lints** code for style and quality issues
2. **Tests** application logic with Vitest
3. **Builds** production bundles
4. **Deploys** to Cloudflare Pages (on main branch)

---

## Workflow Configuration

**Location:** `.github/workflows/ci.yml`

### Trigger Events

```yaml
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
```

---

## Pipeline Jobs

### 1. Lint & Test - Admin Panel

Runs on the React admin application (`awcms/`).

| Step | Command | Purpose |
| :--- | :--- | :--- |
| Install | `npm ci` | Install dependencies |
| Lint | `npm run lint` | ESLint check |
| Test | `npm run test -- --run` | Vitest execution |
| Build | `npm run build` | Production build |

### 2. Lint & Build - Public Portal

Runs on the Astro public site (`awcms-public/`).

| Step | Command | Purpose |
| :--- | :--- | :--- |
| Install | `npm ci` | Install dependencies |
| Build | `npm run build` | Astro production build |

### 3. Build - Mobile App

Runs on the Flutter mobile application (`awcms-mobile/`).

| Step | Command | Purpose |
| :--- | :--- | :--- |
| Get Deps | `flutter pub get` | Get dependencies |
| Analyze | `flutter analyze` | Static analysis |
| Test | `flutter test` | Unit tests |

### 4. Database Migrations Check

Validates Supabase migrations on pull requests.

| Step | Command | Purpose |
| :--- | :--- | :--- |
| Lint | `supabase db lint` | Schema validation |

### 5. Deploy to Cloudflare Pages

Deploys admin panel on push to `main`.

| Step | Tool | Purpose |
| :--- | :--- | :--- |
| Build | Vite | Create production bundle |
| Deploy | Wrangler | Push to Cloudflare Pages |

---

## Required Secrets

Configure these in GitHub Repository Settings → Secrets:

| Secret | Description |
| :--- | :--- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |

---

## Running Locally

### Pre-Push Verification

Run these commands before pushing:

```bash
# Lint check
npm run lint

# Run tests
npm run test -- --run

# Build verification
npm run build
```

### Local Test Watch Mode

```bash
npm run test
```

---

## Deployment Environments

| Branch | Environment | URL |
| :--- | :--- | :--- |
| `main` | Production | `admin.your-domain.com` |
| `develop` | Staging | `staging.your-project.pages.dev` |
| PR branches | Preview | Auto-generated preview URL |

---

## Troubleshooting

### Build Failures

1. **Missing env vars**: Ensure all `VITE_*` secrets are configured
2. **Node version**: Verify `NODE_VERSION=20` is set
3. **Dependencies**: Run `npm ci` locally to verify lock file

### Test Failures

1. Run `npm run test -- --run` locally to reproduce
2. Check test output for specific failures
3. Verify mocks are correctly configured

### Deployment Failures

1. Check Cloudflare API token permissions
2. Verify account ID is correct
3. Review Wrangler output for specific errors

---

## Related Documentation

- [Testing Guide](TESTING.md)
- [Deployment Guide](DEPLOYMENT.md)
- [Cloudflare Deployment](CLOUDFLARE_DEPLOYMENT.md)
