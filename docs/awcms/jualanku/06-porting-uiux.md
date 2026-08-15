🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](06-porting-uiux.id.md)

# 06 — Porting the UI/UX and design system

> Plan. See the [README](README.md) for status.

This document sets out **how** the Elementor design is translated. The specification
for the public and portal screens lives in the `awcms-astro` repo; the binding part here
is the **internal admin** screens and the design tokens shared between them.

## 1. Definition of porting

Porting = translating user goals, information hierarchy, visual patterns, copy,
states, and component behaviour from the Elementor prototype into Astro components +
a screen specification.

Porting is **not** copying WordPress DOM, CSS classes, widgets, shortcodes, plugins, or the
data model. Not a single line of WordPress markup comes across.

| Elementor artifact               | Decision                                                      |
| -------------------------------- | ------------------------------------------------------------- |
| Hero, categories, cards, pricing | Extract design tokens + component contracts                   |
| Manual listing                   | Replace with a projection/taxonomy from `awcms`               |
| WordPress login form             | Replace with `identity_access` via the BFF                    |
| A dashboard that is a long image | Build real routes + HTML components                           |
| Placeholder/lorem ipsum          | REMOVE — never reaches production                             |
| Hard-coded links                 | Route generator from slug + typed routes                      |
| Sensitive demo data              | Not migrated into the production seed                         |
| Benefit-claim copy               | Goes through content review + evidence owner + legal sign-off |

## 2. Migration disposition

| Code       | Meaning                                        | Example                                          |
| ---------- | ---------------------------------------------- | ------------------------------------------------ |
| `PORT`     | Goal and structure are kept                    | Hero, category card                              |
| `REDESIGN` | Goal stays, flow/structure is fixed            | Seller dashboard                                 |
| `DYNAMIC`  | A static component is replaced by `awcms` data | Categories, listings, pricing                    |
| `REMOVE`   | Not worth bringing across                      | Placeholders, internal notes, duplicate sections |
| `DEFER`    | Valuable but not MVP                           | AI recommendations, marketplace checkout         |

A per-route/per-section inventory is produced as its own worksheet before the first
screen is built (P0 action #7 in the validation document). Every row has:
route, section, disposition, data owner, and accessibility notes.

## 3. Design tokens

Jualanku does **not** create a new token system. It uses the AWCMS tokens already
standardised in [`../14_ui_ux_design_system.md`](../14_ui_ux_design_system.md)
(`--color-*`, `--space-*`, `--radius-*`, `--shadow-*`, motion tokens), and
sets their values through the `theming` module per tenant.

The rules that apply:

- Semantic colours are used according to their role; for a solid fill + white text use
  the `-strong` variant (the plain token does not pass AA contrast in some combinations).
- Verification/payout/moderation status **must not** be distinguished by colour alone:
  there is always a text label and/or an icon.
- No one-off styles. New components use existing tokens; a new
  token requires a written justification and a fresh contrast audit.

## 4. Components across surfaces

| UI foundation                   | Public                    | Portal                   | Internal admin                        |
| ------------------------------- | ------------------------- | ------------------------ | ------------------------------------- |
| Button / FormField / StatusPill | CTAs, filters             | Forms & mutations        | Forms & approvals                     |
| Card / Panel                    | Merchants, products       | KPIs, tasks              | Operational summary                   |
| DataTable / Pagination          | Optional (dense listings) | Catalogue, leads         | Merchants, payouts, moderation        |
| Empty / Error / Loading         | Empty directory           | Required on every screen | Required on every screen              |
| Dialog / Drawer / Toast         | Minimal                   | Mobile actions           | High-risk actions (with confirmation) |
| MaskedText / MoneyText          | Public prices             | Bank accounts, invoices  | PII & finance                         |
| Breadcrumb / Nav                | SEO & navigation          | Portal navigation        | Role-aware admin navigation           |

Admin components are built in `awcms` following the existing admin screen patterns
(`src/pages/admin/**`) — including the CSP rule: **no inline scripts**; scripts are
imported and bundled.

## 5. Jualanku internal admin screens

Added in `awcms` as SSR under `/admin/jualanku/**`, and
**registered through the module's `navigation` descriptor** (the admin menu is built from
the registry; a menu entry pointing at a 404 turns the navigation test red).

| Screen                                 | Main content                                         | Special controls                     |
| -------------------------------------- | ---------------------------------------------------- | ------------------------------------ |
| `dashboard`                            | Operational summary, SLA queues                      | —                                    |
| `merchants`                            | List + detail + suspend/restore                      | Reason required, audited             |
| `verifications`                        | Case queue, **masked** evidence, decisions           | Step-up; evidence access is audited  |
| `catalog` / `moderation`               | Problem listings, hold/publish decisions             | Reason required                      |
| `leads`                                | Lead health (aggregate), not conversation contents   | Minimal PII                          |
| `affiliates` / `commissions`           | Profiles, conversions, ledger, reversals             | Reversals need a reason, append-only |
| `payouts`                              | Maker/checker queue                                  | **SoD**; approver ≠ maker            |
| `plans` / `subscriptions` / `invoices` | Plans, entitlements, billing                         | A price change = `configure` + audit |
| `complaints`                           | Consumer complaints + resolution                     | SLA & trail                          |
| `onboarding-operations`                | Assigning a coach, validity period, merchant consent | Time-bounded grants                  |
| `reports` / `risk` / `audit`           | Reports, anomalies, access-decision trail            | PII export = high-risk               |
| `settings`                             | Jualanku module configuration per tenant             | `configure`                          |

Merchants and affiliates have no route, no navigation entry, no role, and no session
audience for any of the screens above.

## 6. Accessibility

Baseline **WCAG 2.2 Level AA** (adopted as ISO/IEC 40500:2025) — up from
the 2.1 AA used by the previous template.

- Every primary function is keyboard-operable, with a visible focus indicator.
- The touch target for the portal's main CTAs is at least 44 CSS px.
- Every form: labels, hints, error association, status announcements, and server-side
  validation (client validation is not a control).
- Status is never colour-only.
- `prefers-reduced-motion` is honoured — decorative animation is **turned off**, not
  sped up.
- Heading hierarchy, landmarks, skip links, table caption/headers, and language
  attributes are tested automatically **and** manually on the critical flows.
- Mobile-first from a width of 360 px.

## 7. Language & content

- UI strings go through the i18n catalogue (`Indonesian` as the product's primary locale),
  not literals in components.
- Numbers, currency, and dates are formatted through the i18n helpers; never
  assemble a currency string by hand.
- Marketing claims, prices, and service promises have an evidence owner and sign-off
  before going live — recorded in the claims register (see
  [07](07-roadmap-gates-kepatuhan.md)).
