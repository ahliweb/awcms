---
name: tailwind
description: "Best practices and guidelines for Tailwind CSS v3 development, distilled from Context7 documentation."
---

# Tailwind CSS Best Practices

## Dark Mode

- **Strategy**: Use `darkMode: 'selector'` in `tailwind.config.js` for manual control (e.g., a toggle switch) via a `dark` class on the `<html>` element.
- **Implementation**:

  ```javascript
  // On page load or theme change. Best in <head> to avoid FOUC.
  if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
  ```

- **Styling**: Use the `dark:` prefix (e.g., `dark:bg-slate-900`, `dark:text-white`).

## Configuration

- **Content**: Ensure `content` array in `tailwind.config.js` includes all file paths that use Tailwind classes (e.g., `./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}`).
- **Theme Extension**: Extend defaults in `theme.extend` rather than overriding the entire theme unless necessary.

## Optimization

- **Classes**: Tailwind automatically suppresses unused CSS in production builds if `content` is configured correctly.
- **Organization**: Use `@apply` sparingly. Prefer utility classes in HTML for better portability and smaller CSS bundles.
