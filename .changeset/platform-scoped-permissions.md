---
"awcms": minor
---

Add PLATFORM-scoped permissions, and bring back the region-dataset console at `/admin/idn-regions`.

ADR-0051 made a rule normative — an action whose effect crosses tenant boundaries must have a platform-scoped gate and must not sit in the catalogue seeded to tenant roles — but the primitive that rule needs did not exist. ADR-0052 therefore could not guard region-dataset activation/rollback; it could only delete them. This builds the gate (ADR-0053) and restores the surface behind it.

`awcms_permissions` gains a `scope` column (`tenant` | `platform`, default `tenant`), declared in code as `ModulePermissionDescriptor.scope` (`MODULE_CONTRACT_VERSION` 2.5.0, additive). The blanket grant in `bootstrapPlatformTenant` — `SELECT id FROM awcms_permissions`, which is what handed cross-tenant authority to every tenant owner in the first place — now filters on it, so the next platform permission is safe the moment it is declared rather than the moment someone remembers. The owner backfill excludes them too.

Platform authority belongs to the platform tenant, resolved `PLATFORM_TENANT_ID` → `PUBLIC_DEFAULT_TENANT_ID` → `PUBLIC_DEFAULT_TENANT_CODE` → `awcms_setup_state.tenant_id`, and held by that tenant's `owner` role. `authorizeInTransaction` refuses a platform-scoped permission unless the acting tenant is that tenant — decided before permissions are looked up, and fail-closed when none resolves, so a grant row that reached the wrong tenant is inert rather than sufficient. The trigger is read from the code declaration, not the database column: were both the database, one `UPDATE` would remove the gate along with the grant filter and nothing would go red.

Tenancy mode (`single`/`multi`) is derived from the active-tenant count, never configured — a stored flag would have to be flipped by whoever provisions tenant number two, and forgetting means the deployment keeps behaving as if one tenant owned everything. The mode never relaxes a gate.

While `PLATFORM_TENANT_ID` is unset, `PUBLIC_DEFAULT_TENANT_ID` is a security control: repointing which site renders on an unmatched host also repoints platform authority. That is a deliberate trade-off, made separable without a migration by the dedicated variable, and made visible by a new `security:readiness` check that reports which tenant holds the authority and warns when it is not the bootstrap tenant.
