---
"awcms": minor
---

Add `/admin/theming` — the console for the theme lifecycle the `theming`
endpoints have been serving since ADR-0034 Fase 3 with no screen at all.

Draft, validate, preview, publish, rollback and retire were fully implemented,
ABAC-gated, idempotency-keyed and audited, yet reachable only by hand-writing
`curl`, and the module declared no `navigation` — so it was also invisible in the
sidebar. The screen and the navigation entry land together: an entry without a
page is a permanent 404 in the menu, and a page no descriptor claims can never
appear in it.

**The draft editor is generated from the theme descriptor, not hand-written.**
`ThemeDescriptor` bounds the configurable surface completely, so the form renders
one control per declared token (typed by `token.kind` — `<select>` for
`font_family`, a numeric input for `number`, text for colour/dimension), one
`<select>` per slot restricted to that slot's own variants, one field per
declared asset slot, plus section order and nav placement. A JSON textarea would
have been the honest fallback for an open-ended config and is not needed here.
Colour tokens stay text inputs on purpose: `<input type="color">` normalises
every value to hex and would silently rewrite a stored `rgb()`/`hsl()` value that
`validateColorValue` accepts. Because each theme declares its own tokens, the
theme picker navigates to `?theme=<key>` and the server re-renders that
descriptor's field set rather than merging a superset.

**The gates reuse the endpoints' exact permission keys**, which is harder than it
looks here because the screen's verbs and the seeded actions disagree: the button
says "Roll back" and the permission is `theming.version.restore`; the button says
"Retire" and the permission is `theming.version.archive`. Inventing the tidier
`version.rollback`/`version.retire` that no migration seeds would hide those
controls from everyone including the owner — the latent-authz bug this repo has
already shipped twice. `tests/admin-theming-page-contract.test.ts` extracts the
guard triples from the seven route sources and the `permissionKey(...)` triples
from the page, and requires the page's set to be a subset of both what the routes
enforce and what the descriptor declares. Mutation-proven: `version.rollback` and
`config.publish` each turn two tests red.

**Draft-save, publish, rollback and retire each mint a fresh `Idempotency-Key`
per click; validate sends none.** A reused key replays the stored response
instead of acting, so a deliberate second publish would silently do nothing;
validate writes nothing and requires no key, and the test pins both halves.

**Preview shows its result instead of reloading it away.** The raw preview token
is returned exactly once, so that one action reads the response body through a
small page-local helper rather than the shared `sendJson`, whose narrow
`{ ok, errorCode }` return is a deliberate guard for the dozen other call sites.
The returned URL is accepted only when it is in the documented
`/theming/preview/` namespace, so an unexpected body can never become an
arbitrary link. Every mutation on the page still goes through `sendJson`.

The responsive-preview dashboard (side-by-side breakpoint rendering) remains a
documented follow-up.
