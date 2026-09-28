---
"awcms": patch
---

fix(control-center): Progres Hermes UX polish — danger button, milestone titles, checkbox sizing (ahliweb/omes#249)

Three fixes to `/admin/omes/progres-hermes`, shipped as read-side/markup/CSS-only changes with no contract change: "Clear configuration" now renders with the existing `.btn-danger` outlined vocabulary instead of the same filled style as "Save" (an `.admin-create-form button.btn-danger` override at matching specificity, since `.admin-create-form button` otherwise wins over the plain `.btn-danger` class), and it already required a `window.confirm` before sending the `DELETE`, unchanged. The issues table's Milestone column now resolves the stored `milestoneNumber` to that milestone's current title (linked to its `htmlUrl` when available) from the same poll's milestones list, falling back to `#<n>` when the number isn't in that list, instead of showing the bare number. "Use a GitHub token" no longer renders as an oversized grey square — `.admin-create-form input`'s blanket text-input box model is reset for `input[type="checkbox"]` to a normal 18px checkbox with its own focus ring and `accent-color`, inline with its label text.

Also fixes a latent bug in `repository-progress-poller.ts`'s `classifyHttpFailure` found while verifying this change: it computed a rate-limit `retryAfterSeconds` from the real wall clock (`Date.now()`) instead of the poller's own injected `now`, unlike every other timestamp in this module — harmless until real time passed the fixture's assumed baseline, at which point `tests/omes-control-repository-progress-poller.test.ts`'s rate-limit test starts failing non-deterministically. `now` is now threaded through `fetchAllPages` the same way the rest of the module already receives it.
