🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0125-admin-v2-primitives-confirm-dialog-save-bar-reason-panel.id.md)

# ADR-0125 — three admin v2 primitives: confirm dialog, settings save bar, reason panel

- **Status:** Accepted
- **Date:** 2026-09-29
- **Decision maker:** ahliweb
- **Supersedes:** nothing.
- **Related:** [Issue #854](https://github.com/ahliweb/awcms/issues/854) (part 1 of 2 — the raw-enum/`data-label` i18n sweep in the same issue is a separate PR); `src/components/ConfirmDialog.astro`, `src/components/SettingsSaveBar.astro`, `src/components/ReasonPanel.astro`; `src/lib/ui/confirm-dialog-client.ts`, `src/lib/ui/settings-save-bar-client.ts`, `src/lib/ui/reason-panel-client.ts`; `src/layouts/AdminLayout.astro`; `docs/awcms/14_ui_ux_design_system.md`

## Context

`ahliweb/media-lenterakalteng` (LK) embeds this repo as `apps/cms` and, in its
own admin v2 epic (LK #240, LK ADR-0123/0124), built three admin UX
primitives **locally in its copy of this tree**:

1. An accessible confirm dialog (`initConfirmDialog`) replacing
   `window.confirm()`.
2. `SettingsSaveBar` — a sticky save bar that always renders and submits
   through `type="submit" form="…"`, so it works without JavaScript.
3. `ReasonPanel` — a `<dialog>` with a required reason textarea, replacing
   `window.prompt()` for an action whose endpoint records a reason.

Because they were built in LK's copy of the tree, no other consumer of this
template — including `ahliweb/awcms-one` — gets them through a subtree sync.
Per `AGENTS.md` §"Di repo mana pekerjaan dilakukan", a capability an operator
needs is built **here**, in `awcms`, with its own admission — not left to
live only in a downstream fork.

`window.confirm()` and `window.prompt()` also do not meet this repo's own
accessibility bar (`docs/awcms/14_ui_ux_design_system.md` §Aksesibilitas —
WCAG 2.2 AA): they are unstyled OS chrome (never theme-aware, so dark mode is
broken for them specifically), block the main thread, and their exact wording
and button order vary by browser and platform.

LK numbered its own local ADRs 0123 and 0124, which collide with this repo's
own ADR-0123 (backup encryption) and ADR-0124 (Obsidian vault) — upstream
adoption needed fresh numbers regardless of the code being materially
unchanged.

## Decision

Port the three primitives into this repo, adapted to neutral AWCMS naming and
this repo's own design tokens (`src/styles/tokens.css`) — no LK branding, no
new colours.

1. **`ConfirmDialog.astro` + `confirm-dialog-client.ts`.** One
   `<dialog id="confirm-dialog" role="alertdialog">`, rendered **once, by
   `AdminLayout.astro`**, not per-page — `AdminLayout` is the one component
   every `/admin/*` page renders, so this is the one place that guarantees
   the dialog exists before any screen's own script calls
   `confirmAction(message)`. `confirmAction` lazily wires and caches the
   dialog on first call, so a screen needs no setup call of its own — only
   the one-line conversion `if (!window.confirm(x)) return;` →
   `if (!(await confirmAction(x))) return;`. `showModal()` supplies the
   focus trap, Escape-closes, `::backdrop`, and focus restoration to the
   invoker — none of it is code this repo owns.

2. **`SettingsSaveBar.astro` + `settings-save-bar-client.ts`.** Unlike
   `ConfirmDialog`, this is rendered **per page**, by the individual settings
   screen — there is no one shared instance, because each screen submits a
   different form. Adopted on `site-profile.astro`, `blog-settings.astro`,
   and `theming.astro` (the three screens with exactly one settings form and
   a lone submit button). The submit/reset buttons carry `form="<id>"` and
   work with **no JavaScript** — the client module only toggles a dirty-state
   class and, where the caller wants it, swaps a status string.
   `admin-form-client.ts`'s `submitContext()` gained a fallback lookup
   (`button[type="submit"][form="<id>"]` outside the form) because its
   original `form.querySelector('button[type="submit"]')` assumed the submit
   button was always a form descendant, which `SettingsSaveBar` breaks by
   design.

3. **`ReasonPanel.astro` + `reason-panel-client.ts`.** Also rendered per page
   (only screens with a reason-required action need it). Declarative,
   `data-reason-*`-attribute-driven — an opener button needs zero
   page-specific JavaScript beyond one `initReasonPanel()` call. Two submit
   modes: `data-reason-action` (this module sends `{ [field]: reason }` as
   JSON itself) and `data-reason-form` (writes the reason into a hidden field
   on an existing form and calls `requestSubmit()`). An
   `data-reason-idempotent` opt-in sends a fresh `Idempotency-Key` per panel
   _open_ (not per click — a failed retry inside the same open must reuse the
   key). Added one field beyond LK's version: `data-reason-max-length`, which
   sets the textarea's native `maxlength` — needed because `/admin/media`'s
   delete reason has a server-enforced upper bound LK's two original
   consumers (module disable, newsletter suppress) did not.

### What was converted, and what was not

Every `window.confirm()` in `src/pages/admin/**` and `src/lib/ui/*.ts`
(43 call sites across 26 screens) was converted to `confirmAction()` — this
is mechanical and uniformly safe: every site already lived inside an `async`
handler (`onAction`'s callback), verified by `bun run check:astro-scripts:check`
type-checking every converted `<script>` block (an `await` outside an `async`
function is a compile error, not a runtime one).

`window.prompt()` was converted to `ReasonPanel` **only** where an opener maps
to exactly one endpoint call with exactly one free-text field, that field is
genuinely **required**, and a plain page reload (or an existing form's own
submit) is the correct thing to do on success: module disable
(`modules.astro`), newsletter subscriber suppress (`newsletter.astro`),
media object delete (`media.astro`, the one site needing
`data-reason-idempotent` + `data-reason-max-length`), tenant domain delete
(`tenant/domains.astro`), SoD business-scope assignment/exception revoke
(`business-scope.astro`, two sites), and domain-event consumer pause /
delivery replay (`domain-events.astro`, two sites — pause also had a separate
`confirmAction()` in front of it, now folded into the panel's own
description text).

Left as `window.prompt()` — evaluated, not converted, because none fits the
"one endpoint, one required field, reload-or-existing-form on success"
shape `ReasonPanel` commits to:

- **Optional reason** (`ReasonPanel`'s textarea is unconditionally
  `required`): `business-scope.astro`'s exception approve/reject, `roles.astro`'s
  delete reason, `sync.astro`'s conflict-resolution note.
- **Not a reason at all — a value/identifier/decision prompt**:
  `roles.astro` rename, `user-groups.astro` rename/add-member/remove-member,
  `approvals.astro` reassign-to-user-id and force-decision text,
  `abac-policies.astro` next-effect/next-description, `blog.astro`
  schedule-date and canonical-URL prompts, `admin-account-client.ts`'s
  verification-code prompt.
- **A second, endpoint-fixed body field alongside the reason**
  (`ReasonPanel` sends exactly `{ [field]: reason }`, nothing else):
  `subject-requests.astro`'s erasure decide, which also needs a fixed
  `decision: "approve" | "reject"` in the same body.
- **A success path that is not "reload" or "submit an existing form"**:
  `seo.astro`'s redirect delete, which on success navigates to
  `?recover=<id>` rather than reloading in place.
- **Multi-action generic dispatcher over a dynamic per-row id**:
  `comments.astro`'s reject/spam reason code, bound through one delegated
  listener covering four different row actions.

These are recorded here, not silently dropped, so a future PR extending
`ReasonPanel` (a second field, a configurable success action) has a concrete
list of consumers waiting on it rather than a fresh audit.

## Consequences

- Every admin screen now has three additive, server-unchanged primitives
  available; adopting one is a markup + one-import change, not a new
  endpoint, and authorization/validation stay exactly where they already
  were (server-side).
- `ConfirmDialog` being layout-owned means a future admin screen gets it for
  free — no import, no render, just `confirmAction()`.
- The 12 `window.prompt()` sites left unconverted are an explicit backlog,
  not a gap nobody wrote down.
- `awcms-one`'s commerce-scoped equivalents (its own #249) can migrate onto
  these after its next subtree sync, per the issue's original framing.

## Alternatives considered

- **Leave `window.confirm()`/`window.prompt()` as-is and only port
  `SettingsSaveBar`.** Rejected: the confirm/prompt gap is exactly what
  the issue asks to close, and `docs/awcms/14_ui_ux_design_system.md`
  already commits to WCAG 2.2 AA, which the OS-native dialogs do not meet.
- **A generic `ReasonPanel` that also carries the confirm step (no separate
  `ConfirmDialog`)**, since every `ReasonPanel` opener is implicitly a
  confirmation too. Rejected: most `window.confirm()` sites need no reason
  at all (e.g. "Delete this term? This cannot be undone."), so folding
  `ConfirmDialog` into `ReasonPanel` would force an unwanted text field onto
  the majority of call sites.
- **One shared `<dialog>` for both confirm and reason**, toggling the
  textarea's visibility. Rejected: `role="alertdialog"` (a yes/no
  interruption) and the reason panel's own required-field/counter/max-length
  machinery are different enough contracts that merging them would make
  both harder to reason about for a marginal markup saving.
