# AWCMS Extension System

> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

## Purpose

Describe the current extension/platform-module model in AWCMS: platform catalog ownership, tenant activation, runtime composition, route/menu/widget integration, and the current constraints on how extensions may interact with admin, public, and edge surfaces.

## Current Extension Model

AWCMS now uses a normalized extension ownership split.

Current core concepts:

- platform-managed package metadata belongs in `platform_extension_catalog`
- tenant activation/configuration belongs in `tenant_extensions`
- lifecycle actions are auditable
- runtime composition happens through registries, hooks, route metadata, and UI slots rather than direct router mutation everywhere

Current terminology:

- **Plugin** = bundled/core runtime feature living inside the main app
- **Extension** = externally packaged or extension-mode feature following the extension contract

## Current Runtime Ownership Rules

- admin/public extension behavior must fit the maintained Cloudflare Worker + Supabase + R2 architecture
- new extension features must not introduce Supabase Storage dependencies
- new extension features must not introduce Supabase-hosted Edge Function dependencies as the maintained runtime
- documented extension routes and public/admin route contracts should stay aligned with current edge/OpenAPI guidance when relevant

## Current Extension Surfaces

| Surface | Current Role |
| --- | --- |
| `platform_extension_catalog` | platform-owned installable package metadata |
| `tenant_extensions` | tenant-owned activation/configuration state |
| `extension_lifecycle_audit` | lifecycle audit log |
| `awcms/src/plugins/` | bundled/core plugin runtime |
| `awcms-ext/` | external extension workspaces/packages |
| `awcms/src/lib/hooks.js` | actions/filters runtime |
| `awcms/src/lib/templateExtensions.js` | block/widget/page-type composition APIs |

Legacy compatibility tables may still exist, but new production guidance should point at the canonical catalog + tenant activation model first.

## Current Runtime Composition Model

Extensions currently compose into the app through patterns such as:

- hook/filter injection
- admin menu item registration
- admin route registration
- dashboard widget registration
- template block registration
- widget-area registration
- page-type registration

Current important rule:

- prefer composition through registries and hooks instead of ad hoc direct mutations of core runtime structures

## Current Hook Surface

Examples of current extension-oriented hooks include:

- `dashboard_widgets`
- `admin_menu_items`
- `admin_sidebar_menu`
- `admin_routes`
- lifecycle actions around extension loading

Current menu guidance:

- use `admin_menu_items` for base additions
- use `admin_sidebar_menu` for last-mile menu adjustment behavior

## Current Template / Widget Composition APIs

`awcms/src/lib/templateExtensions.js` currently exposes extension-oriented helpers such as:

- `registerTemplateBlock(...)`
- `registerWidgetArea(...)`
- `registerPageType(...)`

These APIs feed current admin/public composition behavior through the existing hook/registry path.

### Current Pattern Example

```javascript
import { registerTemplateBlock } from '@/lib/templateExtensions';

registerTemplateBlock({
  type: 'my_plugin/chart',
  label: 'Interactive Chart',
  render: ChartComponent,
  fields: { data: { type: 'object' } },
});
```

## Current Core Plugin Model

Bundled/core plugin-style features still live inside the main app runtime and are build-time bundled.

Current practical rule:

- bundled/core features should behave like first-party runtime surfaces and follow the same tenancy, ABAC, and route/menu constraints as the rest of the app

## Current External Extension Model

External extension packages still live under `awcms-ext/` and are loaded using the current external path/runtime conventions.

Current important rules:

- `extension.json` is the contract document for external extensions
- external loader behavior depends on the current path/runtime resolution model
- runtime bundle assumptions should match the current loader implementation, not older speculative packaging rules

## Current Route Security Expectations

If an extension contributes admin routes with identifiers, current route-security expectations still apply.

That means extension routes should declare their secure params/secure scope when they accept protected identifiers, and routed components should read decoded params through the current route-security helpers.

## Current Dashboard Widget Expectations

Extension-contributed widgets should align with the current dashboard/widget system rather than inventing separate visual conventions.

Current best practice:

- use the shared widget header conventions
- provide widget metadata (`title`, `icon`, `header`, etc.) in the current expected format

## Current Permission Expectations

- platform extension-management surfaces align to platform-scoped extension permissions
- tenant-visible extension settings/pages should use canonical tenant permission families where appropriate
- extension docs should not invent placeholder permission keys without migration-backed support

## Current Security Notes

- extension runtime should preserve tenant isolation
- extension routes should preserve current auth/permission boundaries
- extension-provided public/admin behavior must respect the maintained runtime boundaries
- legacy compatibility tables may exist, but new contract guidance should prefer canonical extension ownership tables

## Validation Guidance

| Surface | Validation |
| --- | --- |
| admin/extension runtime changes | `cd awcms && npm run build` |
| edge/public route implications | `cd awcms-edge && npm test && npm run typecheck` when relevant |
| maintained docs | `cd awcms && npm run docs:check` |
| documented route metadata changes | `cd awcms-edge && npm run openapi:build && npm run openapi:validate && npm run openapi:diff` when relevant |

## Related Docs

- [docs/extensions/EXTENSION_SPEC.md](../extensions/EXTENSION_SPEC.md)
- [docs/extensions/EXTENSION_AUTHORING_GUIDE.md](../extensions/EXTENSION_AUTHORING_GUIDE.md)
- [docs/modules/MODULES_GUIDE.md](./MODULES_GUIDE.md)
- [docs/dev/edge-functions.md](../dev/edge-functions.md)
