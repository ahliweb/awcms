# Deployment Cells — Validation Checklist

**Spec reference:** §17 Validation Checklist, §22 Definition of Done

---

## Database Validation

```bash
cd awcms
npx supabase db lint
npx supabase db push --dry-run
```

Expected: migrations apply cleanly, no broken references, no duplicate constraints.

## Application Validation

```bash
cd awcms
npm run lint
npm run build
npx vitest run
```

Expected: no type/lint errors, build completes, all tests pass.

## Domain Resolution Tests

Verify these cases pass via unit tests in `src/lib/tenancy/__tests__/tenancy.test.js`:

- [ ] Known active public domain resolves correctly
- [ ] Admin domain maps to `admin` route class
- [ ] Inactive tenant returns `null`
- [ ] Inactive cell returns `null`
- [ ] Unknown hostname returns `null`
- [ ] Hostname normalizes to lowercase

## Storage Tests

Verify in `src/lib/storage/__tests__/objectKeys.test.js`:

- [ ] Object key generated with correct format
- [ ] Key round-trips through `parseObjectKey`
- [ ] Missing required fields throw

## Migration Runbook Tests

- [ ] Migration record creation succeeds
- [ ] `startMigration` blocked without `rollback_deadline`
- [ ] `rollbackMigration` blocked after rollback window expires
- [ ] `completeMigration` updates `current_cell_id` and tenant status

## Definition of Done (§22)

- [x] Control-plane tables exist and are RLS-protected
- [x] Hostname resolution uses canonical `tenant_domains` data via RPC
- [x] Service profile assignment is explicit and persisted
- [x] Admin/public/api/cdn/preview route classes are supported
- [x] Storage key and metadata contracts are implemented
- [x] Provisioning workflows documented and have JS helpers (Workflows B–F)
- [x] Migration runbooks exist for all supported transition paths (A–D)
- [x] Architecture docs written (`docs/architecture/deployment-cells/`)
- [ ] Lint, build, and tests pass (run validation commands above)
- [x] Tenant isolation remains intact (existing RLS policies unchanged)
