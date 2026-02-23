> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack) and Section 3 (Modules)

# Visual Builder

## Purpose

Explain the Visual Page Builder architecture and integration with public rendering.

## Audience

- Admin panel developers
- Public portal developers

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for Visual Builder architecture
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- `docs/modules/TEMPLATE_SYSTEM.md`
- `docs/security/abac.md`

## Core Concepts

- Admin uses `@puckeditor/core` editor components to build layouts.
- Output is stored in `puck_layout_jsonb`.
- Public portal renders JSON via `PuckRenderer` with an allow-list registry.
- `editor_type` controls whether public pages render Puck JSON (`visual`) or HTML (`richtext`).

## How It Works

### Admin Components

- `awcms/src/components/dashboard/VisualPagesManager.jsx`
- `awcms/src/components/visual-builder/VisualPageBuilder.jsx`
- `awcms/src/components/visual-builder/config.js`

### Admin Routes

| Route | Purpose | Notes |
| --- | --- | --- |
| `/cmspanel/visual-editor/:mode/:id` | Edit a visual layout | `:mode` specifies the type of layout: `template`, `part`, `page`, or `blog`. `:id` uses signed route parameters (`{uuid}.{signature}`). Legacy links using `?templateId` or `?partId` will redirect here. |

Modes:

- `template`: template layout editor
- `part`: template part editor
- `page`: visual page layout editor
- `blog`: visual blog layout editor

### Public Rendering

- `awcms-public/primary/src/components/common/PuckRenderer.astro`
- `awcms-public/primary/src/components/common/WidgetRenderer.astro`

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

### Context7 Guidance (Puck)

Puck components should define explicit fields and render functions in a config object.
Note the following patterns:

- Import `@puckeditor/core/puck.css` in the editor UI.
- Use `<Puck>` for editing and `<Render config={config} data={data} />` for public output.
- The Astro `PuckRenderer` wraps `<Render>` with an allow-list component registry.
- Avoid rendering unknown blocks on the public portal.

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
