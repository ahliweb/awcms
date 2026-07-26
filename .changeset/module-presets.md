---
"awcms": minor
---

Tenant module presets: named profiles a tenant can be brought to in one action.

`minimal`, `website`, `news_portal` and `back_office`. A preset ENABLES what it
lists and DISABLES every enabled, unlisted, unprotected module — enable-only
would make presets useless as a way to REACH a profile, since a tenant that once
enabled `blog_content` and then applied `minimal` would stay non-minimal
forever.

Ported from awcms-micro (Issue #261) with its planning logic intact, but not its
preset set: `back_office` has no counterpart there, and micro's R2/SaaS presets
are not reproduced because the subsystems that distinguished them do not exist
in this base — a preset naming an absent module is a dead profile.

`GET /api/v1/tenant/modules/presets?preset=<name>` returns a dry-run plan,
because applying one disables things and an operator should see that list first.
`POST /api/v1/tenant/modules/presets/{presetName}/apply` executes it through the
existing lifecycle primitives, so each change runs the real validation and a
rejection is reported per module rather than swallowed.

No migration and no new permission: an apply is a sequence of enables and
disables, so it guards on `module_management.tenant_modules.disable`.
