# Migrating from WordPress (Elementor) to AWCMS

This guide outlines the technical process and strategy for migrating an existing WordPress website built with Elementor to the AWCMS platform.

## 1. Architectural Differences

Before beginning, it's crucial to understand how AWCMS differs from WordPress/Elementor:

| Feature | WordPress & Elementor | AWCMS (React + Astro + Supabase) |
| :--- | :--- | :--- |
| **Data Storage** | MySQL (wp_posts, wp_postmeta) | Supabase/PostgreSQL (structured JSON) |
| **Page Building** | Shortcodes & raw HTML fragments | `PuckEditor` (Structured React components) |
| **Frontend** | PHP/Server-rendered | Astro static output + React islands |
| **Styling** | Elementor CSS & Theme Styles | Tailwind CSS v4 & custom tokens |
| **Plugins** | PHP WordPress Plugins | AWCMS Core Hooks & Extensions |

Elementor stores page layouts as a combination of shortcodes, serialized data, and inline CSS directly in the database. AWCMS uses Puck, which stores pure JSON data mapping strictly to predefined React components.
**Because of this fundamental difference, there is no automatic "1-click" migration of page layouts.**

## 2. Migration Strategy: Content vs. Design

The migration must be split into two distinct tracks: **Data/Content Migration** and **Design/Component Rebuilding**.

### Phase 1: Data & Content Migration

Standard data like blog posts, authors, and metadata can be migrated via scripts.

1. **Export WordPress Data:** Export all necessary data from WordPress. The WordPress REST API or a database dump are the most reliable methods.
    * *Authors/Users:* Migrate to Supabase `users` and `user_profiles`.
    * *Blog Posts:* Migrate `wp_posts` (where `post_type = 'post'`) to the AWCMS `blogs` table.
    * *Categories/Tags:* Migrate taxonomies to the AWCMS `categories` table.
2. **Transform Content:** Standard blog posts usually use the classic editor (Gutenberg/Classic Editor).
    * If posts use Elementor, you will need to extract the raw text content.
    * AWCMS uses **TipTap** for rich text (standard posts). You'll need to clean the HTML or convert it to JSON format suitable for TipTap.
3. **Import to Supabase:** Write a Node.js script using the `@supabase/supabase-js` client to batch-insert the transformed data into your AWCMS project.

### Phase 2: Design & Component Rebuilding (The Elementor Replacement)

This is the most significant part of the migration. You must rebuild Elementor widgets as AWCMS React components.

1. **Audit Elementor Widgets:** Review every page on the WordPress site and list all unique Elementor widgets used (e.g., Hero, Image Carousel, Icon Box, Testimonial Grid).
2. **Build React Components:** For each widget identified, create a corresponding React component using Tailwind CSS for styling.
    * *Example:* If you had an Elementor "Call to Action" widget, build a `<CallToAction title={...} buttonText={...} />` component.
3. **Register with Puck:** Register all these new components into the AWCMS Puck configuration (`Config` object). Define the editable `fields` so content editors can change text, images, and colors, just as they did in Elementor.
4. **Recreate Pages Visually:** Once your "blocks" are built and registered, open the AWCMS Admin Panel. Create the target pages (e.g., Home, About) and visually recreate the layouts by dragging and dropping your new AWCMS components to match the old Elementor designs.

## 3. SEO and Redirects

To prevent traffic loss during the transition:

1. **Map URLs:** Create a spreadsheet mapping old WordPress URLs (e.g., `example.com/about-us/`) to the new AWCMS URLs.
2. **Configure Redirects:** In the public portal deployment pipeline or at the edge level (for example Cloudflare Pages `_redirects`), implement 301 redirects from the old structures to the new ones.
3. **Metadata:** Ensure all pages and posts in AWCMS have their SEO metadata (Title, Description, canonical URLs, OG images) migrated correctly from Yoast/RankMath into the AWCMS page settings.

## 4. Best Practices for the Transition

* **Avoid Inline Styles:** In Elementor, users easily add margin/padding via the "Advanced" tab. In AWCMS, prefer baking these into the React component or providing controlled, predefined spacing options in the Puck config to ensure consistent design.
* **Media Migration:** Download all `wp-content/uploads` and re-upload them to your Supabase Storage bucket. Update database references in your migration script to point to the new Supabase URLs.
* **Islands Architecture:** If an Elementor widget was highly interactive (e.g., a complex filtering gallery), remember to implement it as an Astro Island (`client:load` or `client:idle`) in the AWCMS Public Portal so the JavaScript runs on the client side.

## 5. Next Steps

1. Set up the blank AWCMS environment.
2. Perform a test import of 10 blog posts from the WordPress REST API to Supabase.
3. Implement the top 3 most used Elementor widgets as AWCMS React components.
