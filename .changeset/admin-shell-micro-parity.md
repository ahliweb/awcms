---
"awcms": minor
---

Bring the admin shell to structural parity with awcms-micro's admin pages.

**Admin shell (`src/layouts/AdminLayout.astro`)** — adopted from awcms-micro's `AdminLayout.astro`:

- `.admin-shell` column wrapper + sticky topbar. The layout row's hardcoded `min-height: calc(100vh - 57px)` (a measured topbar height) is replaced by `flex: 1`, so added topbar chrome can no longer desync it.
- **`TenantBadge`** (`src/components/TenantBadge.astro`) names the active tenant in the topbar. Rendered as a plain non-interactive badge, never a `<select disabled>` — awcms scopes an identity to exactly one tenant, so there is nothing to switch to, and a disabled control would advertise a capability with no server-side enforcement behind it. `availableTenants` is kept as the seam for a real, server-computed switcher later.
- **`ThemeToggle`** (`src/components/ThemeToggle.astro`) cycles system → light → dark, persists to `localStorage["awcms_theme"]`, and follows the OS while in system mode. awcms already shipped `:root[data-theme="dark"]` tokens with nothing to set the attribute — dark mode existed but was unreachable. This closes the dark-mode follow-up noted in PR #215.
- **`SyncIndicator`** (`src/components/SyncIndicator.astro`) — dot + label driven by the real `fetchSyncIndicatorActive`, a bounded `EXISTS` over `awcms_sync_nodes` rather than the full sync-health aggregation. It shares ONE transaction with the tenant-name lookup, so the whole topbar costs a single round trip per `/admin/*` render.
- **`LocaleBadge`** (`src/components/LocaleBadge.astro`) fills micro's `LanguageSwitcher` slot. awcms has no gettext catalog, so a `<select>` with one option would be a control that cannot do anything; the badge states the served language without pretending to offer a choice.
- **Avatar + roles + log-out cluster** in the topbar. The avatar is a plain tile, not a link — micro's points at `/admin/profile`, which awcms does not have.
- **Two-level sidebar** (section heading → owning module → links: General; Identity → Profile Identity / Identity & Access; System → Tenant Admin / Tenant Domain / Module Management / Email; Operations → Visitor Analytics) replacing one flat list, with the app version pinned to the footer. Grouping is presentation only — every route still runs its own ABAC guard, and a visible link grants nothing.
- **Breadcrumb** above the page slot.

**Dashboard (`src/pages/admin/index.astro`) — rebuilt, and not only cosmetically.** It previously rendered `Astro.locals.ssrContext` alone (tenant id, role count, permission count) plus quick links, with no database read at all — a page about your SESSION rather than your TENANT. It now renders the same four reports awcms-micro's dashboard does, every one of which already existed in this repo's `reporting` module and had simply never been surfaced in the UI:

- Accent-barred KPI tiles: active users, active offices, allow-decisions in the window, and active/total sync nodes with a "Needs attention" badge when sync is unhealthy.
- Detail cards for Tenant Activity, Access & Audit, and Sync Health, with alert styling on non-zero denies, open conflicts, and failed objects.
- A Module Usage table (18 rows against a fresh tenant).

Reads are gated on `reporting.dashboard.read`, so "you may not see this" stays distinguishable from "there is nothing here", and a report failure degrades to a notice rather than 500-ing the first page every admin lands on. The session cards remain below as the fallback view, preserving the `#admin-dashboard-heading` / `#dashboard-tenant-id` hooks asserted by `tests/e2e/admin-offices.e2e.ts`.

**CSP change — `script-src` is now unconditional.** The theme-init script must run synchronously in `<head>` or the shell flashes the wrong theme, which a deferred Astro-bundled module cannot do. It is therefore the one `is:inline` script in this repo, admitted by SHA-256 (`src/lib/security/theme-init-script.ts`), not by `'unsafe-inline'` — a hash authorises one exact byte sequence. `script-src 'self' '<hash>'` is now always emitted instead of appearing only for Turnstile; the LAN/offline guarantee that no third-party origin appears is unchanged. Verified in a real browser-shaped render, not just by `curl`: the bytes Astro emits hash to exactly the registered value (`tests/theme-init-script.test.ts` fails on drift, since a mismatch is otherwise silent — no error, no log, just a blocked script).

Deliberately NOT ported from awcms-micro, each because the backing capability does not exist here: `LanguageSwitcher` (no gettext catalog), `SyncIndicator` (would add a per-request reporting query), the profile icon (no `/admin/profile` route), the per-tenant sidebar-arrangement subsystem, and micro's JS drawer — awcms's CSS-only checkbox drawer is kept, since it needs no script at all and swapping it for JS would be a regression dressed as parity.

Verified against a real PostgreSQL: all 10 admin screens render 200 through the new shell, and the tenant badge resolves its name from the database with a shape-checked fallback (this repo's `withTenant` *returns* a 503 `Response` on circuit-open rather than throwing, so a bare `rows[0]` would have silently produced `undefined`).
