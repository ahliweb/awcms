-- Issue #794 — split `media_library.media.update` in two.
--
-- ## The gap this closes
--
-- `sql/137` seeded ONE permission, `media_library.media.update`, for the
-- whole rights-metadata PATCH form: `creditLine`, `sourceName`,
-- `copyrightStatus`, `rightsNotes`, AND `rightsVerificationStatus` together.
-- That was harmless the day it shipped — `rightsVerificationStatus` was a
-- purely internal editorial flag. Issue #782/PR #791 changed that: setting it
-- to `'verified'` now makes `creditLine`/`sourceName`/`copyrightStatus` cross
-- into the PUBLIC `GET /api/v1/media/objects` response
-- (`resolvePublicMediaRightsFields`), reachable by anyone holding
-- `media_library.media.read` — tenant-wide, and satisfiable by a machine
-- credential.
--
-- So, since #791 landed, whoever could type a credit line could also, in the
-- same request, self-attest that credit cleared for publication. A tenant
-- granting `media.update` to a routine "content editor" role for the everyday
-- task of typing in credit lines was — without anyone deciding it — also
-- granting the authority to trigger public disclosure of a name, possibly a
-- third party's (a freelance photographer's), on the editor's own say-so.
--
-- `media_library.media.adjudicate_rights` is the new, separately-grantable
-- permission for that ONE transition. `PATCH /api/v1/media/objects/{id}`
-- (`src/pages/api/v1/media/objects/[id].ts`) now requires it additionally to
-- `update` whenever a request changes `rightsVerificationStatus` alongside a
-- routine field, and requires it ALONE when a request changes
-- `rightsVerificationStatus` and nothing else — see that route's header for
-- the full reasoning, and `identity-access/domain/access-control.ts`'s
-- `adjudicate_rights` union member for why it is also HIGH-RISK.
--
-- ## Why this seeds like `sql/137`'s `update`, not like `sql/085`'s
-- `dataset.configure`/`.restore`
--
-- `dataset.configure`/`.restore` (ADR-0052/0053) are PLATFORM-scoped: their
-- effect crosses TENANT boundaries (one dataset served to every tenant), so
-- `scope = 'platform'` excludes them from the blanket grant a new tenant's
-- `owner` role receives, and confines them to the platform tenant.
--
-- `adjudicate_rights` crosses no tenant boundary — it decides one thing about
-- one media object INSIDE the tenant that owns it. `scope = 'platform'` would
-- be the wrong tool (and the wrong story: it would make the permission
-- unavailable to every tenant but one, which is the opposite of "any tenant
-- may designate its own rights reviewer"). So this row is left at the default
-- `scope = 'tenant'`, exactly like `media.update` (`sql/137`) and every other
-- ordinary per-tenant permission.
--
-- That means a NEW tenant's `owner` role receives it the same way it receives
-- every other tenant-scoped permission, via `createTenantWithOwner`'s blanket
-- `SELECT ... FROM awcms_permissions WHERE scope = 'tenant'`
-- (`tenant-admin/application/platform-bootstrap.ts`) — the same "owner = every
-- [tenant] permission" invariant ADR-0052/0053 document, and not a new one
-- invented here. What this migration does NOT do, and what the issue's
-- "granted to nobody by default" language is actually about, is any of:
--
--   * grant it to any OTHER role — there is none to grant it to; `owner` is
--     the only role a tenant has at creation time, and a "rights reviewer"
--     role is exactly the kind of role a tenant must consciously create and
--     grant this permission to;
--   * backfill any EXISTING tenant's `owner` role — same limitation every
--     permission-seed migration here carries (see `sql/137`'s own header):
--     only tenants created AFTER this migration pick it up automatically.
--     `bun run identity-access:permissions:backfill` (dry-run by default,
--     `--tenant <code>`) is the supported, deliberate, auditable path for an
--     existing tenant that wants its owner role to hold it.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('media_library', 'media', 'adjudicate_rights',
   'Decide whether a media object''s usage rights are verified/rejected — the transition that makes its credit line public')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;

-- `sql/148`'s lesson applies here too: `ON CONFLICT DO NOTHING` above means a
-- catalog row's description is written EXACTLY ONCE, by whichever migration
-- first inserted it — editing `module.ts`'s text afterwards (because the
-- permission's own meaning narrowed) does not re-seed it. `media.update`'s
-- description changed in this same commit (`module.ts`: "NOT the rights
-- verification decision — see adjudicate_rights"), so its catalog row is
-- resynced here, in the same migration that is the reason it changed —
-- `tests/integration/permission-catalogue-parity.integration.test.ts` would
-- otherwise report `mismatched_description` on every migrated deployment.
UPDATE awcms_permissions
SET description = 'Edit media object metadata — credit line, source, copyright status, and rights notes (NOT the rights verification decision — see adjudicate_rights)'
WHERE module_key = 'media_library'
  AND activity_code = 'media'
  AND action = 'update';
