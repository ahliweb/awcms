import { OPENAPI_ROUTE_CATALOG } from './route-catalog'
import { OPENAPI_TAGS } from './tags'
import { createServers } from './servers'
import { getSecuritySchemesForBoundary } from './security'
import type { Boundary, RouteDoc } from './visibility'

const SPEC_TITLES: Record<Boundary, string> = {
  public: 'AWCMS Edge Public API',
  admin: 'AWCMS Edge Admin API',
  internal: 'AWCMS Edge Internal API',
}

const SPEC_DESCRIPTIONS: Record<Boundary, string> = {
  public: 'Public awcms-edge routes only. OpenAPI is descriptive only; Supabase Auth, RLS, and ABAC remain authoritative.',
  admin: 'Authenticated awcms-edge admin routes only. OpenAPI is descriptive only and does not replace Supabase Auth, RLS, or ABAC.',
  internal: 'Internal and maintenance awcms-edge routes for artifact generation only. This spec is not exposed at runtime.',
}

const buildOperationObject = (route: RouteDoc) => {
  const operation: Record<string, unknown> = {
    operationId: route.operationId,
    tags: route.tags,
    summary: route.summary,
    description: route.description,
    deprecated: route.deprecated || false,
    parameters: route.parameters,
    requestBody: route.requestBody,
    responses: route.responses,
    'x-awcms-boundary': route.boundary,
    'x-awcms-scope': route.scope,
    'x-awcms-tenant-context': route.tenantContext,
    'x-awcms-r2': route.r2,
    'x-awcms-soft-delete-aware': route.softDeleteAware,
  }

  if (route.permission) {
    operation['x-awcms-permission'] = route.permission
  }

  if (route.security?.length) {
    operation.security = route.security.map((scheme) => ({ [scheme]: [] }))
  }

  return operation
}

export const getRoutesForBoundary = (boundary: Boundary) => {
  return OPENAPI_ROUTE_CATALOG.filter((route) => route.boundary === boundary)
}

export const buildBoundarySpec = (boundary: Boundary, origin?: string) => {
  const routes = getRoutesForBoundary(boundary)
  const paths: Record<string, Record<string, unknown>> = {}

  for (const route of routes) {
    paths[route.path] ||= {}
    paths[route.path][route.method] = buildOperationObject(route)
  }

  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: SPEC_TITLES[boundary],
      version: '1.0.0',
      description: SPEC_DESCRIPTIONS[boundary],
    },
    servers: createServers(origin),
    tags: OPENAPI_TAGS,
    components: {
      securitySchemes: getSecuritySchemesForBoundary(boundary),
    },
    paths,
  }
}
