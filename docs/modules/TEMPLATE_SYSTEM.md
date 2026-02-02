# Template System

## Purpose

Explain how templates, parts, widgets, and assignments drive multi-channel rendering.

## Audience

- Admin panel developers
- Public portal developers

## Prerequisites

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

- `/cmspanel/templates` manages templates and parts.
- `/cmspanel/templates/assignments` manages route assignments by channel.
- `/cmspanel/widgets` manages widget instances.

### Public Portal Rendering

1. Fetch page data and `template_assignments` for `web` channel.
2. Merge header part, page content, and footer part.
3. Render with `PuckRenderer` (`components/common/PuckRenderer.astro`) and widget mapping (`components/common/WidgetRenderer.astro`).

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
