import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
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
  assert.deepEqual(seed?.marketing, { pages: [], services: [], team: [], testimonies: [] })
  assert.deepEqual(seed?.portfolio, { items: [] })
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

test('loadEmdashExternalSeedTemplate resolves native EmDash repo roots for blog templates', async () => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), 'emdash-native-blog-'))
  const seedDir = path.join(fixtureDir, 'templates', 'blog', 'seed')
  await mkdir(seedDir, { recursive: true })
  await writeFile(path.join(seedDir, 'seed.json'), JSON.stringify({
    version: '1',
    collections: [{ slug: 'posts' }],
    widgetAreas: [
      {
        name: 'Sidebar',
        widgets: [
          { type: 'component', componentId: 'core:search', title: 'Search' },
        ],
      },
    ],
    content: {
      posts: [
        {
          id: 'post-1',
          slug: 'native-post',
          data: {
            title: 'Native Post',
            excerpt: 'Native excerpt',
            featured_image: { $media: { url: 'https://example.com/native.jpg' } },
            content: [
              {
                _type: 'block',
                style: 'normal',
                children: [{ _type: 'span', text: 'Native content body' }],
              },
            ],
          },
        },
      ],
    },
  }))

  const seed = await loadEmdashExternalSeedTemplate({
    sourceLocator: fixtureDir,
    templateSlug: 'blog',
  })

  assert.ok(seed)
  assert.equal(seed?.templateSlug, 'blog')
  assert.equal(seed?.blogs[0]?.slug, 'native-post')
  assert.equal(seed?.blogs[0]?.featuredImage, 'https://example.com/native.jpg')
  assert.equal(seed?.widgetAreas[0]?.slug, 'sidebar')
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
      marketing: {
        services: [
          {
            title: 'Strategy',
            slug: 'strategy',
            description: 'Marketing strategy service',
          },
        ],
        team: [
          {
            name: 'Alya Rahman',
            role: 'Creative Director',
          },
        ],
        testimonies: [
          {
            title: 'Client Feedback',
            slug: 'client-feedback',
            content: 'Great work',
            authorName: 'Client One',
            rating: 5,
          },
        ],
      },
      portfolio: {
        items: [
          {
            title: 'Brand Refresh',
            slug: 'brand-refresh',
            description: 'Portfolio case study',
            client: 'Acme Co',
            images: ['https://example.com/portfolio.jpg'],
          },
        ],
      },
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
    assert.equal(seed?.marketing.services[0]?.slug, 'strategy')
    assert.equal(seed?.marketing.team[0]?.slug, 'alya-rahman')
    assert.equal(seed?.marketing.testimonies[0]?.authorName, 'Client One')
    assert.equal(seed?.portfolio.items[0]?.slug, 'brand-refresh')
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
      /invalid or missing supported blog seed content/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('loadEmdashExternalSeedTemplate accepts marketing template payloads without blogs', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    seed: {
      templateSlug: 'marketing',
      marketing: {
        pages: [
          {
            title: 'Landing Home',
            slug: 'landing-home',
            content: { root: { children: [] } },
          },
        ],
        services: [
          {
            title: 'Strategy',
            slug: 'strategy',
            description: 'Marketing strategy service',
          },
        ],
      },
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

  try {
    const seed = await loadEmdashExternalSeedTemplate({
      sourceLocator: 'https://example.com/emdash/marketing/seed.json',
      templateSlug: 'marketing',
    })

    assert.ok(seed)
    assert.equal(seed?.templateSlug, 'marketing')
    assert.equal(seed?.blogs.length, 0)
    assert.equal(seed?.marketing.pages[0]?.slug, 'landing-home')
    assert.equal(seed?.marketing.services[0]?.slug, 'strategy')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('loadEmdashExternalSeedTemplate resolves native EmDash repo roots for marketing templates', async () => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), 'emdash-native-marketing-'))
  const seedDir = path.join(fixtureDir, 'templates', 'marketing', 'seed')
  await mkdir(seedDir, { recursive: true })
  await writeFile(path.join(seedDir, 'seed.json'), JSON.stringify({
    version: '1',
    collections: [{ slug: 'pages' }],
    content: {
      pages: [
        {
          id: 'home',
          slug: 'home',
          data: {
            title: 'Home',
            content: [
              {
                _type: 'marketing.features',
                features: [
                  { title: 'Fast', description: 'Fast feature' },
                ],
              },
              {
                _type: 'marketing.testimonials',
                testimonials: [
                  { author: 'Client One', quote: 'Great', role: 'Founder', company: 'Acme' },
                ],
              },
            ],
          },
        },
      ],
    },
  }))

  const seed = await loadEmdashExternalSeedTemplate({
    sourceLocator: fixtureDir,
    templateSlug: 'marketing',
  })

  assert.ok(seed)
  assert.equal(seed?.templateSlug, 'marketing')
  assert.equal(seed?.marketing.pages[0]?.slug, 'home')
  assert.equal(seed?.marketing.services[0]?.slug, 'fast')
  assert.equal(seed?.marketing.testimonies[0]?.authorName, 'Client One')
})
