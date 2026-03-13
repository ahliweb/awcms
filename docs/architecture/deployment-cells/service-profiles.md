# Deployment Cells — Service Profiles

**Spec reference:** §11 Service-Profile Engine Contract

---

## Profiles

| Profile | Label | Runtime | Data | Edge | Quota? |
|---|---|---|---|---|---|
| `shared_managed` | Shared Managed | Shared | Shared | Shared | ✅ |
| `dedicated_managed` | Dedicated Managed | Dedicated | Dedicated (Supabase) | Shared | ❌ |
| `dedicated_hybrid` | Dedicated Hybrid | Dedicated (Linode) | Dedicated (Supabase) | Shared | ❌ |
| `dedicated_self_hosted` | Dedicated Self-Hosted | Dedicated | Self-hosted | BYOD | ❌ |
| `vanity_domain_saas` | Vanity Domain SaaS | Shared | Shared | Dedicated | ✅ |

## Selection Rule (§11.3)

> Service profile is assigned through provisioning or service-contract updates, **never inferred** from server names or domains.

Use `assignServiceProfile()` in `src/lib/provisioning/assignServiceProfile.js`.

## Migration Required?

Use `requiresCellMigration(currentProfile, newProfile)` in `serviceProfile.js` to determine if changing profiles requires a `tenant_migrations` record and infrastructure move.

Profiles that differ in `runtimeIsolation` or `dataIsolation` always require a migration.
