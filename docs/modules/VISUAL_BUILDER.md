# Visual Builder

## Purpose

Explain the Visual Page Builder architecture and integration with public rendering.

## Audience

- Admin panel developers
- Public portal developers

## Prerequisites

- `docs/modules/TEMPLATE_SYSTEM.md`
- `docs/security/abac.md`

## Core Concepts

- Admin uses `@puckeditor/puck` editor to build layouts.
- Output is stored in `puck_layout_jsonb`.
- Public portal renders JSON via `PuckRenderer` with an allow-list registry.

## How It Works

### Admin Components

- `awcms/src/components/dashboard/VisualPagesManager.jsx`
- `awcms/src/components/visual-builder/VisualPageBuilder.jsx`
- `awcms/src/components/visual-builder/config.js`

### Public Rendering

- `awcms-public/primary/src/components/PuckRenderer.tsx`
- `awcms-public/primary/src/components/registry.tsx`

## Implementation Patterns

### Registering Blocks

```javascript
import { registerTemplateBlock } from '@/lib/templateExtensions';

registerTemplateBlock({
  type: 'my_plugin/chart',
  label: 'Interactive Chart',
  render: ChartComponent,
  fields: { data: { type: 'object' } }
});
```

## Permissions and Access

Current UI checks include:

- Menu access: `tenant.page.read`
- Visual list: `tenant.visual_pages.read`
- Edit/publish: `checkAccess('edit', 'pages', page)` and `checkAccess('publish', 'pages', page)`

Refer to `docs/security/abac.md` for key conventions.

## Security and Compliance Notes

- Public portal must never load the Puck editor runtime.
- Unknown blocks are ignored by the registry allow-list.

## Operational Concerns

- Ensure templates and parts are assigned for the `web` channel.

## References

- `docs/modules/TEMPLATE_SYSTEM.md`
- `docs/modules/PUBLIC_PORTAL_ARCHITECTURE.md`
