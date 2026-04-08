import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/index.ts'

const tenantImportsEnv = {
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
  SUPABASE_SECRET_KEY: 'test-secret-key',
}

const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

const parseEq = (value) => typeof value === 'string' && value.startsWith('eq.') ? value.slice(3) : null

const requestDetails = async (input, init) => {
  const request = input instanceof Request ? input : new Request(String(input), init)
  const method = request.method || init?.method || 'GET'
  let body = null

  if (method !== 'GET' && method !== 'HEAD') {
    const text = await request.text()
    body = text ? JSON.parse(text) : null
  }

  return {
    request,
    url: new URL(request.url),
    method,
    body,
  }
}

const createTenantImportFetch = (state) => async (input, init) => {
  const { request, url, method, body } = await requestDetails(input, init)

  if (url.hostname === 'seed.example.com') {
    return jsonResponse({
      seed: {
        templateSlug: 'blog',
        sourceVersion: 'remote-v2',
        sourceKey: 'blog:remote-seed',
        pageTemplate: {
          sourceId: 'page:remote-single-post',
          title: 'Remote Single Post',
          slug: 'remote-single-post',
          excerpt: 'Remote page template',
          content: {
            root: {
              children: [
                { type: 'ContentTitle', props: { source: 'blog' } },
                { type: 'WidgetArea', props: { area: 'remote-sidebar', title: 'Sidebar' } },
              ],
            },
          },
        },
        blogs: [
          {
            sourceId: 'blog:remote-post',
            title: 'Remote Post',
            slug: 'remote-post',
            excerpt: 'Remote excerpt',
            content: '<p>Remote blog body</p>',
            featuredImage: 'https://seed.example.com/blog.jpg',
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
                order: 0,
                config: { placeholder: 'Search remote posts' },
              },
            ],
          },
        ],
      },
    })
  }

  if (url.hostname === 'marketing.example.com') {
    return jsonResponse({
      seed: {
        templateSlug: 'marketing',
        sourceVersion: 'marketing-v1',
        sourceKey: 'marketing:remote-seed',
        marketing: {
          pages: [
            {
              sourceId: 'marketing-page:landing-home',
              title: 'Landing Home',
              slug: 'landing-home',
              excerpt: 'Primary landing page',
              rawPayload: { pageType: 'homepage', template: 'marketing' },
              content: {
                root: {
                  children: [
                    { type: 'Hero', props: { headline: 'Remote marketing page' } },
                  ],
                },
              },
            },
          ],
          services: [
            {
              sourceId: 'service:strategy',
              title: 'Strategy',
              slug: 'strategy',
              description: 'Marketing strategy service',
              icon: 'briefcase',
              displayOrder: 0,
            },
          ],
          team: [
            {
              sourceId: 'team:alya-rahman',
              name: 'Alya Rahman',
              role: 'Creative Director',
              displayOrder: 0,
              socialLinks: [{ platform: 'linkedin', url: 'https://example.com/alya' }],
            },
          ],
          testimonies: [
            {
              sourceId: 'testimony:client-feedback',
              title: 'Client Feedback',
              slug: 'client-feedback',
              content: 'Excellent collaboration',
              authorName: 'Client One',
              authorPosition: 'CMO',
              rating: 5,
            },
          ],
        },
      },
    })
  }

  if (url.hostname === 'portfolio.example.com') {
    return jsonResponse({
      seed: {
        templateSlug: 'portfolio',
        sourceVersion: 'portfolio-v1',
        sourceKey: 'portfolio:remote-seed',
        portfolio: {
          items: [
            {
              sourceId: 'portfolio:brand-refresh',
              title: 'Brand Refresh',
              slug: 'brand-refresh',
              description: 'Portfolio case study',
              client: 'Acme Co',
              projectDate: '2026-03-12',
              images: ['https://portfolio.example.com/brand-refresh-1.jpg'],
              tags: ['branding', 'design'],
            },
          ],
        },
      },
    })
  }

  if (url.pathname.endsWith('/auth/v1/user')) {
    return jsonResponse({
      user: {
        id: state.user.id,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'tester@example.com',
      },
    })
  }

  if (url.pathname.endsWith('/rest/v1/rpc/has_permission')) {
    return jsonResponse(true)
  }

  const table = url.pathname.split('/').pop()
  switch (table) {
    case 'users': {
      return jsonResponse({
        id: state.user.id,
        tenant_id: state.user.tenant_id,
        role: {
          is_platform_admin: false,
          is_full_access: false,
        },
      })
    }

    case 'tenant_import_jobs': {
      if (method === 'POST') {
        const row = {
          id: `job-${state.jobs.length + 1}`,
          created_at: '2026-04-08T00:00:00.000Z',
          completed_at: null,
          started_at: null,
          deleted_at: null,
          ...body,
        }
        state.jobs.push(row)
        return jsonResponse(row, 201)
      }

      if (method === 'PATCH') {
        const id = parseEq(url.searchParams.get('id'))
        const job = state.jobs.find((item) => item.id === id)
        Object.assign(job, body)
        return jsonResponse(job)
      }

      if (method === 'GET') {
        const id = parseEq(url.searchParams.get('id'))
        if (id) {
          const job = state.jobs.find((item) => item.id === id)
          return jsonResponse({
            ...job,
            sources: state.sources.filter((item) => item.job_id === id),
            artifacts: state.artifacts.filter((item) => item.job_id === id),
            mappings: state.mappings.filter((item) => item.job_id === id),
          })
        }
        return jsonResponse(state.jobs)
      }
      break
    }

    case 'tenant_import_sources': {
      if (method === 'POST') {
        const existing = state.sources.find((item) => item.job_id === body.job_id && item.source_key === body.source_key && item.source_kind === body.source_kind)
        if (existing) Object.assign(existing, body)
        else state.sources.push({ deleted_at: null, ...body })
        return jsonResponse(existing || body, 201)
      }
      break
    }

    case 'tenant_import_audit': {
      if (method === 'POST') {
        state.importAudit.push(body)
        return jsonResponse(body, 201)
      }
      break
    }

    case 'audit_logs': {
      if (method === 'POST') {
        state.accessAudit.push(body)
        return jsonResponse(body, 201)
      }
      break
    }

    case 'tenant_import_mappings': {
      if (method === 'GET') {
        const tenantId = parseEq(url.searchParams.get('tenant_id'))
        const sourceKind = parseEq(url.searchParams.get('source_kind'))
        const sourceId = parseEq(url.searchParams.get('source_id'))
        const targetTable = parseEq(url.searchParams.get('target_table'))
        const mapping = state.mappings.find((item) => item.tenant_id === tenantId && item.source_kind === sourceKind && item.source_id === sourceId && item.target_table === targetTable)
        return jsonResponse(mapping || null)
      }

      if (method === 'POST') {
        const existing = state.mappings.find((item) => item.tenant_id === body.tenant_id && item.source_kind === body.source_kind && item.source_id === body.source_id && item.target_table === body.target_table)
        if (existing) Object.assign(existing, body)
        else state.mappings.push(body)
        return jsonResponse(existing || body, 201)
      }
      break
    }

    case 'tenant_import_artifacts': {
      if (method === 'POST') {
        const existing = state.artifacts.find((item) => item.job_id === body.job_id && item.artifact_kind === body.artifact_kind && item.artifact_key === body.artifact_key)
        if (existing) Object.assign(existing, body)
        else state.artifacts.push(body)
        return jsonResponse(existing || body, 201)
      }
      break
    }

    case 'pages': {
      if (method === 'GET') {
        const id = parseEq(url.searchParams.get('id'))
        const tenantId = parseEq(url.searchParams.get('tenant_id'))
        const pageType = parseEq(url.searchParams.get('page_type'))
        const slug = parseEq(url.searchParams.get('slug'))
        const page = id
          ? state.pages.find((item) => item.id === id)
          : slug
            ? state.pages.find((item) => item.tenant_id === tenantId && item.slug === slug)
            : state.pages.find((item) => item.tenant_id === tenantId && item.page_type === pageType)
        return jsonResponse(page || null)
      }

      if (method === 'POST') {
        const row = { id: `page-${state.pages.length + 1}`, ...body }
        state.pages.push(row)
        return jsonResponse({ id: row.id }, 201)
      }

      if (method === 'PATCH') {
        const id = parseEq(url.searchParams.get('id'))
        const page = state.pages.find((item) => item.id === id)
        Object.assign(page, body)
        return jsonResponse({ id: page.id })
      }
      break
    }

    case 'template_parts': {
      if (method === 'GET') {
        const id = parseEq(url.searchParams.get('id'))
        const tenantId = parseEq(url.searchParams.get('tenant_id'))
        const slug = parseEq(url.searchParams.get('slug'))
        const part = id
          ? state.templateParts.find((item) => item.id === id)
          : state.templateParts.find((item) => item.tenant_id === tenantId && item.slug === slug)
        return jsonResponse(part || null)
      }

      if (method === 'POST') {
        const row = { id: `part-${state.templateParts.length + 1}`, ...body }
        state.templateParts.push(row)
        return jsonResponse({ id: row.id }, 201)
      }

      if (method === 'PATCH') {
        const id = parseEq(url.searchParams.get('id'))
        const part = state.templateParts.find((item) => item.id === id)
        Object.assign(part, body)
        return jsonResponse({ id: part.id })
      }
      break
    }

    case 'widgets': {
      if (method === 'GET') {
        const id = parseEq(url.searchParams.get('id'))
        const widget = state.widgets.find((item) => item.id === id)
        return jsonResponse(widget || null)
      }

      if (method === 'POST') {
        const row = { id: `widget-${state.widgets.length + 1}`, ...body }
        state.widgets.push(row)
        return jsonResponse({ id: row.id }, 201)
      }

      if (method === 'PATCH') {
        const id = parseEq(url.searchParams.get('id'))
        const widget = state.widgets.find((item) => item.id === id)
        Object.assign(widget, body)
        return jsonResponse({ id: widget.id })
      }
      break
    }

    case 'blogs': {
      if (method === 'GET') {
        const id = parseEq(url.searchParams.get('id'))
        const tenantId = parseEq(url.searchParams.get('tenant_id'))
        const slug = parseEq(url.searchParams.get('slug'))
        const blog = id
          ? state.blogs.find((item) => item.id === id)
          : state.blogs.find((item) => item.tenant_id === tenantId && item.slug === slug)
        return jsonResponse(blog || null)
      }

      if (method === 'POST') {
        const row = { id: `blog-${state.blogs.length + 1}`, ...body }
        state.blogs.push(row)
        return jsonResponse({ id: row.id }, 201)
      }

      if (method === 'PATCH') {
        const id = parseEq(url.searchParams.get('id'))
        const blog = state.blogs.find((item) => item.id === id)
        Object.assign(blog, body)
        return jsonResponse({ id: blog.id })
      }
      break
    }

    case 'services': {
      if (method === 'GET') {
        const id = parseEq(url.searchParams.get('id'))
        const tenantId = parseEq(url.searchParams.get('tenant_id'))
        const title = parseEq(url.searchParams.get('title'))
        const service = id
          ? state.services.find((item) => item.id === id)
          : state.services.find((item) => item.tenant_id === tenantId && item.title === title)
        return jsonResponse(service || null)
      }

      if (method === 'POST') {
        const row = { id: `service-${state.services.length + 1}`, ...body }
        state.services.push(row)
        return jsonResponse({ id: row.id }, 201)
      }

      if (method === 'PATCH') {
        const id = parseEq(url.searchParams.get('id'))
        const service = state.services.find((item) => item.id === id)
        Object.assign(service, body)
        return jsonResponse({ id: service.id })
      }
      break
    }

    case 'teams': {
      if (method === 'GET') {
        const id = parseEq(url.searchParams.get('id'))
        const tenantId = parseEq(url.searchParams.get('tenant_id'))
        const name = parseEq(url.searchParams.get('name'))
        const team = id
          ? state.teams.find((item) => item.id === id)
          : state.teams.find((item) => item.tenant_id === tenantId && item.name === name)
        return jsonResponse(team || null)
      }

      if (method === 'POST') {
        const row = { id: `team-${state.teams.length + 1}`, ...body }
        state.teams.push(row)
        return jsonResponse({ id: row.id }, 201)
      }

      if (method === 'PATCH') {
        const id = parseEq(url.searchParams.get('id'))
        const team = state.teams.find((item) => item.id === id)
        Object.assign(team, body)
        return jsonResponse({ id: team.id })
      }
      break
    }

    case 'testimonies': {
      if (method === 'GET') {
        const id = parseEq(url.searchParams.get('id'))
        const tenantId = parseEq(url.searchParams.get('tenant_id'))
        const slug = parseEq(url.searchParams.get('slug'))
        const testimony = id
          ? state.testimonies.find((item) => item.id === id)
          : state.testimonies.find((item) => item.tenant_id === tenantId && item.slug === slug)
        return jsonResponse(testimony || null)
      }

      if (method === 'POST') {
        const row = { id: `testimony-${state.testimonies.length + 1}`, ...body }
        state.testimonies.push(row)
        return jsonResponse({ id: row.id }, 201)
      }

      if (method === 'PATCH') {
        const id = parseEq(url.searchParams.get('id'))
        const testimony = state.testimonies.find((item) => item.id === id)
        Object.assign(testimony, body)
        return jsonResponse({ id: testimony.id })
      }
      break
    }

    case 'portfolio': {
      if (method === 'GET') {
        const id = parseEq(url.searchParams.get('id'))
        const tenantId = parseEq(url.searchParams.get('tenant_id'))
        const slug = parseEq(url.searchParams.get('slug'))
        const item = id
          ? state.portfolio.find((entry) => entry.id === id)
          : state.portfolio.find((entry) => entry.tenant_id === tenantId && entry.slug === slug)
        return jsonResponse(item || null)
      }

      if (method === 'POST') {
        const row = { id: `portfolio-${state.portfolio.length + 1}`, ...body }
        state.portfolio.push(row)
        return jsonResponse({ id: row.id }, 201)
      }

      if (method === 'PATCH') {
        const id = parseEq(url.searchParams.get('id'))
        const item = state.portfolio.find((entry) => entry.id === id)
        Object.assign(item, body)
        return jsonResponse({ id: item.id })
      }
      break
    }

    default:
      break
  }

  throw new Error(`Unhandled fetch in tenant-imports test: ${method} ${request.url}`)
}

