export type Boundary = 'public' | 'admin' | 'internal'
export type Scope = 'public' | 'tenant' | 'platform'
export type TenantContextRequirement = 'required' | 'optional' | 'none'
export type SecuritySchemeName = 'supabaseBearerAuth' | 'secretHeaderAuth'
export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

export type RouteDoc = {
  boundary: Boundary
  method: HttpMethod
  path: string
  operationId: string
  summary: string
  description: string
  tags: string[]
  scope: Scope
  permission?: string
  tenantContext: TenantContextRequirement
  r2: boolean
  softDeleteAware: boolean
  security?: SecuritySchemeName[]
  deprecated?: boolean
  parameters?: Array<Record<string, unknown>>
  requestBody?: Record<string, unknown>
  responses: Record<string, unknown>
}
