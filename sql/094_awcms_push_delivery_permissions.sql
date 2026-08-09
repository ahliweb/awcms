-- Issue #466, ADR-0074 — permission catalog seed for the `push_delivery`
-- operator surface: queue/device diagnostics, cancelling a queued notification,
-- and the end-to-end delivery probe.
--
-- ## Three permissions, and what is deliberately NOT among them
--
-- There is no `subscriptions.create`/`.read`/`.revoke`. Registering, listing
-- and retiring one's OWN device is self-service: the subject is the caller, the
-- route never accepts a `tenantUserId`, and the answer to "may I subscribe this
-- browser" is "you are holding its session" (ADR-0049 §7,
-- `defineSelfServiceTenantRoute`). Seeding permissions for it would put a wall
-- in front of the feature itself — push notifications are for ordinary users,
-- and an action nothing grants denies even the owner while the calling code
-- reads as correctly guarded. That is the latent-authz trap ADR-0058 §E
-- recorded, and this is the shape it takes here.
--
-- What the three below have in common is that they act on somebody ELSE's data
-- or on the deployment: seeing every device in the tenant, stopping a message
-- somebody else queued, and making the system emit real traffic.
--
-- ## Why the probe is `check` and not `create`
--
-- `diagnostics.check` classifies it as an operator probing infrastructure, the
-- same reading `module_management.health.check` has. The endpoint sends only to
-- the CALLER'S own devices with fixed text; there is no authorship capability
-- here to name, and calling it `create` would advertise one that deliberately
-- does not exist.
--
-- ## Scope and reach
--
-- All three are `tenant` scope (the column's default): a push queue belongs to
-- one tenant, and nothing here reaches across deployments.
--
-- Same limitation as every prior permission-seed migration (`sql/061`,
-- `sql/063`, `sql/065`): this extends the GLOBAL catalog only. A tenant created
-- before this migration does not retroactively gain these on its `owner` role —
-- that is `bun run identity-access:owner-permission-backfill`'s job, and it is
-- a deployment step rather than a migration side effect precisely because a
-- migration cannot tell a missing grant from a deliberately removed one.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('push_delivery', 'diagnostics', 'read',
   'Read this tenant''s push queue state, recent delivery attempts, and every registered device (endpoints masked)'),
  ('push_delivery', 'diagnostics', 'check',
   'Send a test push notification to your own registered devices to verify delivery end to end'),
  ('push_delivery', 'messages', 'cancel',
   'Cancel a push notification that is still waiting in the queue (refused once it is being sent)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
