import test from 'node:test'
import assert from 'node:assert/strict'
import { HTTPException } from 'hono/http-exception'
import { getJsonBody, requireJsonBody, requireString, handleRouteError } from '../src/lib/http.ts'

test('getJsonBody returns null for invalid JSON', async () => {
  const request = new Request('https://edge.example.com/test', {
    method: 'POST',
    body: '{invalid',
    headers: { 'Content-Type': 'application/json' },
  })

  const body = await getJsonBody(request)
  assert.equal(body, null)
})

test('requireJsonBody throws HTTPException for invalid JSON', async () => {
  const request = new Request('https://edge.example.com/test', {
    method: 'POST',
    body: '{invalid',
    headers: { 'Content-Type': 'application/json' },
  })

  await assert.rejects(
    () => requireJsonBody(request),
    (error) => error instanceof HTTPException && error.status === 400,
  )
})

test('requireString trims valid strings and rejects blank values', () => {
  assert.equal(requireString('  hello  ', 'missing'), 'hello')
  assert.throws(
    () => requireString('   ', 'missing'),
    (error) => error instanceof HTTPException && error.status === 400,
  )
})

test('handleRouteError normalizes HTTPException and fallback errors', async () => {
  const responses = []
  const c = {
    json(payload, status) {
      responses.push({ payload, status })
      return { payload, status }
    },
  }

  const httpResult = handleRouteError(c, new HTTPException(403, { message: 'Forbidden' }), 'fallback')
  assert.deepEqual(httpResult, { payload: { error: 'Forbidden' }, status: 403 })

  const originalConsoleError = console.error
  console.error = () => {}
  try {
    const fallbackResult = handleRouteError(c, new Error('raw details'), 'Fallback failure', 500)
    assert.deepEqual(fallbackResult, { payload: { error: 'Fallback failure' }, status: 500 })
    assert.equal(responses.length, 2)
  } finally {
    console.error = originalConsoleError
  }
})
