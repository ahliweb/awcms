---
"awcms": patch
---

fix(admin-ui): 125 classes the admin uses had no CSS at all — `/admin/account` was shipping raw browser controls

Found by looking at the running admin rather than at the code. `/admin/account`
renders as an unstyled document in production: labels butted against inputs,
default `<select>` chrome, default buttons, no cards, no spacing. It is not a
design shortfall — the stylesheet never contained the classes the templates use.

## The measurement

234 distinct classes appear in `src/pages/admin/**` and `src/layouts/**`.
**150 had no rule anywhere in `src/styles/`**, and 125 of those are visual
rather than behaviour hooks:

| Vocabulary | Screens | Rules before |
| --- | --- | --- |
| `.admin-form` | 13 | 0 |
| `.btn-primary` / `.btn-secondary` / `.btn-danger` / `.btn-small` | 6 | 0 |
| `.admin-table` / `.table-scroll` | 4 | 0 |
| whole dashboard (`.kpi*`, `.dashboard-*`, `.card-header`, `.row`, `.num`) | 1 | 0 |
| `.admin-card` / `.admin-field` / `.admin-actions` / `.admin-note` / `.admin-empty` / `.admin-error` | `/admin/account` + settings screens | 0 |

The admin grew **two** class vocabularies. `.admin-create-form` (18 rules) and
`.data-table` (33 rules) are the styled one; a later wave — ADR-0096's
`/admin/account`, then thirteen settings forms and the dashboard — reached for
`.admin-card` / `.admin-form` / `.kpi` / `.btn-primary` instead, and nothing
ever defined them. The dashboard is the landing page of the whole admin.

**`.visually-hidden` was undefined while `.sr-only` exists**, so `users.astro`
rendered its screen-reader-only text *visibly*. That one is an accessibility
defect, not a cosmetic one — an undefined a11y utility fails loudly in the
wrong direction. It is now an alias of the same rule rather than a second
implementation, because two that drift is how one of them stops clipping.

## Where the rules live, and why it is not `admin-screens.css`

`AdminLayout` always loads `admin.css`; `admin-screens.css` is a per-screen
import — and `/admin/account` never added it. That is exactly how a vocabulary
goes missing for a whole wave of screens, so the new rules go where the layout
guarantees them and the next page cannot forget them.

Every value is a token, and the control metrics match `.admin-create-form`
(44px touch target, `--radius-sm`, `focus-visible` border) so the two
vocabularies read as one product rather than two eras of it. Solid fills use the
`-strong` tokens, which `tokens.css` documents at length as the ones that hold
4.5:1 with white text — the plain tokens are tuned for text and border use.

`display:` on the message boxes is safe only because `tokens.css` carries a
global `[hidden] { display: none !important }`. Without it this block would pin
twelve error boxes permanently open, which is the defect this repo already
recorded when `.auth-form { display: flex }` made `form.hidden` inert on four
auth pages. The comment says so at the rule.

## The budget

`PER_FILE_BUDGET_BYTES` goes 21,000 → 27,000, and the reasoning is rewritten
rather than the number nudged. That rule's stated premise — quoted in its own
failure message — is that "a single file this size usually means an island
bundled a dependency". `admin.css` is the admin's shared stylesheet, parsed once
and cached across every screen; splitting it to satisfy the old number would
cost a request on every admin page and save nothing, improving the metric while
making the thing it protects slightly worse.

**`TOTAL_BUDGET_BYTES` is deliberately NOT raised.** The ceiling that bounds
what a reader actually downloads still binds at 180,000 B — and the build now
sits at **178,925 B, 99.4% of it**. The next addition to `dist/client` will
fail this gate, which is the correct outcome: that conversation should happen,
not be pre-empted here.
