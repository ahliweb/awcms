# Visual Page Builder Documentation

## Overview

The Visual Page Builder allows users to create complex, responsive layouts using a drag-and-drop interface. It is built on top of [Puck](https://github.com/measured/puck) and integrated deeply with AWCMS's media library and RBAC system.

## Key Components

### 1. `VisualPagesManager.jsx`

The dashboard interface for listing and managing visual pages. It allows creating, editing, and deleting pages that are marked with `editor_type = 'visual'`.

### 2. `VisualPageBuilder.jsx`

The editor component that wraps the Puck editor. It handles saving data to Supabase and loading existing content.

### 3. `config.js` (`src/components/visual-builder/config.js`)

This is the core configuration file where all blocks are registered. It defines:

- **Components**: The React components to render (e.g., Hero, Grid, Text).
- **Fields**: The properties each component accepts (e.g., title, image URL, alignment).
- **Root Fields**: Page-level settings like background color.

## Available Blocks

| Block Name | Description | Key Props |
| :--- | :--- | :--- |
| **Hero** | Large intro section with image/text | `title`, `subtitle`, `backgroundImage`, `overlay` |
| **Grid** | Layout container with nested zones | `columns` (2-4), `gap` |
| **Text** | Rich text content | `content` (HTML) |
| **Image** | Single image with caption | `src`, `alt`, `borderRadius`, `width` |
| **Card** | Content cards | `title`, `description`, `image`, `link` |
| **Testimonial** | Customer reviews | `quote`, `name`, `avatar`, `rating` |
| **Promotion** | Integration with Promotions module | `promotionId`, `variant` (Banner/Card/Popup) |
| **ContactForm** | Native contact form | `recipientEmail`, `successMessage` |

## Creating a New Block

To add a new block (e.g., "Video Block"):

1. **Create Component**: Create `src/components/visual-builder/blocks/VideoBlock.jsx`.
2. **Define Fields**: Export a fields object for Puck config.
3. **Register**: Import in `config.js` and add to `puckConfig.components`.

**Example:**

```javascript
// VideoBlock.jsx
export const VideoBlock = ({ videoUrl }) => (
  <div className="video-wrapper">
    <iframe src={videoUrl} />
  </div>
);

// config.js
Video: {
  fields: {
    videoUrl: { type: 'text', label: 'YouTube URL' }
  },
  render: VideoBlock
}
```

## Permissions

The Visual Builder is protected by the following permissions:

- `edit_visual_pages`: Required to access the builder.
- `publish_visual_pages`: Required to access the builder.

## Public Portal Integration

The Visual Builder outputs a **JSON Payload** stored in `puck_layout_jsonb`. The Public Portal (`awcms-public`) renders this using a headless strategy.

### Rendering Engine (`awcms-public`)

- **Registry**: `src/components/registry.tsx` (Zod-validated white-list).
- **Renderer**: `src/components/PuckRenderer.tsx` (Maps JSON -> Astro/React Components).

> **Security Note**: The Public Portal ignores any blocks NOT in the registry, preventing unauthorized component injection.

## Template Parts

The Visual Builder can also edit **Template Parts** (Headers, Footers, Sidebars). Access the Template Parts editor via `/cmspanel/visual-editor?partId=<uuid>`.

## Extension Integration

Extensions can register new blocks at runtime using the `registerTemplateBlock()` API:

```javascript
import { registerTemplateBlock } from '@/lib/templateExtensions';

registerTemplateBlock({
    type: 'my_plugin/chart',
    label: 'Interactive Chart',
    render: ChartComponent,
    fields: { data: { type: 'object' } }
});
```

Registered blocks will appear in both the Admin Panel's Visual Builder and the Public Portal's component registry (after being whitelisted).
