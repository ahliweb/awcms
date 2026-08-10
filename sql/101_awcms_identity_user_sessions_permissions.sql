-- Permission catalog seed for the admin session surface (Gelombang 2 PR 2.2 of
-- Issue #423), wiring up the `user_sessions` entries declared in
-- `identity-access/module.ts`.
--
-- ## Why a NEW activity rather than reusing `access_control`
--
-- `access_control` seeds `read`/`assign`/`configure` — the RBAC catalog itself.
-- Seeing where a colleague is signed in is a different authority: folding it
-- into `access_control.read` would make every role viewer an observer of their
-- colleagues' movements by side effect, with no migration anywhere saying so.
-- Same reasoning `sql/075` recorded for `registration_requests` and `sql/083`
-- for `machine_credentials`.
--
-- ## Why `read` and `revoke` are separate — with the sides swapped
--
-- `sql/083` split `create`/`revoke` because only one of them CREATES a
-- capability. This pair splits for the mirror-image reason: only one of them
-- DISCLOSES anything. `read` returns a standing view of when and from how many
-- device shapes a named person signs in; `revoke` destroys access and returns a
-- count. So the grant that matters during an incident — end this account's
-- sessions now — can be handed out without the surveillance view attached, and
-- an operator who only ever needs to look is not also able to sign the room out.
--
-- Both action literals already exist in the `AccessAction` union
-- (`business_scope_assignments` uses `read` and `revoke`), so nothing new is
-- invented here. An unseeded action would deny even the owner — the latent-authz
-- trap ADR-0058 §E describes.
--
-- `revoke` is a HIGH-RISK action, so it additionally passes the SoD chokepoint
-- in `authorizeInTransaction` with no extra wiring.
--
-- ## Reach, stated plainly
--
-- Same shape/limitation as every prior permission-seed migration here: this
-- extends the GLOBAL catalog only. An existing tenant's `owner` role does NOT
-- retroactively gain these — only tenants created after this migration runs get
-- them from the bootstrap's `INSERT INTO awcms_role_permissions … SELECT …
-- FROM awcms_permissions`. Live tenants are covered by running
-- `bun run identity-access:permissions:backfill`, which grants exactly the
-- catalog rows NEWER than the role (so it cannot resurrect a permission an
-- admin deliberately removed). That is a deployment step, not a migration side
-- effect.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('identity_access', 'user_sessions', 'read', 'List another tenant user''s live sessions (never their tokens, IPs, or User-Agents)'),
  ('identity_access', 'user_sessions', 'revoke', 'End every live session of another tenant user, effective on their next request — audited')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
