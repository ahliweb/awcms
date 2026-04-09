> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Visual Builder

## Purpose

Explain the current visual-builder architecture in AWCMS: admin editing with Puck, template/page/part modes, reusable section composition, template-owned public rendering, and the current route/permission model around visual content editing.

## Current Visual Builder Model

The current visual-builder system is broader than a single page editor.

Current concepts include:

- page visual editing
- template editing
- template-part editing
- reusable sections
- site blueprints and template composition primitives
- public render-only Puck output

## Current Storage Model

- visual content is stored as Puck JSON/layout data
- public output is render-only
- blog presentation is currently owned by template/page composition patterns rather than direct Puck editing on `blogs` rows

## Current Admin Surfaces

Current important admin files include:

- `awcms/src/components/dashboard/VisualPagesManager.jsx`
- `awcms/src/components/visual-builder/VisualPageBuilder.jsx`
- visual-builder config/block files under `awcms/src/components/visual-builder/`

Current composition-related helper surfaces also include reusable-section and template-assignment behavior around the visual-builder flow.

## Current Route Model

Important current routes include:

- `/cmspanel/visual-pages`
- `/cmspanel/visual-editor/:mode/:id/*`

Current route notes:

- `:mode` currently distinguishes template/part/page editing contexts
- `:id` follows current signed route-param behavior
- visual-editor routes support sub-slugs for refresh-safe editor views/modes

## Current Public Rendering Model

- public portals use the render-only Puck path
- public portals must never load the Puck editor runtime
- unknown blocks should not render outside the current allow-list/registry-driven path

Current important public surfaces include public Puck/render components and widget renderers in `awcms-public/primary`.

## Current Composition APIs

Visual-builder/runtime composition still relies on current registration and hook patterns such as template block registration.

Example:

```javascript
import { registerTemplateBlock } from '@/lib/templateExtensions';

registerTemplateBlock({
  type: 'my_plugin/chart',
  label: 'Interactive Chart',
  render: ChartComponent,
  fields: { data: { type: 'object' } },
});
```

Current important rule:

- extension/composition blocks should enter through the current template extension APIs and allow-list-driven render path

## Current Permission Model

Visual-builder access currently depends on the current page/theme/template permission model rather than a single isolated permission family.

Current practical expectations:

- list/editor access must still align with the active admin route/menu/manager permission gates
- template/part editing currently intersects with theme/template-update capabilities
- publish/edit behavior should continue to respect the current page-oriented access checks

## Current Reusable Sections And Templates Note

The visual-builder system now overlaps more directly with:

- reusable sections
- site blueprints
- template parts
- template assignments

This means the visual-builder doc should be read together with template-system and public-architecture docs instead of treated as an isolated editor feature.

## Current Security Notes

- public portal must never ship the editor runtime
- unknown/unregistered blocks must remain ignored or blocked by the current render registry
- visual-builder edits should preserve tenant scope and current permission checks

## Current Operator Notes

Current template/page composition guidance still includes distinctions such as:

- page-oriented templates for standard page records
- post-oriented templates for blog presentation inside the page-owned visual system
- starter layouts for template types where the current editor flow provides them

Treat these as current composition conventions, not arbitrary editor choices.

## Validation Guidance

| Surface | Validation |
| --- | --- |
| admin visual-builder changes | `cd awcms && npm run build` |
| public render-path changes | `cd awcms-public/primary && npm run check:astro` |
| edge/public route implications | `cd awcms-edge && npm test && npm run typecheck` when relevant |
| maintained docs | `cd awcms && npm run docs:check` |

## Related Docs

- [docs/modules/TEMPLATE_SYSTEM.md](./TEMPLATE_SYSTEM.md)
- [docs/modules/PUBLIC_PORTAL_ARCHITECTURE.md](./PUBLIC_PORTAL_ARCHITECTURE.md)
- [docs/dev/public.md](../dev/public.md)
- [docs/dev/admin.md](../dev/admin.md)
