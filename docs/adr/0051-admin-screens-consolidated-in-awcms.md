🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0051-admin-screens-consolidated-in-awcms.id.md)

# ADR-0051 — Every admin screen (tenant as well as owner/internal) is built in `awcms`

- **Status:** Accepted (narrowed by [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md))
- **Date:** 2026-08-01
- **Decision-maker:** @ahliweb
- **Supersedes:** [ADR-0048](0048-frontend-role-split-awcms-astro-internal-admin.md) (the frontend role split where `awcms-astro` = owner/internal admin)
- **Related:** [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md) (`awcms` system of record, `awcms-astro` experience layer + BFF), [ADR-0046](0046-idn-admin-regions-module-admission.md) (the `idn_admin_regions` module), [ADR-0047](0047-mini-micro-frozen-foundation-built-here.md) (freezing mini/micro), [ADR-0049](0049-machine-credentials-and-session-introspection.md) & [ADR-0050](0050-bff-session-handoff-code.md) (the contracts that used to block internal screens)

> **Narrowed by [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md) (8 August 2026).**
> The phrase "every admin screen" in §Decision is read as **"every SYSTEM admin
> screen"**: the **USER** admin surface — the screens a person uses to do their
> own part of one site — may live in `awcms-astro` when that site declares it,
> with the `owner` role **rejected by a gate** over there. The core decision and
> **all three replacement gates in §Decision are not loosened one bit**. The
> wording is deliberately not rewritten, per Rule 2 of the ADR index (an ADR is
> annotated, not rewritten).

## Context

ADR-0048 split the frontend by audience: **owner/internal** screens (global master data, data release/rollback, cross-tenant health) were to be built in `awcms-astro`; screens where a **tenant works on its own data** stayed in `awcms`. Three months in, that rule has produced three facts the ADR did not anticipate.

**First, the rule was never followed by the code that already existed.** ADR-0048 §"What is NOT decided" admits it itself: `/admin/*` today mixes tenant and platform (`/admin/modules`, `/admin/security`, `/admin/sidebar-menu` are all platform-ish), and sorting that out was deferred to "separate work with its own ADR" that never started. So the rule binds only **new** screens — creating two classes of screen distinguished not by their nature but by their date of birth.

**Second, the immediate cost is modules with no screens at all.** The admin surface audit (2026-08-01) found **13 of 21 modules have not a single screen** — 125 admin route files usable only through `curl`. `idn_admin_regions` is the case ADR-0048 used as its primary example, and the result is that the module landed with no `navigation` and no date: its screens wait on another repo that does not have a single admin screen yet.

**Third — and this is what changes the substance — moving a screen was never the security control it was claimed to be.** ADR-0048 moved the dataset activation _screen_ to another repo because the action "replaces the data served to all tenants at once". But its _permission_ stayed put:

```sql
-- sql/081_awcms_idn_admin_regions_permissions.sql
('idn_admin_regions', 'dataset', 'configure', 'Activate a validated … dataset version'),
('idn_admin_regions', 'dataset', 'restore',   'Roll back to the previously active … dataset version'),
```

Both are in the **global** ABAC catalogue, and `POST /api/v1/setup/initialize` grants the entire catalogue to the `owner` role of every new tenant (owner = 197/197 permissions). Which means **the owner of an ordinary tenant today holds the permission to replace the dataset served to every tenant** — precisely the risk ADR-0048 wanted to prevent — and the endpoint (`POST /api/v1/idn-regions/datasets/{id}/activate`) accepts it from wherever it is called, because ABAC evaluates permissions, not the frontend's origin.

ADR-0048 §"What makes this split safe" actually stated this without drawing the conclusion: _"Moving a screen to another repo does **not** move its permission."_ Correct — and therefore moving a screen does not move its risk either. What holds back a cross-tenant action is the authorization gate, not the repo address where the button is drawn.

