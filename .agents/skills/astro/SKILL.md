---
name: astro
description: "Best practices and guidelines for Astro development, distilled from Context7 documentation."
---

# Astro Best Practices

## Project Structure

- `src/pages/`: File-based routing. `.astro`, `.md`, `.mdx` files here become pages.
- `src/components/`: Reusable UI components (Astro, React, Vue, etc.).
- `src/layouts/`: Shared UI structures (headers, footers, wrappers).

## Performance

- **Island Architecture**: Use client directives (`client:load`, `client:visible`, `client:idle`) sparingly. Default to server-only rendering.
- **Component Streaming**: Split heavy data fetching into child components to allow the main page/shell to render immediately while data streams in.

## Configuration (`astro.config.mjs`)

- **Site URL**: always set `site` for sitemap generation.
- **Trailing Slashes**: Configure `trailingSlash` ('always' or 'never') for consistency.
- **Integrations**: Add integrations (e.g., Tailwind, React) in the `integrations` array.

## Migration Tips

- Ensure all assets are in `public/` or `src/assets/`.
- Use `Astro.glob()` for importing multiple files.
