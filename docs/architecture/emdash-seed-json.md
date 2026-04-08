> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)

# EmDash seed.json

## Purpose

Define the canonical external `seed.json` payload accepted by the EmDash tenant import executor in `awcms-edge/src/lib/emdashSeedTemplates.ts`.

## Current Scope

- Blog, marketing, and portfolio execution are materialized import waves today.
- The importer currently materializes:
  - blog content, one visual `single_post` page template, widget areas, and widgets
  - marketing pages, services, team members, and testimonies
  - portfolio items into tenant `portfolio` records
- External `seed.json` can be loaded from an `http(s)` URL or a local file-path `sourceLocator`.
- Unsupported non-URL locators still fall back to the built-in seed used for local foundation validation.

## Canonical Shape

The importer accepts a few wrapper layouts (`seed`, `template`, `import`, or top-level), but this is the canonical shape to publish:

Copyable fixture:

- [`docs/examples/emdash/blog/seed.json`](../examples/emdash/blog/seed.json)
- [`docs/examples/emdash/blog/seed.minimal.json`](../examples/emdash/blog/seed.minimal.json)
- [`docs/examples/emdash/marketing/seed.json`](../examples/emdash/marketing/seed.json)
- [`docs/examples/emdash/portfolio/seed.json`](../examples/emdash/portfolio/seed.json)

```json
{
  "seed": {
    "templateSlug": "blog",
    "sourceKey": "blog:seed",
    "sourceVersion": "emdash-template-v1",
    "pageTemplate": {
      "sourceId": "page:single-post",
      "title": "EmDash Single Post Template",
      "slug": "emdash-single-post",
      "excerpt": "Seeded single-post template for EmDash blog imports.",
      "rawPayload": {
        "pageType": "single_post",
        "origin": "emdash.seed"
      },
      "content": {
        "root": {
          "children": [
            {
              "type": "ContentTitle",
              "props": {
                "source": "blog",
                "headingLevel": "h1",
                "alignment": "left"
              }
            },
            {
              "type": "ContentMeta",
              "props": {
                "source": "blog",
                "showDate": true,
                "showAuthor": true,
                "showCategory": true,
                "showTags": true,
                "alignment": "left"
              }
            },
            {
              "type": "ContentFeaturedImage",
              "props": {
                "source": "blog",
                "aspectRatio": "video",
                "rounded": "xl"
              }
            },
            {
              "type": "ContentBody",
              "props": {
                "source": "blog"
              }
            },
            {
              "type": "WidgetArea",
              "props": {
                "area": "emdash-blog-sidebar",
                "title": "Sidebar"
              }
            }
          ]
        }
      }
    },
    "blogs": [
      {
        "sourceId": "blog:welcome-to-emdash",
        "title": "Welcome to EmDash in AWCMS",
        "slug": "welcome-to-emdash",
        "excerpt": "A seeded blog post proving the EmDash import path.",
        "content": "<p>Seeded HTML content.</p>",
        "featuredImage": "https://example.com/blog.jpg",
        "rawPayload": {
          "contentType": "blog",
          "componentId": "core:post",
          "schemaVersion": "emdash-template-v1"
        }
      }
    ],
    "widgetAreas": [
      {
        "sourceId": "widget-area:emdash-blog-sidebar",
        "slug": "emdash-blog-sidebar",
        "name": "EmDash Blog Sidebar",
        "rawPayload": {
          "componentId": "core:widget-area",
          "schemaVersion": "emdash-template-v1"
        },
        "widgets": [
          {
            "sourceId": "widget:sidebar-search",
            "name": "Search Posts",
            "componentId": "core:search",
            "showTitle": true,
            "order": 0,
            "config": {
              "placeholder": "Search posts"
            },
            "rawPayload": {
              "componentId": "core:search",
              "schemaVersion": "emdash-template-v1"
            }
          },
          {
            "sourceId": "widget:sidebar-links",
            "name": "Quick Links",
            "componentId": "core:links",
            "showTitle": true,
            "order": 1,
            "config": {
              "items": [
                { "title": "All Blogs", "url": "/id/blogs" },
                { "title": "Back to Home", "url": "/id" }
              ]
            },
            "rawPayload": {
              "componentId": "core:links",
              "schemaVersion": "emdash-template-v1"
            }
          }
        ]
      }
    ]
  }
}
```