Finally, ADR-0048's technical deferral reason has lapsed: the two contracts it called "still blocked" — the tenant header and a credential a build can hold — were decided in [ADR-0049](0049-machine-credentials-and-session-introspection.md) and [ADR-0050](0050-bff-session-handoff-code.md). So this decision is taken as a design choice, not because the ADR-0048 path is blocked.

## Decision

We decide that **every AWCMS admin screen — tenant as well as owner/internal/platform — is built in the `awcms` repo**, under `/admin/*`, using one admin shell, one session, one registry-driven sidebar, and one CSP posture.

ADR-0048 is **superseded**. The role of `awcms-astro` established by [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md) is **unchanged**: it remains the experience layer + the only BFF for the public/Jualanku surface, and it still never touches the `awcms` PostgreSQL directly. What is revoked is only its role as the home of internal admin screens.

### The replacement gates that must exist (this is the part that must not be skipped)

Because the repo is no longer the audience boundary, the boundary must be stated where it is actually enforced:

1. **An action whose effect crosses the tenant boundary must have a platform-scoped gate in `awcms`**, not just tenant RBAC. A permission seeded to every tenant's `owner` role **must not** be enough to run it.
2. **A cross-tenant action must not be in the catalogue seeded to tenant roles.** If an action changes the data served to other tenants, its permission is not a tenant permission.
3. **Platform-scoped screens are still subject to that gate**, and the `requiredPermission` on their `navigation` entry must be that platform permission — so an ordinary tenant owner does not see the menu and, more importantly, is still rejected by the endpoint if they guess the URL.

Points 1–3 apply to `idn_admin_regions.dataset.configure`/`.restore` **today** and are a precondition before its dataset screens are built. This is recorded as an open finding, not as a part this ADR has already completed.

## Consequences

- **Positive:**
  - One admin shell: one login, one sidebar, one design system, one CSP posture. A platform operator does not have to switch application (and switch session) to manage one system.
  - A module's screens live in the same repo as its `module.ts`, permissions, and migrations — so `tests/admin-navigation-registry.test.ts` can genuinely enforce "every module has screens". Across repos, nothing enforces it.
  - It removes the "waiting on another repo" class of screen: the 13 modules without screens have a clear path to be worked on.
  - Cross-tenant risk moves from a topology assumption to a testable authorization gate.
- **Negative / trade-offs:**
  - The `awcms` `/admin/*` surface now serves two audiences. Without the gates in §Decision, that **lowers** security compared with ADR-0048 — which is why those gates are normative, not advice.
  - `awcms-astro` loses the role ADR-0048 gave it; the BFF work (ADR-0049/0050) is still used for its ADR-0045 role, but part of its motivation is reduced.
  - Heavy internal screens share a performance profile with tenant admin. Acceptable: both are authenticated, never behind the edge cache, and have few users.
- **Neutral:**
  - The `awcms` public surface (`/blog/*`, `robots`/`sitemap`/`feed`, `/search`) is untouched; it remains the only part allowed behind the edge cache (ADR-0042).
  - The old ADR-0048 rule stays relevant as a historical note for understanding why `idn_admin_regions` landed without `navigation`.

## Alternatives considered

- **Keep ADR-0048 as is** — rejected. It binds only new screens, leaves the old `/admin/*` mixed, and (as proven above) does not hold back the cross-tenant risk that was its main reason. Keeping it means accepting 13 modules without screens in exchange for a guarantee it does not deliver.
- **Keep ADR-0048 and immediately build the first internal screens in `awcms-astro`** — rejected for now. It is technically possible (ADR-0049/0050 close the blockers), but the cost is a second admin shell complete with its own session, navigation, design system, and CI gates, before a single one of the 13 modules without screens is served.
- **Split by permission alone, without changing ADR-0048** — rejected as a _decision_, but **adopted as a mechanism**: the platform-scoped gates in §Decision are exactly that. What is rejected is keeping them while still forcing the screens to live in another repo — two boundaries for one risk, one of which enforces nothing.
