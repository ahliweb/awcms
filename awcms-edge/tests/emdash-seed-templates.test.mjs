import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getEmdashSeedTemplate, loadEmdashExternalSeedTemplate } from '../src/lib/emdashSeedTemplates.ts'

test('getEmdashSeedTemplate returns builtin blog seed', () => {
  const seed = getEmdashSeedTemplate('blog', 'seed')

  assert.ok(seed)
  assert.equal(seed?.templateSlug, 'blog')
  assert.equal(seed?.blogs.length, 1)
  assert.equal(seed?.widgetAreas[0]?.slug, 'emdash-blog-sidebar')
})

test('loadEmdashExternalSeedTemplate loads relative local seed paths', async () => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), 'emdash-seed-'))
  const fixturePath = path.join(fixtureDir, 'seed.json')
  await writeFile(fixturePath, JSON.stringify({
    seed: {
      templateSlug: 'blog',
      blogs: [
        {
          title: 'Local Relative Seed',
          slug: 'local-relative-seed',
          content: '<p>Relative file path import</p>',
        },
      ],
    },
  }))

  const originalCwd = process.cwd()
  process.chdir(fixtureDir)

  try {
    const result = await loadEmdashExternalSeedTemplate({
      sourceLocator: './seed.json',
      templateSlug: 'blog',
    })

    assert.ok(result)
    assert.equal(result?.blogs[0]?.slug, 'local-relative-seed')
  } finally {
    process.chdir(originalCwd)
  }
})

test('loadEmdashExternalSeedTemplate loads file url locators', async () => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), 'emdash-seed-url-'))
  const fixturePath = path.join(fixtureDir, 'seed.json')
  await writeFile(fixturePath, JSON.stringify({
    seed: {
      templateSlug: 'blog',
      blogs: [
        {
          title: 'Local File URL Seed',
          slug: 'local-file-url-seed',
          content: '<p>File URL import</p>',
        },
      ],
    },
  }))

  const result = await loadEmdashExternalSeedTemplate({
    sourceLocator: pathToFileURL(fixturePath).toString(),
    templateSlug: 'blog',
  })

  assert.ok(result)
  assert.equal(result?.blogs[0]?.slug, 'local-file-url-seed')
})

test('loadEmdashExternalSeedTemplate ignores unsupported non-url locators', async () => {
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