## Field Rules

| Field | Required | Notes |
| --- | --- | --- |
| `seed.templateSlug` | Yes | Supported executable values today: `blog`, `marketing`. |
| `seed.sourceKey` | Recommended | Stored in import artifacts for traceability. |
| `seed.sourceVersion` | Recommended | Stored in import artifacts and used in audit/debug output. |
| `seed.pageTemplate` | Optional | Used by the blog wave. If omitted, the importer falls back to the built-in `single_post` visual page template. |
| `seed.blogs` | Conditional | Required for `templateSlug = blog`. |
| `seed.widgetAreas` | Optional | When omitted, blog or marketing imports still succeed but no widget areas are materialized. |
| `seed.marketing` | Conditional | Required for `templateSlug = marketing`. |
| `seed.portfolio` | Conditional | Required for `templateSlug = portfolio`. |

## Future Wave Sections

### `seed.marketing`

This section is now executable when `seed.templateSlug = marketing`.

The contract recognizes these optional subsections:

| Field | Target shape | Notes |
| --- | --- | --- |
| `marketing.pages` | visual/landing page definitions | Materialized into visual `pages` records. |
| `marketing.services` | `services`-like records | Uses `title`, `slug`, `description`, `icon`, `image`, `link`, `displayOrder`. |
| `marketing.team` or `marketing.teams` | `teams`-like records | Uses `name`, `role`, `image`, `socialLinks`, `displayOrder`. |
| `marketing.testimonies` | `testimonies`-like records | Uses `title`, `slug`, `content`, `authorName`, `authorPosition`, `authorImage`, `rating`. |

### `seed.portfolio`

The contract recognizes these optional subsections:

| Field | Target shape | Notes |
| --- | --- | --- |
| `portfolio.items` | `portfolio`-like records | Executable today. Uses `title`, `slug`, `description`, `client`, `projectDate`, `images`, and `tags`. |

## Widget Rules

The loader derives the normalized AWCMS widget `type` from the external payload in this order:

1. `type`
2. `rawPayload.componentId`
3. `componentId`

Current canonical mappings:

| External value | Normalized AWCMS `type` |
| --- | --- |
| `core:search` | `search` |
| `core:links` | `links` |
| `core:content` | `content` |
| `core:recent-posts` | `recent_posts` |

Other `core:*` values are normalized by stripping the prefix and replacing `-` with `_`.

## Import Behavior

- The Worker loads external JSON from `sourceLocator`.
- Supported locator forms are:
  - `https://example.com/emdash/blog/seed.json`
  - `file:///absolute/path/to/seed.json`
  - `/absolute/path/to/seed.json`
  - `./relative/path/to/seed.json`
- The loader normalizes the payload into the internal `EmdashSeedTemplate` contract.
- The executor materializes:
  - a `single_post` visual page template in `pages`
  - tenant widget areas in `template_parts`
  - tenant widgets in `widgets`
  - published blog rows in `blogs`
- The executor also materializes marketing pages, services, team members, and testimonies when `templateSlug = marketing`.
- The executor also materializes portfolio items when `templateSlug = portfolio`.
- `raw_emdash_payload` is preserved on widget areas and widgets.
- Import replayability is enforced through `tenant_import_mappings`.

## Failure Cases

- If `sourceLocator` is a supported local file path, the loader reads the local JSON file directly.
- If `sourceLocator` is not a supported URL or local path, the external loader is skipped and the built-in fallback seed may be used.
- If the external URL returns non-2xx, the import fails.
- If the local file cannot be read or parsed, the import fails.
- If the JSON does not normalize into at least one supported content section for the requested template wave, the import fails.
- If a required materialization step fails, the job is marked `failed` and the error is recorded in `result_summary`.
