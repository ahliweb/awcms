import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/index.ts'

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

const authOnlyEnv = {
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
  SUPABASE_SECRET_KEY: 'test-secret-key',
}

test('site-blueprints rejects anonymous requests', async () => {
  const response = await app.request('/functions/v1/site-blueprints', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'apply', blueprintId: 'bp-1', tenantId: 'tenant-1' }),
  })

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { error: 'Unauthorized' })
})

test('site-blueprints rejects authenticated request with unsupported action', async () => {
  const response = await withAuthenticatedFetch(() => app.fetch(new Request('https://edge.example.com/functions/v1/site-blueprints', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer valid-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'noop' }),
  }), authOnlyEnv))

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'Unsupported action' })
})

test('site-blueprints rejects authenticated apply request without blueprintId', async () => {
  const response = await withAuthenticatedFetch(() => app.fetch(new Request('https://edge.example.com/functions/v1/site-blueprints', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer valid-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'apply', tenantId: 'tenant-1' }),
  }), authOnlyEnv))

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'Missing blueprintId' })
})
