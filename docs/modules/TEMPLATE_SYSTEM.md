> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 3 (Modules)

# Template System

## Purpose

Explain how templates, parts, widgets, and assignments drive multi-channel rendering.

## Audience

- Admin panel developers
- Public portal developers

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for template system architecture
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- `docs/modules/VISUAL_BUILDER.md`
- `docs/tenancy/overview.md`

## Core Concepts

- Templates and parts are stored as Puck JSON.
- Template assignments map route types to templates per channel.
- Widgets fill predefined widget areas.

## How It Works

### Database Tables

| Table | Description |
| --- | --- |
| `templates` | Full page layouts (Puck JSON) |
| `template_parts` | Reusable parts (header, footer, widget areas) |
| `template_assignments` | Route-to-template mappings per channel |
| `widgets` | Widget instances |
| `template_strings` | Localized strings |

### Admin UI

- `/cmspanel/templates` lists page templates.
- `/cmspanel/templates/parts` manages template parts.
- `/cmspanel/templates/assignments` manages route assignments by channel.
- `/cmspanel/templates/languages` manages template strings.
- `/cmspanel/visual-editor/template/:id` edits a template layout (signed ID).
- `/cmspanel/visual-editor/part/:id` edits a template part (signed ID).
- `/cmspanel/widgets` manages widget instances.

Use `encodeRouteParam` when generating template/part edit links so the `:id` includes the required signature.

### Public Portal Rendering

1. Fetch page data and `template_assignments` for `web` channel.
2. Merge header part, page content, and footer part.
3. Render with `PuckRenderer` (`components/common/PuckRenderer.astro`) and widget mapping (`components/common/WidgetRenderer.astro`).

**Context7 note**: Keep rendering in static builds to allow `getStaticPaths` and island hydration to work predictably.

## Implementation Patterns

```javascript
import { registerTemplateBlock, registerWidgetArea, registerPageType } from '@/lib/templateExtensions';

registerTemplateBlock({
  type: 'my_plugin/slider',
  label: 'Image Slider',
  render: MySliderComponent,
  fields: { images: { type: 'array' } }
});
```

**Context7 note**: Use explicit field definitions in Puck configs and avoid rendering unknown blocks on the public portal.

## Permissions and Access

- Template management is gated by tenant permissions and ABAC checks.
- Assignments are tenant-scoped and filtered via RLS.

## Security and Compliance Notes

- Templates are tenant-scoped and must include `tenant_id`.
- Public rendering uses allow-listed components only.

## Operational Concerns

- Channels supported in the UI: `web`, `mobile`, `esp32`.
- Only the `web` channel is rendered by the Astro public portal.

## References

- `docs/modules/VISUAL_BUILDER.md`
- `docs/modules/PUBLIC_PORTAL_ARCHITECTURE.md`
