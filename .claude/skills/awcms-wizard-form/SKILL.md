---
name: awcms-wizard-form
description: **ADR-0055 (2 August 2026): this is a BUILD-IT-HERE candidate, not a port.** `awcms-mini`/`awcms-micro` are now ARCHIVES — they may be read as a specification, but the "port from mini" path is REVOKED. Working on it means: ADR admission first, then build it in this repo under the ADR-0055 §3 guardrails (ADR mandatory, security review for auth/access/sync, full `bun run check`, OpenAPI/AsyncAPI in sync, RLS FORCE, ABAC default-deny). READ-ONLY / TARGET SPECIFICATION — the reusable wizard-form component library (WizardStepper/WizardPanel/WizardActions, `wizard-client.ts`) has NOT been ported into this repo (it exists in awcms-mini; `find src -iname "*wizard*"` finds nothing here, and `src/components/ui` does not even exist). Do not confuse it with the "Setup Wizard" (`/setup`, first-tenant onboarding) which DOES exist in this repo but is a different feature. Use this skill as the target specification when BUILDING a multi-step form here (ADR admission first), not as a guide to implementation code you can call today — verify first.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Reusable Wizard Form (does not exist here yet)

> **STATUS — READ-ONLY: this multi-step wizard form pattern/component set does
> NOT exist in this repo yet.** Every component
> (`src/components/ui/WizardStepper.astro`, `WizardPanel.astro`,
> `WizardActions.astro`), the state helper (`src/lib/ui/wizard-client.ts`), the
> documents (`docs/awcms/examples/wizard-form-pattern.md`,
> `wizard-derived-module-example.md`), the fixture
> (`src/pages/admin/examples/wizard.astro`), and the tests
> (`tests/wizard-accessibility.test.ts`, `tests/wizard-client.test.ts`)
> referenced below are **awcms-mini** artifacts — this repo does not even have
> `src/components/ui` at all (verify: `find src -iname "*wizard*"` is empty,
> `find src/components -type d` fails with "No such file or directory").
> **Do not confuse it with the "Setup Wizard"** (`/setup`, first-time
> owner+tenant onboarding — see `src/modules/tenant-admin/README.md` §Setup
> wizard, skill `awcms-tenant-admin`) — that is a different feature which does
> exist in this repo. Use this skill as the target specification when BUILDING
> it here (ADR admission first, ADR-0055 §1), not as a map of code you can call
> — verify `find src -iname "*wizard*"` before claiming anything exists here.

Original specification (in the **awcms-mini** archive repo, not here yet):
`docs/awcms-mini/examples/wizard-form-pattern.md` (component specification +
i18n pattern) and `docs/awcms-mini/examples/wizard-derived-module-example.md`
(end-to-end example on a domain module). Reference fixture in awcms-mini:
`src/pages/admin/examples/wizard.astro` (`/admin/examples/wizard`).

## When to use a wizard instead of a plain form (target specification)

Any one of: many fields across categories, a clear input order is needed, a
final review is needed before submit, or there are enough fields that one big
form invites input mistakes. Keep using a plain form for simple input (rename,
change status, one or two fields) — plain forms in this repo itself use
hand-rolled markup + `lockElement`/`sendJson`
(`src/lib/ui/admin-form-client.ts`, see skill `awcms-ui-screen`), not any
wizard component.

## Components (target specification — exist in awcms-mini, NOT here yet)

`src/components/ui/WizardStepper.astro` (progress + step status) +
`WizardPanel.astro` (one step, `hidden` for the inactive step — not unmounted,
so input is not lost) + `WizardActions.astro` (Back/Next/Submit/Save-draft) +
`src/lib/ui/wizard-client.ts` (pure state: `createWizardState`,
`advanceWizard`, `rewindWizard`, `toFieldErrorMap`,
`mapValidationDetailsToFieldErrors`, `createWizardIdempotencyKey`) — **all of
it exists only in awcms-mini**. If you build a wizard in this repo, this is a
specification to read and decide on again, not something you can import
directly.

## Mandatory rules (specification — keep these decisions when building it here)

1. **All strings via props** — a wizard component never translates on its own;
   the calling page must `createTranslator(locale)` and then fill in every
   label prop (`label`/`currentLabel`/`completedLabel`/`pendingLabel` in
   `WizardStepper`, `errorSummaryHeading` in `WizardPanel`,
   `backLabel`/`nextLabel`/`submitLabel` in `WizardActions`) — skill
   `awcms-i18n`.
2. **Client validation is UX only** — the server remains the source of truth;
   map `VALIDATION_ERROR.details` back to fields via
   `mapValidationDetailsToFieldErrors`, do not validate again separately.
3. **The final submit is high-risk** — `createWizardIdempotencyKey()` once per
   submit attempt (not per button click) — skill `awcms-idempotency`.
4. **Anti-double-submit** — in awcms-mini this uses `lockElement`/`submitJson`/
   `showBanner` (the awcms-mini version of `src/lib/ui/admin-form-client.ts`,
   whose export list differs from this repo's). **Here the equivalents are
   `lockElement` + `messageBox` + `sendJson`, wired through `onSubmit`/
   `onAction`** — always verify with
   `grep -n "^export" src/lib/ui/admin-form-client.ts` before writing against
   it. Do not assume `submitJson`/`showBanner` (never existed here) or
   `postJson` (deleted in August 2026).
5. **Focus moves to the panel heading** every time the step changes
   (`tabindex="-1"` momentarily, then `.focus()`) — see `focusPanelHeading()`
   in the awcms-mini fixture.
6. **The stepper needs `data-step-key`** on each item if the page updates the
   stepper state via JS after the initial render (SSR-only, not reactive on its
   own).
7. **Client-side drafts hold non-sensitive data only**, and are not persistent
   (no `localStorage`). Need resume across sessions/devices, or does the
   payload contain anything beyond UX scratch state? The target pattern is
   server-side draft persistence — skill `awcms-form-drafts`. The `form_drafts`
   module **HAS been ported** (`sql/062` schema + `sql/063` permissions,
   endpoints `/api/v1/form-drafts/*`), so that skill is **no longer**
   read-only. What is still missing is the wizard COMPONENT library
   (`WizardStepper`/`wizard-client.ts`) — that is why THIS skill remains
   read-only.

## Verification (exists in awcms-mini — no counterpart in this repo yet)

Accessibility-attribute regression guard: `tests/wizard-accessibility.test.ts`.
State helper test: `tests/wizard-client.test.ts`. Manual keyboard-only
walkthrough: `wizard-form-pattern.md` §Manual keyboard-only walkthrough. When
building it here, build both of these tests along with the implementation
before considering it done.

## Related skills

`awcms-port-from-mini` (HISTORICAL — the port-from-awcms-mini flow, revoked by
ADR-0055 §1), `awcms-ui-screen` (the screen/token/a11y/markup patterns that DO
exist in this repo today), `awcms-i18n` (`.po` catalogs),
`awcms-idempotency` (the high-risk final submit), `awcms-new-endpoint` (the
domain endpoint the submit targets), `awcms-form-drafts` (resume-on-load across
sessions via the server — also READ-ONLY), `awcms-tenant-admin` (the different
Setup Wizard that does exist in this repo).
