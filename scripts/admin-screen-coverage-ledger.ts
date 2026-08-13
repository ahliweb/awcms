/**
 * Permissions that have no admin screen YET — a one-way ledger, not a register
 * of decisions.
 *
 * The difference is the whole point. `DELIBERATELY_UNSCREENED` in
 * `admin-screen-coverage-check.ts` says "an operator should not drive this from
 * a page", and each entry carries the reason. This list says nothing except
 * "nobody has built it". Mixing the two would let unfinished work acquire the
 * appearance of judgement, which is exactly how ADR-0058 found six exception
 * entries that were really six bugs.
 *
 * **It may only shrink.** Giving a permission a screen and leaving its line here
 * turns the gate RED, so the number below is always the real one. That property
 * is what makes it worth writing down at all: before this file, "13 of 21
 * modules have no screen" was a sentence somebody had to re-derive by hand, and
 * it was re-derived wrongly more than once.
 *
 * Adding a line is allowed — a new module lands with endpoints before screens —
 * but it is an edit somebody makes on purpose, in a file whose only content is
 * work not done.
 *
 * Nine modules, and the two largest groups are worth naming because they are not
 * cosmetic: every `email` suppression key (a suppressed address silently stops
 * receiving mail, including password resets, and nothing can list or clear it
 * from a page), and every `identity_access.business_scope_*` key (assignment
 * plus a maker/checker exception flow with no inbox for the checker).
 * `module_management.settings.*` is the one that had a false alibi: three
 * documents claimed a generic `/admin/modules/{key}` settings panel existed,
 * and one used that claim to justify not building an editor. It never existed.
 */
export const NOT_YET_SCREENED: readonly string[] = [
  // tenant_admin (2) — ADR-0073. Suspension is ENFORCED as of Issue #429; what
  // is missing is the button. `/admin/tenants` already lists every tenant with
  // its status, so this is a screen edit, not a new surface — deliberately not
  // bundled into the enforcement PR, whose whole value is that a suspended
  // customer's admin sessions and machine credentials stop working. Tracked as
  // PROJECT_STATE §4 R7's class: a surface without a screen.
  "tenant_admin.tenant_lifecycle.disable",
  "tenant_admin.tenant_lifecycle.restore",

  // blog_content (7)
  "blog_content.ad_placements.configure",
  "blog_content.ad_placements.read",
  "blog_content.homepage_sections.configure",
  "blog_content.homepage_sections.read",
  "blog_content.internal_links.configure",
  "blog_content.internal_links.preview",
  "blog_content.internal_links.read",

  // comments (3)
  "comments.moderation.delete",
  "comments.settings.read",
  "comments.settings.update",

  // email (6)
  "email.announcement.create",
  "email.message.cancel",
  "email.message.read",
  "email.template.delete",
  "email.template.restore",
  "email.template.update",

  // form_drafts (2)
  "form_drafts.draft.create",
  "form_drafts.draft.update",

  // identity_access (12)
  //
  "identity_access.business_scope_assignments.create",
  "identity_access.business_scope_assignments.read",
  "identity_access.business_scope_assignments.revoke",
  "identity_access.business_scope_conflicts.read",
  "identity_access.business_scope_exceptions.approve",
  "identity_access.business_scope_exceptions.create",
  "identity_access.business_scope_exceptions.read",
  "identity_access.business_scope_exceptions.reject",
  "identity_access.business_scope_exceptions.revoke",
  "identity_access.sso_providers.create",
  "identity_access.sso_providers.delete",
  "identity_access.sso_providers.update",

  // module_management (8)
  "module_management.health.check",
  "module_management.health.read",
  "module_management.jobs.read",
  "module_management.modules.read",
  "module_management.modules.sync",
  "module_management.permissions.read",
  "module_management.settings.read",
  "module_management.settings.update",

  // profile_identity (3)
  "profile_identity.profile_management.delete",
  "profile_identity.profile_management.restore",
  "profile_identity.profile_management.update",

  // tenant_admin (2)
  "tenant_admin.tenant_settings.read",
  "tenant_admin.tenant_settings.update",

  // visitor_analytics (4)
  "visitor_analytics.events.read",
  "visitor_analytics.retention.purge",
  "visitor_analytics.settings.read",
  "visitor_analytics.settings.update"
];
