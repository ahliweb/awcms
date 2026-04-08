import test from 'node:test'
import assert from 'node:assert/strict'
import { getEmdashSeedTemplate, loadEmdashExternalSeedTemplate } from '../src/lib/emdashSeedTemplates.ts'

test('getEmdashSeedTemplate returns builtin blog seed', () => {
  const seed = getEmdashSeedTemplate('blog', 'seed')

  assert.ok(seed)
  assert.equal(seed?.templateSlug, 'blog')
  assert.equal(seed?.blogs.length, 1)
  assert.equal(seed?.widgetAreas[0]?.slug, 'emdash-blog-sidebar')
})

test('loadEmdashExternalSeedTemplate ignores non-url locators', async () => {
  const result = await loadEmdashExternalSeedTemplate({
    sourceLocator: 'emdash/templates/blog/seed/seed.json',
    templateSlug: 'blog',
  })

  assert.equal(result, null)
})

test('loadEmdashExternalSeedTemplate normalizes external seed.json payloads', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    seed: {
      templateSlug: 'blog',
      sourceVersion: 'remote-v2',
      pageTemplate: {
        sourceId: 'page:remote-single-post',
        title: 'Remote Single Post',
        slug: 'remote-single-post',
        excerpt: 'Remote excerpt',
        content: {
          root: {
            children: [
              {
                type: 'ContentTitle',
                props: { source: 'blog' },
              },
            ],
          },
        },
      },
      blogs: [
        {
          sourceId: 'blog:remote-post',
          title: 'Remote Post',
          slug: 'remote-post',
          excerpt: 'Remote post excerpt',
          content: '<p>Remote body</p>',
          featuredImage: 'https://example.com/blog.jpg',
        },
      ],
      widgetAreas: [
        {
          sourceId: 'widget-area:remote-sidebar',
          slug: 'remote-sidebar',
          name: 'Remote Sidebar',
          widgets: [
            {
              sourceId: 'widget:remote-search',
              name: 'Remote Search',
              componentId: 'core:search',
              config: { placeholder: 'Search remotely' },
            },
          ],
        },
      ],
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

  try {
    const seed = await loadEmdashExternalSeedTemplate({
      sourceLocator: 'https://example.com/emdash/blog/seed.json',
      templateSlug: 'blog',
    })

    assert.ok(seed)
    assert.equal(seed?.sourceVersion, 'remote-v2')
    assert.equal(seed?.blogs[0]?.slug, 'remote-post')
    assert.equal(seed?.widgetAreas[0]?.slug, 'remote-sidebar')
    assert.equal(seed?.widgetAreas[0]?.widgets[0]?.type, 'search')
    assert.equal(seed?.pageTemplate.slug, 'remote-single-post')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('loadEmdashExternalSeedTemplate rejects malformed remote payloads', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ seed: { templateSlug: 'blog' } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

  try {
    await assert.rejects(
      () => loadEmdashExternalSeedTemplate({
        sourceLocator: 'https://example.com/emdash/blog/seed.json',
        templateSlug: 'blog',
      }),
      /invalid or missing blog seed content/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
