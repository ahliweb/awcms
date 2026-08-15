🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0048-frontend-role-split-awcms-astro-internal-admin.id.md)

# ADR-0048 — Frontend role split: `awcms-astro` = OWNER/INTERNAL admin, `awcms` = PUBLIC frontend + PUBLIC admin

- **Status:** Superseded by [ADR-0051](0051-admin-screens-consolidated-in-awcms.md)
- **Date:** 2026-07-31
- **Decision maker:** @ahliweb
- **Complements:** [ADR-0047](0047-mini-micro-frozen-foundation-built-here.md) (freezing `awcms-mini`/`awcms-micro`; the two repos under development are this one and `awcms-astro`)
- **Corrects a premise:** ADR-0047 §Alternatives rejected "build machine credentials in `awcms-astro`" on the grounds that that repo is a "static public site with no database and no identity store". The reasoning still holds for **credentials**, but the description of its role is no longer complete: this ADR gives `awcms-astro` an explicit second role.
- **Related:** [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md) (`awcms` system of record, `awcms-astro` experience layer + the only BFF), [ADR-0042](0042-varnish-edge-cache-auto-activation.md) (edge cache), ADR-0034/0035 (family governance & positioning).

## Context

ADR-0047 concentrated development on two repos, but did not state **which screens belong to whom**. That vacuum was felt immediately: this repo already carries public routes (`/blog/{tenantCode}/*`, `robots`/`sitemap`/`feed`, `/search`) **and** `/admin/*`, while `awcms-astro` stands as the experience layer + BFF (ADR-0045) with no written boundary about admin.

Without that line, the next admin screen lands in whichever repo happens to be closest to the author's hand — and that choice is hard to reverse once it has users.

The concrete example that forces this decision to be made now, not later: the `idn_admin_regions` module ([ADR-0046](0046-idn-admin-regions-module-admission.md)) ships an action for **activating/rolling back a version of the region dataset** — replacing the data served to **all tenants at once**. That is not a tenant screen; that is a platform-operator screen. The module deliberately landed **without** `navigation` because this question had no written answer yet.

## Decision

| Repo          | Frontend role                               | Audience                                 |
| ------------- | ------------------------------------------- | ---------------------------------------- |
| `awcms-astro` | **OWNER / INTERNAL admin pages**            | platform operators, internal staff       |
| `awcms`       | **PUBLIC frontend + PUBLIC ADMIN frontend** | site visitors, and a tenant's own admins |

Operationally:

- Screens that administer the **platform** — global master data, data release/rollback operations, cross-tenant health, internal tooling — are built in **`awcms-astro`**.
- Screens used by a **tenant over its own data** (content, comments, media, domains, tenant users) stay in **`awcms`**, alongside its public routes.
- `awcms` remains the **system of record**. `awcms-astro` has no database of its own and never touches the `awcms` PostgreSQL directly — it calls `/api/v1/*` through its BFF (ADR-0045).

### What makes this split safe, not merely tidy

1. **The authorization surface stays ONE.** Moving a screen to another repo does **not** move its permission: every call still passes through `awcms`'s session + tenant context + RBAC/ABAC default-deny. The internal frontend must not become a second, looser path — if an action needs a permission, it needs that permission from wherever it is called.
2. **Credentials do not move into the browser.** A direct consequence of ADR-0045: the internal browser talks to the `awcms-astro` BFF, and the BFF is what holds the session/token to `awcms`. This is also why ADR-0047's rejection still holds — `awcms-astro` is not an identity issuer, it is a consumer.
3. **Cache is not shared across audiences.** The public `awcms` site may sit behind an edge cache (ADR-0042, off by default). Admin surfaces — tenant or internal — are **never** inside it: a shared cache in front of a multi-tenant surface is a cross-tenant leak machine.
4. **Performance is paid for in the right place.** Internal screens may be heavy and interactive because their users are few and authenticated; the public surface is optimised for anonymous visitors. Merging the two forces one performance profile to serve two opposing needs.

### What is NOT decided here

- **Splitting up the existing `/admin/*`.** Today's admin screens mix tenant and platform (e.g. `/admin/modules`, `/admin/security`). Moving them is a separate piece of work with its own ADR. This rule binds **new** screens, and is the reference when old screens are touched.
- **The shape of internal authentication in `awcms-astro`.** ADR-0047 recorded two contracts still unresolved (the tenant header, and credentials a build can hold); both must be settled before the first internal screen can call `awcms`. This ADR fixes **where** that screen lives, not how it logs in.

## Consequences

**Positive**

- "Where should this screen go?" has a written answer before the code is written, including for the region-dataset screen currently waiting.
- `awcms` remains the single source of truth for data and permissions, whatever the frontend.
- The public surface and the internal surface can each be optimised (and cached) according to their own needs without compromise.

**Negative / accepted costs**

- Two active repos mean one cross-repo API contract that has to be kept in sync. That is a real burden — and the reason `awcms-astro` must call `/api/v1` instead of growing its own data path.
- Some internal screens will feel "far" from their code (the action in `awcms`, the view in `awcms-astro`). That cost is accepted because the alternative — platform admin living inside the tenant application — is far more expensive to separate later.
- `awcms-astro`, previously purely static, now carries an authenticated surface. Every addition there must be assessed as a security surface, not merely as a page.
