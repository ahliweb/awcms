---
"awcms": patch
---

docs(ui,i18n): the design system and four skills described systems that were never built

Bringing the documentation in line with the ADR-0120 redesign turned up a
larger problem in the same files: three separate capabilities were documented
as plans that had in fact shipped, or as shipped things that had in fact been
deleted. Prose that is confidently wrong is worse than prose that is missing,
because an agent following it writes code against names that do not exist.

**The i18n section and the `awcms-i18n` skill described a pipeline that was
designed and then built differently.** Both said i18n was "not yet implemented
in this repo" and named an `i18n/` directory, a `messages.pot` template,
`bun run i18n:extract`, `i18n:pot:check`, `i18n:parity:check`,
`scripts/i18n-extract.ts`, `src/lib/i18n/translate.ts`,
`src/lib/i18n/locale.ts` and `src/lib/i18n/error-messages.ts` — none of which
exist. What ADR-0095 shipped is `locales/{en,id}.po`, hand-maintained, compiled
by `i18n:compile`, verified by `i18n:catalog:check` and `i18n:screens:check`,
with the **English sentence as the msgid** rather than a `namespace.key`, and
with plurals implemented rather than deferred. Both are rewritten against the
code, and the skill carries a note saying what it used to claim.

**Seven skills and doc 14 told callers to use `postJson`**, which was deleted
on 22 August 2026 (PROJECT_STATE D12 — it had zero callers and a docblock
claiming otherwise). Doc 14 also named `submitJson`/`showBanner`, which never
existed here. The fix is not a better list of names: every one of these now
says to run `grep -n "^export" src/lib/ui/admin-form-client.ts` first, and the
real surface (`onSubmit`/`onAction`/`mutateAndReload`/`messageBox` and friends)
is written down where the invented one used to be.

**The mobile drawer has no JavaScript.** Doc 14 and `awcms-ui-screen` both
described an `aria-expanded` toggle, a hand-written focus trap, `inert` on the
rest of the page, and `Esc`-to-close, and pointed readers at `<script>`
comments in `AdminLayout.astro`. It is a CSS-only checkbox drawer and that
script does not exist. The docs now say so, and say plainly what it costs: no
`Esc`, no focus trap — acceptable for a nav drawer whose links stay reachable,
and explicitly not a licence to build an input-taking modal the same way.

Also brought current for ADR-0120: the admin shell diagram and the rule that
the shell owns the page title; the split-panel auth screen across all five
public auth pages; the three-role colour split and WCAG 1.4.11 in
§Accessibility, with `design:token-contrast:check` named as the thing that
proves it; the 44px → 38px control height as a stated trade rather than a
regression to be "fixed"; the live `navigation[].icon` field in
`awcms-module-management`; and, in `awcms-browser-test`, the two harness traps
that produced confidently wrong passes during this work — Playwright's
`viewport` (not `viewportSize`), and pointing a browser at a built server
rather than `astro dev`, whose CSS arrives as a module script the CSP blocks.
