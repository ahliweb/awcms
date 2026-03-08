# Migrating WordPress Data to AWCMS (Supabase)

This guide provides a practical blueprint for writing a Node.js script to migrate your WordPress posts, users, and categories into your AWCMS Supabase database.

## Prerequisites

1. **Node.js**: Ensure Node.js `>=22.12.0` is installed.
2. **Supabase Client**: You will need the `@supabase/supabase-js` package.
3. **WordPress REST API**: Your source WordPress site must be accessible via the REST API (e.g., `https://your-wp-site.com/wp-json/wp/v2/`).

## Setup the Migration Project

Create a temporary folder for your migration script:

```bash
mkdir awcms-wp-migration
cd awcms-wp-migration
npm init -y
npm install @supabase/supabase-js dotenv node-fetch
```

Create a `.env` file to hold your Supabase credentials:

```env
SUPABASE_URL=https://your-project-id.supabase.co
# Use the Secret API key only in this local/backend migration script
SUPABASE_SECRET_KEY=your-secret-key-here
WP_API_URL=https://your-wordpress-site.com/wp-json/wp/v2
TARGET_TENANT_ID=your-awcms-tenant-uuid
```

## The Migration Script (`migrate.js`)

Below is a baseline script that fetches posts from WordPress and inserts them into the AWCMS `blogs` table.

```javascript
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
dotenv.config();

// 1. Initialize Supabase Admin Client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const WP_URL = process.env.WP_API_URL;
const TENANT_ID = process.env.TARGET_TENANT_ID;

async function migratePosts() {
  console.log('Starting WordPress Post Migration...');

  try {
    // 2. Fetch Posts from WordPress (Paginated)
    // Note: You should build in pagination for large sites using ?page=X&per_page=100
    const response = await fetch(`${WP_URL}/posts?per_page=10`);
    if (!response.ok) throw new Error(`WP API Error: ${response.statusText}`);

    const wpPosts = await response.json();
    console.log(`Fetched ${wpPosts.length} posts from WordPress.`);

    // 3. Transform Data for AWCMS Schema
    const awcmsBlogs = wpPosts.map(post => {
      return {
        tenant_id: TENANT_ID, // CRITICAL: Assign to correct tenant
        title: post.title.rendered,
        slug: post.slug,
         // WordPress provides raw HTML. Prefer converting this into TipTap-safe
         // structured content or sanitizing it before later rendering.
         content: post.content.rendered,
        // Strip tags for plain text excerpt
        excerpt: post.excerpt.rendered.replace(/(<([^>]+)>)/gi, ''),
        published_at: post.date,
        // Map WordPress status to AWCMS status
        status: post.status === 'publish' ? 'published' : 'draft',
      };
    });

    // 4. Insert into Supabase
    const { data, error } = await supabase
      .from('blogs')
      // Use tenant-scoped slug uniqueness to prevent duplicates
      .upsert(awcmsBlogs, { onConflict: 'tenant_id,slug' })
      .select();

    if (error) throw error;

    console.log(`Successfully migrated ${data.length} posts!`);

  } catch (error) {
    console.error('Migration failed:', error);
  }
}

migratePosts();
```

## Running the Migration

Run the script locally to pipe data from WordPress to your Supabase instance:

```bash
node migrate.js
```

## Advanced Considerations

* **HTML to TipTap JSON:** AWCMS standardizes on TipTap JSON format. If your frontend expects JSON, use a library like `@tiptap/html` or an approved server-side edge workflow to parse the raw WordPress HTML into structured JSON during the import phase.
* **Elementor Content:** If a post was built entirely in Elementor, the `content.rendered` field will contain massive amounts
  of Elementor-specific `<div>` enclosures and class names. You will need to write custom DOM parsers (using `cheerio`) to
  extract the actual text, or abandon the layout and move the content manually.
* **Media and Images:** The script above does not migrate images. To fully migrate, you must parse the WordPress content for `<img>` tags, download the images to Supabase Storage, and rewrite the URLs in the post content to point to your new Supabase Storage buckets.