test('tenant-imports executes external seed.json import with mocked fetch', async () => {
  const state = {
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      tenant_id: 'tenant-1',
    },
    jobs: [],
    sources: [],
    mappings: [],
    artifacts: [],
    pages: [],
    templateParts: [],
    widgets: [],
    blogs: [],
    services: [],
    teams: [],
    testimonies: [],
    portfolio: [],
    importAudit: [],
    accessAudit: [],
  }

  const originalFetch = globalThis.fetch
  globalThis.fetch = createTenantImportFetch(state)

  try {
    const response = await app.fetch(new Request('https://edge.example.com/functions/v1/tenant-imports', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'create-job',
        tenantId: 'tenant-1',
        importType: 'seed',
        templateSlug: 'blog',
        dryRun: false,
        parameters: {
          source_system: 'emdash',
        },
        source: {
          sourceKey: 'blog:remote-seed',
          sourceKind: 'seed',
          sourceLocator: 'https://seed.example.com/emdash/blog/seed.json',
          sourceVersion: 'remote-v2',
        },
      }),
    }), tenantImportsEnv)

    assert.equal(response.status, 200)
    const payload = await response.json()

    assert.equal(payload.ok, true)
    assert.equal(payload.job.status, 'succeeded')
    assert.equal(payload.job.result_summary.source_mode, 'external_seed_json')
    assert.equal(payload.job.result_summary.imported_counts.blogs, 1)
    assert.equal(payload.job.result_summary.imported_counts.pages, 1)
    assert.equal(state.pages.length, 1)
    assert.equal(state.blogs.length, 1)
    assert.equal(state.templateParts.length, 1)
    assert.equal(state.widgets.length, 1)
    assert.equal(state.sources[0].source_locator, 'https://seed.example.com/emdash/blog/seed.json')
    assert.equal(state.artifacts.find((item) => item.artifact_kind === 'seed')?.artifact_payload?.source_mode, 'external_seed_json')
    assert.equal(state.mappings.length, 4)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('tenant-imports executes marketing seed import with mocked fetch', async () => {
  const state = {
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      tenant_id: 'tenant-1',
    },
    jobs: [],
    sources: [],
    mappings: [],
    artifacts: [],
    pages: [],
    templateParts: [],
    widgets: [],
    blogs: [],
    services: [],
    teams: [],
    testimonies: [],
    portfolio: [],
    importAudit: [],
    accessAudit: [],
  }

  const originalFetch = globalThis.fetch
  globalThis.fetch = createTenantImportFetch(state)

  try {
    const response = await app.fetch(new Request('https://edge.example.com/functions/v1/tenant-imports', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'create-job',
        tenantId: 'tenant-1',
        importType: 'seed',
        templateSlug: 'marketing',
        dryRun: false,
        parameters: {
          source_system: 'emdash',
        },
        source: {
          sourceKey: 'marketing:remote-seed',
          sourceKind: 'seed',
          sourceLocator: 'https://marketing.example.com/emdash/marketing/seed.json',
          sourceVersion: 'marketing-v1',
        },
      }),
    }), tenantImportsEnv)

    assert.equal(response.status, 200)
    const payload = await response.json()

    assert.equal(payload.ok, true)
    assert.equal(payload.job.status, 'succeeded')
    assert.equal(payload.job.result_summary.source_mode, 'external_seed_json')
    assert.equal(payload.job.result_summary.imported_counts.marketing_pages, 1)
    assert.equal(payload.job.result_summary.imported_counts.services, 1)
    assert.equal(payload.job.result_summary.imported_counts.team_members, 1)
    assert.equal(payload.job.result_summary.imported_counts.testimonies, 1)
    assert.equal(state.pages.length, 1)
    assert.equal(state.services.length, 1)
    assert.equal(state.teams.length, 1)
    assert.equal(state.testimonies.length, 1)
    assert.equal(state.blogs.length, 0)
    assert.equal(state.artifacts.find((item) => item.artifact_kind === 'marketing_snapshot')?.artifact_payload?.services?.length, 1)
    assert.equal(state.mappings.length, 4)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('tenant-imports executes portfolio seed import with mocked fetch', async () => {
  const state = {
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      tenant_id: 'tenant-1',
    },
    jobs: [],
    sources: [],
    mappings: [],
    artifacts: [],
    pages: [],
    templateParts: [],
    widgets: [],
    blogs: [],
    services: [],
    teams: [],
    testimonies: [],
    portfolio: [],
    importAudit: [],
    accessAudit: [],
  }

  const originalFetch = globalThis.fetch
  globalThis.fetch = createTenantImportFetch(state)

  try {
    const response = await app.fetch(new Request('https://edge.example.com/functions/v1/tenant-imports', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'create-job',
        tenantId: 'tenant-1',
        importType: 'seed',
        templateSlug: 'portfolio',
        dryRun: false,
        parameters: {
          source_system: 'emdash',
        },
        source: {
          sourceKey: 'portfolio:remote-seed',
          sourceKind: 'seed',
          sourceLocator: 'https://portfolio.example.com/emdash/portfolio/seed.json',
          sourceVersion: 'portfolio-v1',
        },
      }),
    }), tenantImportsEnv)

    assert.equal(response.status, 200)
    const payload = await response.json()

    assert.equal(payload.ok, true)
    assert.equal(payload.job.status, 'succeeded')
    assert.equal(payload.job.result_summary.source_mode, 'external_seed_json')
    assert.equal(payload.job.result_summary.imported_counts.portfolio_items, 1)
    assert.equal(state.portfolio.length, 1)
    assert.equal(state.blogs.length, 0)
    assert.equal(state.pages.length, 0)
    assert.equal(state.artifacts.find((item) => item.artifact_kind === 'portfolio_snapshot')?.artifact_payload?.items?.length, 1)
    assert.equal(state.mappings.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})
