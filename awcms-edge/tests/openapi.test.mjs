import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/index.ts'
import { generatePublicOpenApi } from '../src/docs/generators/public.ts'
import { generateAdminOpenApi } from '../src/docs/generators/admin.ts'
import { generateInternalOpenApi } from '../src/docs/generators/internal.ts'

const getOperations = (spec) => {
  const operations = []
  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      operations.push({ path, method, operation })
    }
  }
  return operations
}

test('public spec contains only public routes', () => {
  const spec = generatePublicOpenApi('https://edge.example.com')
  for (const entry of getOperations(spec)) {
    assert.equal(entry.operation['x-awcms-boundary'], 'public')
  }
})

test('admin spec contains only admin routes', () => {
  const spec = generateAdminOpenApi('https://edge.example.com')
  for (const entry of getOperations(spec)) {
    assert.equal(entry.operation['x-awcms-boundary'], 'admin')
    assert.ok(Array.isArray(entry.operation.security) && entry.operation.security.length > 0)
  }
})

test('internal spec is generated separately', () => {
  const spec = generateInternalOpenApi('https://edge.example.com')
  assert.ok(Object.keys(spec.paths).length > 0)
  for (const entry of getOperations(spec)) {
    assert.equal(entry.operation['x-awcms-boundary'], 'internal')
  }
})

test('tenant-sensitive operations declare tenant metadata', () => {
  const specs = [generatePublicOpenApi(), generateAdminOpenApi(), generateInternalOpenApi()]
  for (const spec of specs) {
    for (const entry of getOperations(spec)) {
      assert.ok(['required', 'optional', 'none'].includes(entry.operation['x-awcms-tenant-context']))
    }
  }
})

test('admin mutation routes declare permission metadata', () => {
  const spec = generateAdminOpenApi()
  for (const entry of getOperations(spec)) {
    if (['post', 'put', 'patch', 'delete'].includes(entry.method)) {
      assert.ok(entry.operation['x-awcms-permission'])
    }
  }
})

test('public and admin specs do not expose service-role schemes', () => {
  const publicSchemes = Object.keys(generatePublicOpenApi().components.securitySchemes || {})
  const adminSchemes = Object.keys(generateAdminOpenApi().components.securitySchemes || {})
  assert.equal(publicSchemes.includes('secretHeaderAuth'), false)
  assert.equal(adminSchemes.includes('secretHeaderAuth'), false)
})

test('public docs route is available', async () => {
  const response = await app.request('/docs')
  assert.equal(response.status, 200)
})

test('admin docs route is not accessible anonymously', async () => {
  const response = await app.request('/docs/admin')
  assert.equal(response.status, 401)
})

test('admin spec route is not accessible anonymously', async () => {
  const response = await app.request('/openapi/admin.json')
  assert.equal(response.status, 401)
})

test('internal docs routes are not exposed at runtime', async () => {
  const docsResponse = await app.request('/docs/internal')
  const specResponse = await app.request('/openapi/internal.json')
  assert.equal(docsResponse.status, 404)
  assert.equal(specResponse.status, 404)
})
