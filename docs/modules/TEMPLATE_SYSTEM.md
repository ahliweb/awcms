> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Template System

## Purpose

Explain the current template/composition system in AWCMS: templates, template parts, assignments, widgets, template strings, reusable section overlap, and the current relationship between admin editing and public rendering.

## Current Template Model

The current template system is broader than a simple page-layout table.

Current composition surfaces include:

- `templates`
- `template_parts`
- `template_assignments`
- `widgets`
- `template_strings`
- reusable sections and site-blueprint-adjacent composition flows

Current important rule:

- these surfaces are tenant-aware and participate in the current visual-builder/composition model rather than living as isolated static records

## Current Data Model

Representative current table families:

- `templates` for full layout records
- `template_parts` for reusable layout parts
- `template_assignments` for route/channel-to-template mapping
- `widgets` for widget-area instances
- `template_strings` for localized template-driven strings

All of these participate in the current tenant-scoped admin/runtime model.

## Current Admin Model

Current admin template behavior spans multiple surfaces:

- `/cmspanel/templates`
- `/cmspanel/visual-editor/template/:id/*`
- `/cmspanel/visual-editor/part/:id/*`
- `/cmspanel/widgets`
- reusable-section and blueprint-related composition tooling where applicable

Current route note:

- template and part edit routes follow the current signed-route-param pattern

## Current Hook / Data Access Model

`awcms/src/hooks/useTemplates.js` is a current core hook for template-related admin data.

Current behavior includes:

- tenant-scoped fetches for templates, parts, assignments, and template strings
- soft-delete filtering for template and part reads
- upsert-style assignment updates keyed by tenant/channel/route type
- CRUD helpers for templates, parts, assignments, and strings

This means the template system should be thought of as a coordinated admin data surface, not a one-off editor table.

## Current Channel Model

Current assignments support multiple channels in the admin data model.

Current practical rule:

- channel-aware assignments may exist for `web`, `mobile`, `esp32`, and related surfaces
- only the `web` channel participates in the current Astro public rendering path

## Current Public Rendering Model

Public rendering still works through a composition flow similar to:

1. resolve the relevant page/content/context
2. resolve the current `web` template assignment
3. combine template/part/widget composition data
4. render through the current public render-only component path

Current important rules:

- public rendering remains render-only
- unknown blocks/components must not render outside the allow-list/registry model
- public rendering must stay tenant-scoped, published-only where applicable, and non-deleted

## Current Template Extension / Registration Model

The current template system also interacts with extension-driven composition through helpers such as:

- `registerTemplateBlock(...)`
- `registerWidgetArea(...)`
- `registerPageType(...)`

Those APIs feed the current visual-builder/public composition pipeline rather than bypassing it.

## Current Assignment Guidance

Assignments are not just arbitrary labels; they map route/page types to concrete templates by tenant and channel.

Current practical implications:

- route type naming should align with the current template/page ownership model
- assignment edits should remain tenant-scoped
- assignment changes may affect public rendering behavior immediately or on the next build/render cycle depending on the consuming surface

## Current Security Notes

- template/part/string/widget data remains tenant-scoped
- template and part edits should preserve current permission gates and route security
- public rendering must remain allow-list-driven and render-only

## Validation Guidance

| Surface | Validation |
| --- | --- |
| admin template/composition changes | `cd awcms && npm run build` |
| public render-path changes | `cd awcms-public/primary && npm run check:astro` |
| edge/public route implications | `cd awcms-edge && npm test && npm run typecheck` when relevant |
| maintained docs | `cd awcms && npm run docs:check` |

## Related Docs

- [docs/modules/VISUAL_BUILDER.md](./VISUAL_BUILDER.md)
- [docs/modules/PUBLIC_PORTAL_ARCHITECTURE.md](./PUBLIC_PORTAL_ARCHITECTURE.md)
- [docs/dev/admin.md](../dev/admin.md)
- [docs/dev/public.md](../dev/public.md)
