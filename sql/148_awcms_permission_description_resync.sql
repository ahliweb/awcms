-- Re-sync five `awcms_permissions` descriptions with the module descriptors
-- that had moved on without them.
--
-- WHY THEY DRIFTED, which is the part worth carrying forward
--
-- Every permission-seed migration in this repo ends `ON CONFLICT (module_key,
-- activity_code, action) DO NOTHING`. That is right for the ROW — re-running a
-- migration must not disturb a catalog a later migration may have edited — but
-- it also means the description is written EXACTLY ONCE, by whichever migration
-- first inserted the row. Edit the descriptor's text afterwards (because the
-- permission's meaning widened, or because a reviewer asked for a clearer
-- sentence) and the catalog keeps the original forever. Nothing re-seeds it.
--
-- WHAT THAT COST
--
-- `module-management`'s `permission_catalog_synced` readiness signal is built on
-- `comparePermissions`, which reports `mismatched_description`, and the signal
-- counts that as a failure. So `blog_content`, `identity_access`, `tenant_admin`
-- and `idn_admin_regions` have all been reporting `permission_catalog_synced =
-- fail` on every migrated deployment — measured, not inferred — while every CI
-- gate stayed green, because nothing in CI compared the two registers at all.
-- `tests/integration/permission-catalogue-parity.integration.test.ts` now does,
-- in both directions and including the description text, so the next drift is
-- caught before it ships rather than by an operator reading a health endpoint.
--
-- WHY `UPDATE` AND NOT A RE-SEED WITH `DO UPDATE`
--
-- Changing the existing seed migrations is not an option: an applied migration
-- is immutable here (editing one blocks `db:migrate` on any deployment that has
-- already run it). And a blanket `DO UPDATE SET description = EXCLUDED.description`
-- in FUTURE seeds would only help rows those future migrations touch. The drift
-- is in rows that already exist, so the correction has to name them.
--
-- The sixth mismatch is NOT here. `idn_admin_regions.dataset.read`'s catalog
-- text is the better of the two — it names the domain ("Indonesia
-- administrative region dataset versions") where the descriptor had shortened
-- it to "dataset versions" — so that one is fixed in the DESCRIPTOR instead.
-- The rule applied to all six was "make both registers say the better sentence",
-- not "make the catalog obey the code".
--
-- Descriptions only. No row is added, removed, or re-scoped, so no grant
-- changes and no role gains or loses anything.

BEGIN;

UPDATE awcms_permissions
SET description = 'Suspend a tenant: stop serving it, and refuse its live sessions and machine credentials from their next request (ADR-0073)'
WHERE module_key = 'tenant_admin'
  AND activity_code = 'tenant_lifecycle'
  AND action = 'disable';

UPDATE awcms_permissions
SET description = 'Lift a tenant suspension and resume service (ADR-0073). Separate from `disable` on purpose: during an incident you want someone who can bring a customer back without being able to cut one off'
WHERE module_key = 'tenant_admin'
  AND activity_code = 'tenant_lifecycle'
  AND action = 'restore';

UPDATE awcms_permissions
SET description = 'Add or remove a tenant user from a group — audited, and a grant in everything but name (membership confers every role the group holds)'
WHERE module_key = 'identity_access'
  AND activity_code = 'user_groups'
  AND action = 'assign';

UPDATE awcms_permissions
SET description = 'Read blog categories, tags, channels and topics'
WHERE module_key = 'blog_content'
  AND activity_code = 'taxonomies'
  AND action = 'read';

UPDATE awcms_permissions
SET description = 'Create, update, or delete blog categories, tags, channels and topics'
WHERE module_key = 'blog_content'
  AND activity_code = 'taxonomies'
  AND action = 'configure';

COMMIT;
