🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](ui-single-flight-audit.id.md)

# Single flight by default: audit of every form and mutation entry point

> Audit for [Issue #1224](https://github.com/ahliweb/awcms/issues/1224).
> Describes the state AFTER the change. The table below is **generated** from the
> source (`bun run ui:single-flight:audit --write`) and verified by
> `tests/single-flight-source-contract.test.ts`, so a form that is added, moved
> or rebound without updating this document fails `bun run check`.

## 1. What changed

Until #1224 the only protection against a double submit was a page script
remembering to call `lockElement` on its own button. `onSubmit`, `onSubmitAll`
and `onAction` kept no state: they ran `event.preventDefault(); void
handler(ctx)`. A page that forgot, or a future page, shipped a form that created
two records on a fast double tap.

The three binders in `src/lib/ui/admin-form-client.ts` now own an **in-flight
flag per form** (per button for `onAction`):

1. While the handler's promise is pending, a further `submit` or `click` is
   **ignored, not queued**. The native POST is still cancelled, so Enter and
   implicit submission cannot fall through. The flag is released in `finally`:
   a throw, an `{ ok: false }` and a network error all leave the form usable
   (this is what keeps a refused Turnstile challenge or a wrong MFA code
   retryable).
2. Visible state: `aria-busy="true"` on the form and the submit button disabled,
   **without changing its label**. A page that also calls
   `lockElement(submit, "Saving…")` keeps its own busy label; `lockElement` is
   idempotent and every disable goes through one registry, so a second lock never
   records the busy label as "the original". Release restores exactly what was
   there before.
3. Success that navigates keeps the lock: `mutateAndReload` and the new
   `holdForNavigation()` keep the form locked until the page leaves, and a
   `lockElement` a page leaves held (as every page did on success) counts the
   same, but only when the handler RETURNS: a throw always releases. A
   `pageshow` with `persisted` (the bfcache back button) releases it, and so
   does a 10 s timer when the navigation never replaced the page (a download, a
   cancelled unload).
4. Server side stays authoritative. This removes the duplicate request; it does
   not replace an `Idempotency-Key` or a unique constraint (§4).

The state machine is `createSingleFlight` (pure, three injected ports) and the
DOM adapter is a thin layer over it, unit-tested in
`tests/admin-single-flight.test.ts`. No new dependency.

## 2. How to read the table

- **Bound as (now)**: `onSubmit` / `onSubmitAll` / `onAction` are the shared
  helpers; `direct …` is a listener the page attached itself (only the allow-list
  in §3 may be one).
- **Before #1224**: how the entry was protected by its own page. `lock` means the
  handler (or a helper it calls) called `lockElement`/`mutateAndReload` on a real
  control; `own flag` is a hand-rolled `disabled`/`busy` flag; **none** had no
  protection. Where an entry was rebound by #1224 the old binding is named.
- **After #1224**: every entry is single-flight through the helper except the
  listed exceptions.
- **Idempotency-Key sent**: the client sends one (a fresh UUID or a key derived
  from the body). `—` means the endpoint takes none, which is its own documented
  decision (§4).

The table is a lexical scan, not a proof: it strips comments, finds the binding
call and matches its parentheses. Anything it cannot classify is reported as
`none`, never dropped, and the "before" facts for the handful of entries the
change touched are recorded by hand in `scripts/lib/single-flight-audit.ts` with
the reason.

## 3. The audit table

<!-- BEGIN GENERATED: single-flight-audit -->

231 entry points in 77 files; 227 send a mutating request and 4 do not. Before #1224 those 227 were protected by `lockElement`/`mutateAndReload` in 212, by a hand-rolled flag in 11, and by nothing in 4. After: 227 of the 231 are bound through the shared helpers (single flight by default); the other 4 are listed exceptions that keep their own reviewed guard.

| File | Target | Bound as (now) | Before #1224 | After #1224 | Idempotency-Key sent |
| --- | --- | --- | --- | --- | --- |
| `src/lib/ui/admin-account-client.ts` | `account-profile-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/lib/ui/admin-account-client.ts` | `account-preferences-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/lib/ui/admin-account-client.ts` | `#account-time-zone-detect` | onAction | no request | single-flight (helper) | — |
| `src/lib/ui/admin-account-client.ts` | `account-password-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/lib/ui/admin-account-client.ts` | `#account-mfa-enrol` | onAction | no request | single-flight (helper) | — |
| `src/lib/ui/admin-account-client.ts` | `account-mfa-start-form` | onSubmit | own flag (`submit.disabled` around the request) | single-flight (helper) | — |
| `src/lib/ui/admin-account-client.ts` | `account-mfa-verify-form` | onSubmit | own flag (`submit.disabled` around the request) | single-flight (helper) | — |
| `src/lib/ui/admin-account-client.ts` | `#account-mfa-disable` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/lib/ui/admin-account-client.ts` | `#account-mfa-codes` | onAction | own flag (`button.disabled` around the request) | single-flight (helper) | — |
| `src/lib/ui/admin-account-client.ts` | `.account-session-revoke` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/lib/ui/admin-account-client.ts` | `#account-sessions-revoke-all` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/lib/ui/admin-account-client.ts` | `.account-sso-link` | onAction | **none** (no lock at all; navigates away on success. Each click minted a link request) | single-flight (helper) | — |
| `src/lib/ui/admin-account-client.ts` | `.account-sso-unlink` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/lib/ui/blog-preview-overlay.ts` | `keydown` | direct keydown | **none** (Enter re-fired `saveEditing` while the PATCH was pending) | exception (allow-list) | — |
| `src/lib/ui/language-switcher-client.ts` | `.locale-switcher` | onSubmitAll | direct submit: own flag (`select.disabled`; the form had no other guard (Enter in the select)) | single-flight (helper) | — |
| `src/lib/ui/mission-control/actions.ts` | `click` | direct click | own flag (`busy` flag + disabled) | exception (allow-list) | yes |
| `src/lib/ui/mission-control/actions.ts` | `click` | direct click | own flag (`busy` flag + disabled) | exception (allow-list) | yes |
| `src/lib/ui/reason-panel-client.ts` | `click` | direct click | `lockElement`/`mutateAndReload` | exception (allow-list) | yes |
| `src/pages/accept-invitation.astro` | `invitation-form` | onSubmit | direct submit: `lockElement`/`mutateAndReload` (`lockElement` + `submitButton.disabled` check) | single-flight (helper) | — |
| `src/pages/admin/abac-policies.astro` | `policy-create-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/abac-policies.astro` | `button.policy-edit` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/abac-policies.astro` | `button.policy-toggle` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/access-policies.astro` | `policy-simulate-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/approvals.astro` | `.task-decide-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/approvals.astro` | `.task-reassign-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/approvals.astro` | `.task-force-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/approvals.astro` | `.instance-cancel-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/approvals.astro` | `.delegation-revoke-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/approvals.astro` | `delegation-create-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/blog-ads.astro` | `.ad-delete-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/blog-ads.astro` | `ad-placement-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/blog-homepage.astro` | `.section-delete-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/blog-homepage.astro` | `homepage-section-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/blog-institutions.astro` | `.institution-delete-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/blog-institutions.astro` | `.institution-restore-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/blog-institutions.astro` | `.institution-purge-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/blog-institutions.astro` | `institution-edit-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/blog-institutions.astro` | `institution-create-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/blog-pages.astro` | `` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/blog-pages.astro` | `.page-delete-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/blog-pages.astro` | `page-edit-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/blog-pages.astro` | `page-create-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/blog-presentation.astro` | `.presentation-delete-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/blog-presentation.astro` | `` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/blog-presentation.astro` | `theme-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/blog-settings.astro` | `blog-settings-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/blog-taxonomy.astro` | `.term-delete-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/blog-taxonomy.astro` | `term-edit-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/blog-taxonomy.astro` | `term-create-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/blog.astro` | `` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/blog.astro` | `.post-delete-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/blog.astro` | `.revision-restore-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/blog.astro` | `post-create-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/blog.astro` | `post-edit-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/booking/blocks.astro` | `block-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/booking/blocks.astro` | `.block-release-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/booking/offerings.astro` | `offering-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/booking/offerings.astro` | `.offering-delete-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/booking/offerings.astro` | `.offering-restore-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/booking/policy.astro` | `policy-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/booking/reservations.astro` | `.reservation-action-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/booking/resources.astro` | `resource-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/booking/resources.astro` | `.resource-delete-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/booking/resources.astro` | `.resource-restore-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/booking/resources.astro` | `pool-create-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/booking/resources.astro` | `.pool-save-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/booking/resources.astro` | `.pool-delete-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/booking/resources.astro` | `.pool-restore-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/booking/schedules.astro` | `schedule-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/booking/schedules.astro` | `exception-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/booking/schedules.astro` | `.schedule-end-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/booking/schedules.astro` | `.schedule-deactivate-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/booking/schedules.astro` | `.exception-delete-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/business-scope.astro` | `assign-scope-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/business-scope.astro` | `request-exception-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/business-scope.astro` | `.js-${action}-exception` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/channel-accounts/[id].astro` | `channel-account-credential-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/channel-accounts/[id].astro` | `channel-account-disconnect-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/channel-accounts/[id].astro` | `channel-account-revoke-connection-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/channel-accounts/[id].astro` | `.js-channel-default-sender` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/comments.astro` | `[data-comments-queue] button[data-action]` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/comments.astro` | `[data-bulk-bar] button[data-bulk-action]` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/data-lifecycle.astro` | `data-lifecycle-plan-form` | onSubmit | no request | single-flight (helper) | — |
| `src/pages/admin/data-lifecycle.astro` | `data-lifecycle-hold-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/data-lifecycle.astro` | `form[data-release-form]` | onSubmitAll | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/domain-events.astro` | `.consumer-resume-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/email-senders.astro` | `.js-email-default-sender` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/email-suppression.astro` | `add-suppression-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/email-suppression.astro` | `.js-remove-suppression` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/email-templates.astro` | `email-template-create-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/form-drafts.astro` | `.draft-delete-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/hr/my-work.astro` | `correction-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/idn-regions.astro` | `[data-activate-dataset]` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/idn-regions.astro` | `#idn-regions-rollback` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/inventory.astro` | `location-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/inventory.astro` | `.js-location-status` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/inventory.astro` | `.js-save-location-details` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/inventory.astro` | `.js-save-location-policy` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/inventory.astro` | `tenant-policy-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/inventory.astro` | `threshold-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/inventory.astro` | `rebuild-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/inventory.astro` | `adjust-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/inventory.astro` | `transfer-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/inventory.astro` | `.js-reversal-form` | onSubmitAll | **none** (`mutateAndReload(null, …)`: the reason panel's hidden form has no button to lock; the `Idempotency-Key` was the only guard) | single-flight (helper) | yes |
| `src/pages/admin/invitations.astro` | `create-invitation-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/invitations.astro` | `.js-resend-invitation, .js-revoke-invitation` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/machine-credentials.astro` | `issue-credential-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/machine-credentials.astro` | `.js-revoke-credential` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/media.astro` | `media-upload-form` | onSubmit | direct submit: own flag (`submit.disabled` + `fileInput.disabled`) | single-flight (helper) | yes |
| `src/pages/admin/media.astro` | `.media-restore-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/media.astro` | `.media-purge-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/media.astro` | `media-rights-fields` | onSubmit | direct submit: `lockElement`/`mutateAndReload` (`mutateAndReload`) | single-flight (helper) | yes |
| `src/pages/admin/modules.astro` | `button.module-toggle` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/modules/[moduleKey].astro` | `module-settings-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/offices.astro` | `office-create-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/offices.astro` | `.office-save-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/offices.astro` | `.office-delete-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/offices.astro` | `.office-restore-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/omes/ai-privacy.astro` | `.js-egress-decide` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/omes/backups.astro` | `.backup-restore-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/omes/enrollments.astro` | `.js-issue-tok` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/omes/enrollments.astro` | `.js-revoke-tok` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/omes/jobs.astro` | `.job-approve-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/omes/jobs.astro` | `.job-cancel-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/omes/operations.astro` | `operation-submit-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/omes/progres-hermes.astro` | `repo-progress-config-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/omes/progres-hermes.astro` | `#repo-progress-config-clear` | onAction | direct click: `lockElement`/`mutateAndReload` (`mutateAndReload`) | single-flight (helper) | yes |
| `src/pages/admin/omes/servers.astro` | `server-register-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/omes/servers.astro` | `.server-decommission-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/omnichannel-inbox/[id].astro` | `omnichannel-status-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/omnichannel-inbox/[id].astro` | `omnichannel-tags-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/omnichannel-inbox/[id].astro` | `.js-inbox-respond` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/omnichannel-inbox/[id].astro` | `.js-inbox-assign-me` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/omnichannel-inbox/[id].astro` | `.js-inbox-unassign` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/omnichannel-inbox/settings.astro` | `omnichannel-policy-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/omnichannel-inbox/settings.astro` | `.js-inbox-policy-retire` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/omnichannel-inbox/settings.astro` | `omnichannel-tag-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/omnichannel-inbox/settings.astro` | `.js-inbox-tag-delete` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/omnichannel-inbox/settings.astro` | `.js-inbox-rebuild` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/partner-registry.astro` | `register-partner-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/partner-registry.astro` | `.js-${action}-partner` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/partners.astro` | `engage-partner-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/partners.astro` | `approve-grant-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/partners.astro` | `.js-sever-engagement` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/partners.astro` | `.js-revoke-grant` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/procurement.astro` | `supplier-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/procurement.astro` | `supplier-edit-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/procurement.astro` | `.js-supplier-delete` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/procurement.astro` | `.js-supplier-restore` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/procurement.astro` | `identifier-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/procurement.astro` | `.js-remove-identifier` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/procurement.astro` | `.js-reveal-identifier` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/procurement.astro` | `document-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/procurement.astro` | `.js-document-action` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/procurement.astro` | `.js-document-reason-form` | onSubmitAll | **none** (`mutateAndReload(null, …)`: as above) | single-flight (helper) | yes |
| `src/pages/admin/procurement.astro` | `policy-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/profiles.astro` | `profile-create-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/push-notifications.astro` | `#push-enable-button` | onAction | direct click: own flag (`button.disabled` in try/finally) | single-flight (helper) | — |
| `src/pages/admin/push-notifications.astro` | `#push-disable-button` | onAction | direct click: own flag (`button.disabled` in try/finally) | single-flight (helper) | — |
| `src/pages/admin/push-notifications.astro` | `#push-test-button` | onAction | direct click: own flag (`button.disabled` in try/finally) | single-flight (helper) | — |
| `src/pages/admin/push-notifications.astro` | `button.push-cancel` | onAction | own flag (`button.disabled`, left set on success) | single-flight (helper) | — |
| `src/pages/admin/registrations.astro` | `.js-approve-registration` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/registrations.astro` | `.js-reject-registration` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/reporting.astro` | `.projection-rebuild-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/reporting.astro` | `.projection-rebuild-cancel-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/reporting.astro` | `.projection-reconcile-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/reporting.astro` | `.export-disable-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/reporting.astro` | `export-create-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/reporting.astro` | `export-trigger-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/roles.astro` | `role-create-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/roles.astro` | `form[data-role-grant-form]` | onSubmitAll | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/roles.astro` | `button[data-role-action]` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/security.astro` | `security-policy-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/security.astro` | `security-mfa-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/seo.astro` | `seo-config-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/seo.astro` | `redirect-settings-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/seo.astro` | `#redirect-validate-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/seo.astro` | `redirect-create-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/seo.astro` | `.redirect-save-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/seo.astro` | `.redirect-lifecycle-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/seo.astro` | `.redirect-delete-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/seo.astro` | `#redirect-restore-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/seo.astro` | `#redirect-purge-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/seo.astro` | `.observation-resolve-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/seo.astro` | `.observation-dismiss-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/sidebar-menu.astro` | `sidebar-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/sidebar-menu.astro` | `#sidebar-reset` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/site-profile.astro` | `site-profile-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/site-search.astro` | `#site-search-reconcile` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/site-search.astro` | `#site-search-rebuild` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/site-search.astro` | `site-search-settings-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/subject-requests.astro` | `subject-export-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/subject-requests.astro` | `subject-erase-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/subject-requests.astro` | `.js-decide-request` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/sync.astro` | `.node-status-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/sync.astro` | `.conflict-resolve-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/sync.astro` | `.queue-retry-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/tax.astro` | `rule-version-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/tax.astro` | `.js-publish-version` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/telegram.astro` | `.js-telegram-link` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/telegram.astro` | `.js-telegram-confirm` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/telegram.astro` | `.js-telegram-reject` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/telegram.astro` | `.js-telegram-unlink` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/telegram.astro` | `.js-telegram-revoke` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/telegram.astro` | `.js-telegram-toggle` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/tenant/domains.astro` | `domain-create-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/tenant/domains.astro` | `.domain-verify-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/tenant/domains.astro` | `.domain-primary-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/tenants.astro` | `tenants-create-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/theming.astro` | `#theming-validate` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/theming.astro` | `theming-draft-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/theming.astro` | `#theming-preview` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/theming.astro` | `#theming-publish` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/theming.astro` | `#theming-retire` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/theming.astro` | `.theming-rollback-btn` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | yes |
| `src/pages/admin/user-groups.astro` | `user-group-create-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/user-groups.astro` | `#user-groups-table button[data-action]` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/users.astro` | `.js-user-sessions` | onAction | no request | single-flight (helper) | — |
| `src/pages/admin/users.astro` | `.js-user-sessions-revoke` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/users.astro` | `.js-user-status` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/users.astro` | `.js-assign-role` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/users.astro` | `.js-unassign-role` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/whatsapp.astro` | `.js-whatsapp-cancel` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/whatsapp.astro` | `.js-whatsapp-withdraw` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/whatsapp.astro` | `.js-whatsapp-unsuppress` | onAction | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/whatsapp.astro` | `whatsapp-consent-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/admin/whatsapp.astro` | `whatsapp-suppression-form` | onSubmit | `lockElement`/`mutateAndReload` | single-flight (helper) | — |
| `src/pages/forgot-password.astro` | `forgot-form` | onSubmit | direct submit: `lockElement`/`mutateAndReload` (`lockElement` + `submitButton.disabled` check) | single-flight (helper) | — |
| `src/pages/login.astro` | `login-form` | onSubmit | direct submit: `lockElement`/`mutateAndReload` (`lockElement` + `submitButton.disabled` check) | single-flight (helper) | — |
| `src/pages/register.astro` | `register-form` | onSubmit | direct submit: `lockElement`/`mutateAndReload` (`lockElement` + `submitButton.disabled` check) | single-flight (helper) | — |
| `src/pages/reset-password.astro` | `reset-form` | onSubmit | direct submit: `lockElement`/`mutateAndReload` (`lockElement` + `submitButton.disabled` check) | single-flight (helper) | — |

**Allowed exceptions**

- `src/lib/ui/mission-control/actions.ts` (2) — Buttons CREATED by script inside the mission-control HUD (no form, no stable selector). Own `busy` flag + disabled while the POST is in flight, and a fresh `Idempotency-Key` per send.
- `src/lib/ui/reason-panel-client.ts` (1) — The `<dialog>` confirm button of `ReasonPanel`, not a form. `lockElement` runs synchronously before the first await and the dialog closes on the same click, so a second click has no target.
- `src/lib/ui/blog-preview-overlay.ts` (1) — Enter inside a `contenteditable` block of the preview overlay: a standalone bundle with no `<form>`. A `saving` flag now ignores a second Enter while the PATCH is in flight (found by this audit); the PATCH also converges on retry.

<!-- END GENERATED: single-flight-audit -->

## 4. Server side and follow-ups

- High-risk mutations already carry an `Idempotency-Key` (the "sent" column).
  None was added to a naturally idempotent operation.
- Keyless create endpoints that the pages document as protected by a unique
  constraint (blog posts/pages/terms/institutions, email templates, inventory
  locations, partners) were left alone. A spot check of `offices`, `roles`, ABAC
  policies, tenant domains and user groups found the `(tenant_id, code)` unique
  index in `sql/`.
- **Follow-up candidate, not widened into this change:** `POST /api/v1/profiles`
  is not idempotency-keyed and `awcms_profiles` has no natural unique key, so a
  duplicate request that does reach the server creates a second profile. The
  double-submit path through the UI is now closed; a retry after a lost response
  is not. This audit did not verify every keyless create endpoint against a
  constraint exhaustively; the rows with `—` in the last column are the list to
  walk.

## 5. How to add a form

Bind it through `onSubmit` / `onSubmitAll` / `onAction`. That is the whole job:
single flight, `aria-busy`, disabled submit and the bfcache restore come with it.
If the handler navigates on success without `mutateAndReload`, call
`holdForNavigation()` first. Then run `bun run ui:single-flight:audit --write`
and commit the regenerated tables in both languages.

A binding the helpers cannot express (a button created by script, a `<dialog>`
control) needs an entry in `ALLOWED_DIRECT_BINDINGS`
(`scripts/lib/single-flight-audit.ts`) with the reason; the contract test fails
otherwise, and also fails when an entry there stops matching the source.
