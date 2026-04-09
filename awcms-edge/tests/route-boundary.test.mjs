import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/index.ts'

const withStubbedFetch = async (handler) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Invalid JWT' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })

  try {
    return await handler()
  } finally {
    globalThis.fetch = originalFetch
  }
}

const withAuthenticatedFetch = async (handler) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'tester@example.com',
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

  try {
    return await handler()
  } finally {
    globalThis.fetch = originalFetch
  }
}

const withMismatchedPublicTenantFetch = async (handler) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(String(input), init)
    const url = new URL(request.url)

    if (url.pathname.endsWith('/rest/v1/tenants')) {
      return new Response(JSON.stringify({
        id: 'tenant-a',
        domain: 'tenant-a.example.com',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname.endsWith('/rest/v1/rpc/get_tenant_by_domain')) {
      return new Response(JSON.stringify({
        id: 'tenant-b',
        domain: 'tenant-b.example.com',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: `Unhandled fetch: ${url.pathname}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    return await handler()
  } finally {
    globalThis.fetch = originalFetch
  }
}

const authOnlyEnv = {
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
}

const adminClientEnv = {
  ...authOnlyEnv,
  SUPABASE_SECRET_KEY: 'test-secret-key',
}

test('content-transform rejects anonymous requests', async () => {
  const response = await app.request('/functions/v1/content-transform', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blog_id: '123', transformed: { blocks: [] } }),
  })

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { error: 'Unauthorized' })
})

test('get-client-ip rejects anonymous requests', async () => {
  const response = await app.request('/functions/v1/get-client-ip', {
    method: 'POST',
  })

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { error: 'Unauthorized' })
})

test('extensions events health rejects anonymous requests', async () => {
  const response = await app.request('/functions/v1/extensions/events/health?tenantId=test-tenant', {
    method: 'GET',
  })

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { error: 'Unauthorized' })
})

test('public sitemap rejects missing tenant context', async () => {
  const response = await app.request('/public/sitemap', {
    method: 'GET',
  })

  assert.equal(response.status, 404)
  assert.match(await response.text(), /Tenant not found/)
})

test('extensions public route rejects missing tenant context', async () => {
  const response = await app.request('/functions/v1/extensions/events/public', {
    method: 'GET',
  })

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'Missing tenantId or domain' })
})

test('public modules route rejects missing tenant context', async () => {
  const response = await app.request('/functions/v1/extensions/public-modules', {
    method: 'GET',
  })

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'Missing tenantId or domain' })
})

test('public sitemap rejects mismatched tenant and domain context', async () => {
  const response = await withMismatchedPublicTenantFetch(() => app.fetch(new Request('https://edge.example.com/public/sitemap?tenant_id=tenant-a&domain=tenant-b.example.com', {
    method: 'GET',
  }), adminClientEnv))

  assert.equal(response.status, 400)
  assert.match(await response.text(), /Tenant\/domain mismatch/)
})

test('extensions public route rejects mismatched tenant and domain context', async () => {
  const response = await withMismatchedPublicTenantFetch(() => app.fetch(new Request('https://edge.example.com/functions/v1/extensions/events/public?tenantId=tenant-a&domain=tenant-b.example.com', {
    method: 'GET',
  }), adminClientEnv))

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'Tenant/domain mismatch' })
})

test('public modules route rejects mismatched tenant and domain context', async () => {
  const response = await withMismatchedPublicTenantFetch(() => app.fetch(new Request('https://edge.example.com/functions/v1/extensions/public-modules?tenantId=tenant-a&domain=tenant-b.example.com', {
    method: 'GET',
  }), adminClientEnv))

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'Tenant/domain mismatch' })
})

test('mailketing-webhook rejects invalid JSON', async () => {
  const response = await app.request('/functions/v1/mailketing-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid',
  })

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'Invalid JSON body' })
})

test('mailketing send rejects anonymous requests', async () => {
  const response = await app.request('/functions/v1/mailketing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'send',
      recipient: 'person@example.com',
      subject: 'Hello',
      content: 'World',
    }),
  })

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { error: 'Unauthorized' })
})

test('mailketing send rejects invalid bearer token', async () => {
  const response = await withStubbedFetch(() => app.fetch(new Request('https://edge.example.com/functions/v1/mailketing', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer invalid-token',
      'Content-Type': 'application/json',
      'x-tenant-id': 'tenant-123',
    },
    body: JSON.stringify({
      action: 'send',
      recipient: 'person@example.com',
      subject: 'Hello',
      content: 'World',
    }),
  }), authOnlyEnv))

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { error: 'Unauthorized' })
})

test('verify-turnstile rejects invalid JSON with success false envelope', async () => {
  const response = await app.request('/functions/v1/verify-turnstile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid',
  })

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { success: false, error: 'Invalid JSON body' })
})

test('queue replay rejects anonymous requests', async () => {
  const response = await app.request('/api/admin/queue/replay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'dead-letter-id' }),
  })

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { error: 'Missing or invalid authorization header' })
})

test('get-client-ip rejects invalid bearer token', async () => {
  const response = await withStubbedFetch(() => app.fetch(new Request('https://edge.example.com/functions/v1/get-client-ip', {
    method: 'POST',
    headers: { Authorization: 'Bearer invalid-token' },
  }), authOnlyEnv))

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { error: 'Unauthorized' })
})

test('extensions events health rejects invalid bearer token', async () => {
  const response = await withStubbedFetch(() => app.fetch(new Request('https://edge.example.com/functions/v1/extensions/events/health?tenantId=test-tenant', {
    method: 'GET',
    headers: { Authorization: 'Bearer invalid-token' },
  }), authOnlyEnv))

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { error: 'Unauthorized' })
})

test('extensions lifecycle rejects authenticated request with missing action', async () => {
  const response = await withAuthenticatedFetch(() => app.fetch(new Request('https://edge.example.com/functions/v1/extensions-lifecycle', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer valid-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  }), authOnlyEnv))

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'Missing lifecycle action' })
})

test('extensions lifecycle rejects authenticated request with invalid JSON', async () => {
  const response = await withAuthenticatedFetch(() => app.fetch(new Request('https://edge.example.com/functions/v1/extensions-lifecycle', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer valid-token',
      'Content-Type': 'application/json',
    },
    body: '{invalid',
  }), authOnlyEnv))

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'Invalid JSON body' })
})

test('manage-users rejects invalid JSON before auth branching', async () => {
  const response = await app.fetch(new Request('https://edge.example.com/functions/v1/manage-users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid',
  }), adminClientEnv)

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'Invalid JSON body' })
})
