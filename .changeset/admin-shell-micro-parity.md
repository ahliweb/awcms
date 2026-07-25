---
"awcms": minor
---

Bring the admin shell to structural parity with awcms-micro's admin pages.

**Admin shell (`src/layouts/AdminLayout.astro`)** — adopted from awcms-micro's `AdminLayout.astro`:

- `.admin-shell` column wrapper + sticky topbar. The layout row's hardcoded `min-height: calc(100vh - 57px)` (a measured topbar height) is replaced by `flex: 1`, so added topbar chrome can no longer desync it.
- **`TenantBadge`** (`src/components/TenantBadge.astro`) names the active tenant in the topbar. Rendered as a plain non-interactive badge, never a `<select disabled>` — awcms scopes an identity to exactly one tenant, so there is nothing to switch to, and a disabled control would advertise a capability with no server-side enforcement behind it. `availableTenants` is kept as the seam for a real, server-computed switcher later.
- **`ThemeToggle`** (`src/components/ThemeToggle.astro`) cycles system → light → dark, persists to `localStorage["awcms_theme"]`, and follows the OS while in system mode. awcms already shipped `:root[data-theme="dark"]` tokens with nothing to set the attribute — dark mode existed but was unreachable. This closes the dark-mode follow-up noted in PR #215.
- **Grouped sidebar** (Overview / Organization / Access control / Platform / Insights) replacing one flat list, with the app version pinned to the sidebar footer. Grouping is presentation only — every route still runs its own ABAC guard, and a visible link grants nothing.
- **Breadcrumb** above the page slot.

**CSP change — `script-src` is now unconditional.** The theme-init script must run synchronously in `<head>` or the shell flashes the wrong theme, which a deferred Astro-bundled module cannot do. It is therefore the one `is:inline` script in this repo, admitted by SHA-256 (`src/lib/security/theme-init-script.ts`), not by `'unsafe-inline'` — a hash authorises one exact byte sequence. `script-src 'self' '<hash>'` is now always emitted instead of appearing only for Turnstile; the LAN/offline guarantee that no third-party origin appears is unchanged. Verified in a real browser-shaped render, not just by `curl`: the bytes Astro emits hash to exactly the registered value (`tests/theme-init-script.test.ts` fails on drift, since a mismatch is otherwise silent — no error, no log, just a blocked script).

Deliberately NOT ported from awcms-micro, each because the backing capability does not exist here: `LanguageSwitcher` (no gettext catalog), `SyncIndicator` (would add a per-request reporting query), the profile icon (no `/admin/profile` route), the per-tenant sidebar-arrangement subsystem, and micro's JS drawer — awcms's CSS-only checkbox drawer is kept, since it needs no script at all and swapping it for JS would be a regression dressed as parity.

Verified against a real PostgreSQL: all 10 admin screens render 200 through the new shell, and the tenant badge resolves its name from the database with a shape-checked fallback (this repo's `withTenant` *returns* a 503 `Response` on circuit-open rather than throwing, so a bare `rows[0]` would have silently produced `undefined`).
