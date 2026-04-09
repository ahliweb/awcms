> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Admin UI Architecture

## Purpose

Describe the current admin-shell architecture in `awcms/`: shared layouts, manager patterns, route conventions, dashboard/widget composition, and the current relationship between the admin shell and Worker-backed operational flows.

## Current Admin UI Model

The current admin UI is a React SPA with a shared shell and multiple data-driven runtime layers.

Current core surfaces include:

- shared admin layouts/templates
- `AdminPageLayout` / `PageHeader` style wrappers
- manager screens under `awcms/src/components/dashboard/`
- scope-aware sidebar/menu loading
- dynamic/plugin/extension route composition
- signed route params for protected edit/detail flows

## Current Routing Model

Current route behavior is centered on `awcms/src/components/MainRouter.jsx`.

Important current rules:

- many admin routes use `*` splats so nested tabs/views survive refreshes
- protected edit/detail flows use signed ids where the current route-security model applies
- extension/plugin routes can be composed into the router through current route injection paths

Do not document older query-string-only editing patterns as the current standard.

## Current Shared Layout Model

Current admin pages typically compose around shared wrappers such as:

- `AdminPageLayout`
- `PageHeader`
- shared content/table/form components

The current checked-in shell keeps the existing shared template module path for compatibility, but its visual system is EmDash-aligned rather than the older Flowbite-branded presentation.

These provide the current consistent shell behavior for permission-gated manager screens.

## Current Manager Pattern

Current admin managers typically follow one of two patterns:

- a generic-content style manager built on shared CRUD/table primitives
- a custom manager for more specialized workflows

Current important rules:

- permission gating belongs at the route/page level and inside components where finer control is needed
- tenant scope should remain explicit in data hooks and mutations
- toasts should be used for meaningful action feedback

## Current Menu And Dashboard Composition

The admin shell is not hardcoded around a single static sidebar.

Current composition model includes:

- menu loading through `useAdminMenu()`
- resource and extension menu integration
- dashboard widget composition through current hook/filter/widget patterns

Current dashboard/widget rule:

- widget metadata should align with the current shared widget/header conventions rather than inventing one-off dashboard cards everywhere

## Current Worker / Operational Flow Note

Admin UI surfaces that trigger privileged operational actions should use the maintained Worker-backed flow.

Current practical meaning:

- documented operational calls should point at the Worker compatibility/runtime path
- admin clients should not be described as directly calling Supabase-hosted function URLs as the maintained runtime

## Current Route Security Guidance

For protected edit/detail flows:

- generate signed route params using the current route-security helpers
- decode signed params with the current secure-route hooks/context
- prefer path-based sub-slug routing over fragile query-string-only tabs/views

## Current Permission Guidance

- use `requiredPermission` for route/page gating where the current shell expects it
- use `usePermissions()` for finer UI control
- keep canonical permission names aligned with ABAC docs and migration-backed families

## Current Sidebar Guidance

- sidebar behavior is data-driven
- menu items are enriched and normalized through the current menu system
- resource metadata and permission prefixes influence visibility and behavior

Treat sidebar changes as a menu-system change, not just a JSX/sidebar file edit.

## Current UI Guardrails

- admin code stays JavaScript ES2022+
- use semantic theme variables, not hardcoded hex values
- keep tenant scoping explicit in data operations
- keep signed-route and permission patterns aligned with the current shell conventions

## Validation Guidance

| Surface | Validation |
| --- | --- |
| admin shell/manager changes | `cd awcms && npm run build` |
| Worker-backed operational/admin route implications | `cd awcms-edge && npm test && npm run typecheck` when relevant |
| maintained docs | `cd awcms && npm run docs:check` |

## Related Docs

- [docs/modules/COMPONENT_GUIDE.md](./COMPONENT_GUIDE.md)
- [docs/dev/admin.md](../dev/admin.md)
- [docs/modules/MENU_SYSTEM.md](./MENU_SYSTEM.md)
- [docs/security/abac.md](../security/abac.md)
