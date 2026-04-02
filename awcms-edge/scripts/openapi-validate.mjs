import { generatePublicOpenApi } from '../src/docs/generators/public.ts'
import { generateAdminOpenApi } from '../src/docs/generators/admin.ts'
import { generateInternalOpenApi } from '../src/docs/generators/internal.ts'

const specs = {
  public: generatePublicOpenApi('https://edge.example.com'),
  admin: generateAdminOpenApi('https://edge.example.com'),
  internal: generateInternalOpenApi('https://edge.example.com'),
}

const getOperations = (spec) => {
  const operations = []
  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      operations.push({ path, method, operation })
    }
  }
  return operations
}

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message)
  }
}

for (const [name, spec] of Object.entries(specs)) {
  assert(spec.openapi === '3.1.0', `${name} spec must declare OpenAPI 3.1.0`)
}

for (const entry of getOperations(specs.public)) {
  assert(entry.operation['x-awcms-boundary'] === 'public', `public spec leaked non-public route: ${entry.method.toUpperCase()} ${entry.path}`)
}

for (const entry of getOperations(specs.admin)) {
  assert(entry.operation['x-awcms-boundary'] === 'admin', `admin spec leaked non-admin route: ${entry.method.toUpperCase()} ${entry.path}`)
}

for (const entry of [...getOperations(specs.admin), ...getOperations(specs.internal)]) {
  assert(entry.operation['x-awcms-scope'], `missing x-awcms-scope for ${entry.method.toUpperCase()} ${entry.path}`)
  assert(entry.operation['x-awcms-boundary'], `missing x-awcms-boundary for ${entry.method.toUpperCase()} ${entry.path}`)
}

for (const entry of [...getOperations(specs.public), ...getOperations(specs.admin), ...getOperations(specs.internal)]) {
  const tenantContext = entry.operation['x-awcms-tenant-context']
  assert(['required', 'optional', 'none'].includes(tenantContext), `invalid tenant context metadata for ${entry.method.toUpperCase()} ${entry.path}`)
}

for (const entry of getOperations(specs.admin)) {
  const isMutation = ['post', 'put', 'patch', 'delete'].includes(entry.method)
  if (isMutation) {
    assert(entry.operation['x-awcms-permission'], `admin mutation missing x-awcms-permission: ${entry.method.toUpperCase()} ${entry.path}`)
  }
}

for (const entry of getOperations(specs.admin)) {
  assert(Array.isArray(entry.operation.security) && entry.operation.security.length > 0, `admin route missing security requirement: ${entry.method.toUpperCase()} ${entry.path}`)
}

const publicSchemes = Object.keys(specs.public.components?.securitySchemes || {})
const adminSchemes = Object.keys(specs.admin.components?.securitySchemes || {})
assert(!publicSchemes.some((name) => name.toLowerCase().includes('secret') || name.toLowerCase().includes('service')), 'public spec must not expose internal/service auth schemes')
assert(!adminSchemes.some((name) => name.toLowerCase().includes('secret') || name.toLowerCase().includes('service')), 'admin spec must not expose internal/service auth schemes')

console.log('openapi validation ok')
