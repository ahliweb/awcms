---
description: Pre-release checklist for build, lint, test, and security validation
---

# Release Readiness

## When This Rule Applies

- Before merging any PR to main
- Before deploying to production
- After any migration, RLS, or auth change

## Checklist

### 1. Build Gate

```bash
# Admin panel
cd awcms && npm run build
# Expected: 0 errors, 0 warnings (warnings acceptable if pre-existing)

# Public portal
cd awcms-public && npm run build
# Expected: 0 errors, clean static output in dist/
```

### 2. Lint Gate

```bash
# Admin panel (if lint script configured)
cd awcms && npm run lint
# Expected: 0 errors
```

### 3. Test Gate

```bash
# Unit tests
cd awcms && npx vitest run
# Expected: all tests pass
```

### 4. Security Gate

- [ ] No new secrets committed (see no-secrets-ever rule)
- [ ] RLS not weakened (see rls-policy-auditor rule)
- [ ] tenant_id present on new tables (see tenancy-guard rule)
- [ ] Permissions follow scope.resource.action (see abac-enforcer rule)
- [ ] Imported content sanitized (see sanitize-and-render rule)

### 5. Documentation Gate

- [ ] Changed modules documented in relevant `docs/` files
- [ ] `DOCS_INDEX.md` updated if new docs added
- [ ] `CHANGELOG.md` updated for significant changes

### 6. Migration Gate (if applicable)

- [ ] New migration tested with `supabase db reset`
- [ ] Post-migration RLS audit queries pass
- [ ] Migration does not modify existing applied migrations
- [ ] Rollback steps documented in migration comments

## Final Report Template

```markdown
## Release Report — [Date]

### Changes
- [List of changes]

### Verification
- Build: ✅ / ❌
- Lint: ✅ / ❌
- Tests: ✅ / ❌
- Security: ✅ / ❌
- Docs: ✅ / ❌

### Rollback
- [Steps to revert if needed]

### Notes
- [Any concerns or follow-ups]
```

## References

- [docs/dev/ci-cd.md](../../docs/dev/ci-cd.md)
- [docs/dev/testing.md](../../docs/dev/testing.md)
- All `.agents/rules/*` for individual gate details
