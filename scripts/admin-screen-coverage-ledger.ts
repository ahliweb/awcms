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
 * Nine modules. Two groups here were named as NOT cosmetic, and both have since
 * been built: every `email` suppression key (a suppressed address silently
 * stops receiving mail, including password resets, and nothing could list or
 * clear it from a page), and every `identity_access.business_scope_*` key
 * (assignment plus a maker/checker exception flow with no inbox for the
 * checker — #545 built the inbox, and found that the checker permission each
 * rule declares for itself was never enforced either).
 * `module_management.settings.*` was the one with a false alibi: three
 * documents claimed a generic `/admin/modules/{key}` settings panel existed,
 * and one used that claim to justify not building an editor. It never did —
 * until #546 built it, which is why those two keys are no longer on this list.
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

  // blog_content (3) — `homepage_sections.*` and then `ad_placements.*` left
  // this list in Issue #594, when `/admin/blog-homepage` and `/admin/blog-ads`
  // landed. What remains is the internal-link policy surface, which rides along
  // with `/admin/blog-presentation` and has never had controls of its own.
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

  // identity_access (3)
  "identity_access.sso_providers.create",
  "identity_access.sso_providers.delete",
  "identity_access.sso_providers.update",

  // media_library (2) — finding D8. These were filed as DECISIONS
  // ("belongs with /admin/security, not an object console") until 22 August
  // 2026, and `/admin/security` implements the MFA enforcement level and
  // nothing about media. A relocation nobody performed is not a judgement, and
  // filing it as one kept the surface off this list — the one list that is
  // supposed to say how much is unbuilt. The reasoning about WHERE it belongs
  // still holds: a one-way tenant posture switch sits with the other posture
  // switches, not in an object console. There is deliberately no
  // `enforcement.disable` permission to screen at all.
  "media_library.enforcement.enable",
  "media_library.enforcement.read",

  // module_management (6)
  "module_management.health.check",
  "module_management.health.read",
  "module_management.jobs.read",
  "module_management.modules.read",
  "module_management.modules.sync",
  "module_management.permissions.read",

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
  "visitor_analytics.settings.update",

  // omes_control (12) — ADR-0122 / Issue ahliweb/omes#196. Schema, RLS, permissions,
  // and domain descriptors admitted in this foundation PR. The Control Center admin screens
  // (/admin/omes/*: servers, deployments, worker jobs, backups) land in subsequent issues. `servers.read` left this ledger when
  // `/admin/omes/mission-control` (ahliweb/omes#265) became the first screen to claim it as a LITERAL
  // triple (the other OMES screens use `OMES_GUARDS.*`, which the scanner does not resolve).
  "omes_control.audit.read",
  "omes_control.backups.read",
  "omes_control.backups.restore",
  "omes_control.backups.rollback",
  "omes_control.deployments.operate",
  "omes_control.deployments.read",
  "omes_control.enrollments.manage",
  "omes_control.jobs.approve",
  "omes_control.jobs.cancel",
  "omes_control.jobs.read",
  "omes_control.servers.delete",
  "omes_control.servers.register",

  // inventory (1) — ADR-0126 / Issue #887. `/admin/inventory` (Issue #894)
  // claimed ten, and Issue #901 the eleventh: `balances.rebuild` is now a
  // guarded, confirmed screen action (it rewrites balances FROM the ledger and
  // carries no quantity, so it cannot assert one). What remains is
  // `movements.create`, which posts caller-attested sale/receive/return
  // movements, where "verifying the document is the consumer duty". Not a
  // decision yet, so it stays on the shrink-only list.
  "inventory.movements.create",

  // tax (4) — ADR-0127 / Issue #889. `/admin/tax` (Issue #894) claimed the rule,
  // snapshot-read and report keys. The four left are consumer actions — a
  // storefront or POS quotes, finalises, refunds and (with a second permission)
  // backdates a document; no operator composes one in a browser.
  "tax.calculations.analyze",
  "tax.snapshots.backdate",
  "tax.snapshots.create",
  "tax.snapshots.reverse",

  // procurement (1) — ADR-0128 / Issue #888. `/admin/procurement` (Issue #905)
  // claimed the other sixteen. What remains is editing a DRAFT in place
  // (`PUT /documents/{id}`): the screen creates a draft and, for a mistake,
  // cancels it and enters a new one, so this stays on the shrink-only list until
  // a draft editor is a decision.
  "procurement.documents.update",

  // hr_workforce (7) — ADR-0132 / Issue #945. Phase 1 foundation shipped
  // API-first. Issue #952 added the self-service, supervisor and HR screens
  // (`/admin/hr/*`), flipped the module to `active`, and claimed
  // `employments.read`, `attendance.read`, `corrections.create` and
  // `corrections.read`; the employment WRITE screens (create, terms, assign,
  // delete, restore) and the settings screens are still the recorded follow-up,
  // so each of those permissions is listed here until a screen claims it.
  "hr_workforce.employments.assign",
  "hr_workforce.employments.create",
  "hr_workforce.employments.delete",
  "hr_workforce.employments.restore",
  "hr_workforce.employments.update",
  "hr_workforce.settings.configure",
  "hr_workforce.settings.read",
  // booking (7) — ADR-0131 / Issue #937. Issue #942 shipped the admin screens
  // (`/admin/booking/*`) and claimed 25 of the 32 permissions. The seven left
  // have no screen YET, each for a reason the screens' own docblocks give:
  //   * `availability.read` -- the search/quote an operator would run before
  //     creating a reservation; belongs with the reservation-create screen.
  //   * `reservations.create`, `.reschedule`, `.override` -- they need a
  //     date/resource picker and, for override, a justified high-risk affordance;
  //     the detail screen deliberately offers only the single-call transitions.
  //   * `reservations.reconcile` -- the route does not exist yet.
  //   * `reservation_notes.read` -- an audited read of customer text; the
  //     screens deliberately never show the note.
  //   * `reports.read` -- the occupancy/utilization reports have no screen yet.
  "booking.availability.read",
  "booking.reservation_notes.read",
  "booking.reservations.create",
  "booking.reservations.reschedule",
  "booking.reservations.override",
  "booking.reservations.reconcile",
  "booking.reports.read",

  // hr_commission (5) — ADR-0132 / Issue #950. Phase 2 foundation ships API-first
  // and `experimental` (flag off): the rule screens are the recorded follow-up
  // that flips the module to `active`, so each permission is listed here until a
  // screen claims it.
  "hr_commission.rules.create",
  "hr_commission.rules.publish",
  "hr_commission.rules.read",
  "hr_commission.rules.retire",
  "hr_commission.rules.update",
  // hr_commission intake (2) — ADR-0147 / Issue #1189. The intake queue ships
  // API-first like the rest of the module: the switch (`PUT /api/v1/hr-commission/
  // intake/settings`) and the read-only exceptions list with the poster's counts
  // (`GET .../intake/exceptions`) are the whole surface, and a page over them is
  // the recorded follow-up (an operator can drive both from the API meanwhile).
  "hr_commission.intake.configure",
  "hr_commission.intake.read",
  // hr_workforce shifts (8) — ADR-0132 / Issue #946. Same posture as above:
  // API-first and `experimental`; the shift roster and template screens are the
  // recorded follow-up that flips the module to `active`.
  "hr_workforce.shifts.cancel",
  "hr_workforce.shifts.create",
  "hr_workforce.shifts.publish",
  "hr_workforce.shifts.read",
  "hr_workforce.templates.create",
  "hr_workforce.templates.delete",
  "hr_workforce.templates.read",
  "hr_workforce.templates.update",

  // hr_commission accruals (6) — ADR-0132 / Issue #951. The ledger ships API-first
  // like the rules: the accrual screens (list, approve/release/void/pay) are the
  // recorded follow-up that flips the module to `active`.
  "hr_commission.accruals.approve",
  "hr_commission.accruals.cancel",
  "hr_commission.accruals.accrue",
  "hr_commission.accruals.pay",
  "hr_commission.accruals.read",
  "hr_commission.accruals.release",
  // hr_workforce attendance (7) — ADR-0132 / Issue #947. Same posture: API-first
  // and `experimental`; the attendance and correction-inbox screens are the
  // recorded follow-up that flips the module to `active`.
  "hr_workforce.attendance.create",
  "hr_workforce.clock.create",
  "hr_workforce.corrections.approve",
  "hr_workforce.corrections.cancel",
  // hr_workforce workforce metrics (2) — Issue #953. Same posture: API-first and
  // `experimental`; the metrics screen (per-employee list for `read`, per-office
  // aggregates for `analyze`) is part of the recorded follow-up that flips the
  // module to `active`. The facts are reachable by their owners meanwhile
  // through the ownership-granted routes (`?mine=true`, `?reports=true`).
  "hr_workforce.workforce_metrics.analyze",
  "hr_workforce.workforce_metrics.read",
  // hr_workforce geolocation evidence (2) — ADR-0138 / Issue #970. API-first like
  // the rest of the module: the issue asks for no screen. The configure screen
  // (switch, DPIA reference, notice, geofences) and the evidence reader are the
  // recorded follow-up; until then both are reachable only through the API.
  "hr_workforce.attendance_evidence.read",
  "hr_workforce.geolocation_evidence.configure",
  // channel_accounts (3 of 6 still unscreened) — ADR-0148 / Issue #1140. The
  // connection manager (#1154) screens `accounts.read`, `accounts.revoke` and
  // `credentials.manage` (/admin/channel-accounts and its detail). The three
  // below are the recorded remainder: registering/enabling an account and the
  // OAuth/device connect wizard need a provider connector that does not exist
  // yet (`POST /connections/oauth/start` answers PROVIDER_ADAPTER_UNAVAILABLE);
  // recording a capability grant needs an evidence form with a review step; and
  // assigning operators needs a person picker. Each is a screen of its own.
  "channel_accounts.accounts.create",
  "channel_accounts.assignments.assign",
  "channel_accounts.capabilities.configure",
  // channel_accounts risk acknowledgements (3) — Issue #1142, ADR-0148 section
  // 7. API-first: the text, the acknowledgement, its revocation and the device
  // attestation are complete (`/risk-acknowledgements`, `/accounts/{id}/attest-device`).
  // The connection manager (#1154) does NOT claim them: its detail screen shows
  // none of the unofficial-provider text, the acknowledgement or the attestation,
  // so they stay here until a screen of their own reads that text next to the
  // device it governs.
  "channel_accounts.risk_acknowledgements.create",
  "channel_accounts.risk_acknowledgements.read",
  "channel_accounts.risk_acknowledgements.revoke",
  // Meta multi-WABA sender binding (4) — Issue #1143. API-first: the signed
  // webhook subscription (app secret write-only, callback token shown once),
  // the per-WABA template approvals with their evidence, and clearing a WABA
  // restriction. Each needs its own screen next to the WABA it governs (the
  // one-time token display has the same WCAG contract as the website source
  // token); until then they are reachable only through the API.
  "channel_accounts.webhooks.configure",
  "whatsapp_delivery.meta_signals.configure",
  "whatsapp_delivery.meta_templates.configure",
  "whatsapp_delivery.meta_templates.read",
  // whatsapp_delivery sender routing (2) — Issue #1141, ADR-0148 section 4.
  // The default-sender action is on the channel-account detail screen (#1154),
  // which claims BOTH keys (`sender_policy.configure` for the action,
  // `senders.read` for the "is this the default" readout and queue impact) and
  // so they leave this ledger. `/admin/whatsapp` stays gated on `messages.read`.
  // website_engagement (1) — ADR-0155 / Issue #1153. `/admin/website-engagement`
  // (and its `/{id}` and `/sources`) claim `sources.read`, `sources.manage`
  // (revoke), `submissions.read` and `submissions.withdraw`, so those four left
  // this ledger. What remains is the audited REVEAL of a submission's decrypted
  // contact details: it needs its own screen contract (a deliberate, per-row,
  // audited POST that renders personal data once), and is API-only until then.
  "website_engagement.submissions.reveal",
  // social_publishing (9) — ADR-0157 / Issue #1145. API-first and
  // `experimental`: the operator screen (the publication list with its derived
  // status, the per-account job table where a partial failure is read, the
  // approval and caption/alt/media review, the schedule, per-job retry, the
  // rules and the two tenant switches; the omnichannel screen contract UP-08..16)
  // is the recorded follow-up that flips the module to `active` and adds its
  // navigation entry in the same change (a nav entry without a page is a
  // permanent 404). Admin screens for this family belong to `ahliweb/awcms-astro`
  // only for the USER surface; this is SYSTEM admin and is built here.
  "social_publishing.jobs.retry",
  "social_publishing.publications.approve",
  "social_publishing.publications.cancel",
  "social_publishing.publications.publish",
  "social_publishing.publications.read",
  "social_publishing.publications.schedule",
  "social_publishing.rules.configure",
  "social_publishing.rules.read",
  "social_publishing.settings.configure",
  // crm_leads (11) — ADR-0153 / Issue #1166. API-first and `experimental`: the
  // operator screen (pipeline and revision editor with stage categories and
  // edge guards, the lead list with masked contact points, the lead detail with
  // its transition history, candidates, merge review with undo, conversions and
  // the tenant switch) is the recorded follow-up that flips the module to
  // `active` and adds its navigation entry in the same change (a nav entry
  // without a page is a permanent 404). SYSTEM admin, built here.
  "crm_leads.conversions.approve",
  "crm_leads.leads.assign",
  "crm_leads.leads.create",
  "crm_leads.leads.delete",
  "crm_leads.leads.read",
  "crm_leads.leads.restore",
  "crm_leads.leads.update",
  "crm_leads.manual_conversions.create",
  "crm_leads.merges.manage",
  "crm_leads.pipelines.configure",
  "crm_leads.stages.update",

  // email sender routing (3) — Issue #1160, ADR-0151 section 2. API-first:
  // the operator screen (accounts with the v2 badge, verified senders, credit,
  // queue status, last sync, the default-sender policy and the migration
  // warning, ADR-0151 section 7) is Issue #1162, which claims these keys and
  // removes them from this ledger in the same change.
  "email.sender_policy.configure",
  "email.senders.read",
  "email.senders.use",
  // telegram_engagement (5) — ADR-0152 / Issue #1156. API-first and
  // `experimental`: the operator screen (the bot list with webhook state and
  // health, register/rotate/revoke behind step-up, the per-bot contact list with
  // masked labels and per-purpose eligibility, the reply composer and the
  // explicit opt-in prompt, the audited erase) is the recorded follow-up that
  // flips the module to `active` and adds its navigation entry in the same
  // change (a nav entry without a page is a permanent 404).
  "telegram_engagement.bots.configure",
  "telegram_engagement.bots.read",
  "telegram_engagement.contacts.delete",
  "telegram_engagement.contacts.read",
  "telegram_engagement.messages.create",
  // crm_follow_up (5) — ADR-0159 (Proposed) / Issue #1165. API-first and
  // `experimental`: the operator screens (the worklist and overdue queue with
  // complete/cancel, the rule editor with its revision history and simulation,
  // a lead's stop signals, the tenant switch) are the recorded follow-up that
  // flips the module to `active` and adds its navigation entry in the same
  // change. SYSTEM admin, built here.
  "crm_follow_up.rules.configure",
  "crm_follow_up.rules.read",
  "crm_follow_up.stop_signals.create",
  "crm_follow_up.tasks.read",
  "crm_follow_up.tasks.update",

  // email Mailketing webhook (3) — Issue #1161, ADR-0151 section 5. API-first:
  // the callback URL management and the quarantine review queue ("provider-
  // reported, unauthenticated") belong to the email admin UI of Issue #1162,
  // which claims these keys and removes them from this ledger in that change.
  "email.provider_events.approve",
  "email.webhook.configure",
  "email.webhook.read",

  // omnichannel_inbox (7) — ADR-0160 (Proposed) / Issue #1164. API-first and
  // `experimental`: the operator screen (the conversation list with status,
  // assignee, tag and breached-SLA filters, the detail with its activity
  // history, assignment, tags, SLA policy authoring and the rebuild) is the
  // recorded follow-up that flips the module to `active` and adds its
  // navigation entry in the same change (a nav entry without a page is a
  // permanent 404).
  "omnichannel_inbox.conversations.assign",
  "omnichannel_inbox.conversations.read",
  "omnichannel_inbox.conversations.update",
  "omnichannel_inbox.projection.configure",
  "omnichannel_inbox.sla_policies.configure",
  "omnichannel_inbox.sla_policies.read",
  "omnichannel_inbox.tags.configure"
];
