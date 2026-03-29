---
description: Build, lint, and test validation gate procedure
---

# CI Validation Workflow

// turbo-all

## Steps

1. **Install dependencies** (if needed)

```bash
cd /home/data/dev_react/awcms-dev/awcms && npm install
```

1. **Lint**

```bash
cd /home/data/dev_react/awcms-dev/awcms && npm run lint
```

1. **Build admin panel**

```bash
cd /home/data/dev_react/awcms-dev/awcms && npm run build
```

1. **Run tests**

```bash
cd /home/data/dev_react/awcms-dev/awcms && npx vitest run
```

1. **Build public portal** (if public portal changes were made)

```bash
cd /home/data/dev_react/awcms-dev/awcms-public && npm run build
```

1. **Check doc links** (if documentation changes were made)

```bash
cd /home/data/dev_react/awcms-dev && npx markdown-link-check DOCS_INDEX.md
```

## Expected Results

| Step | Expected |
|------|----------|
| Lint | 0 errors (warnings acceptable if pre-existing) |
| Build (admin) | Exit code 0, no errors |
| Tests | All pass |
| Build (public) | Exit code 0, static output in dist/ |
| Doc links | No broken links |

## Common Failures

| Failure | Fix |
|---------|-----|
| Missing dependency | `npm install` in affected package |
| Port conflict | Kill existing process: `lsof -ti:5173 \| xargs kill` |
| Vite env error | Check `VITE_`-prefixed variables in `.env` |
| Test timeout | Check for async leaks, increase timeout if justified |
