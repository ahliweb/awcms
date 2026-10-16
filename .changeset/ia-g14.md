---
"awcms": patch
---

fix(identity-access): `restoreRole` now runs its UPDATE in a savepoint, so a reused `role_code` (23505) surfaces as `DuplicateRoleCodeError` (409) instead of a 500 from the aborted transaction (25P02); `readPreferences` and `resolvePrincipalIdForIdentity` run their SELECTs in savepoints, so a read fault really degrades to "no preferences"/`null` without poisoning the caller's transaction.
