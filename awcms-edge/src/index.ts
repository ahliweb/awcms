import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { createClient } from '@supabase/supabase-js'
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { generatePublicOpenApi } from './docs/generators/public'
import { generateAdminOpenApi } from './docs/generators/admin'
import { renderPublicDocsUi } from './docs/ui/public'
import { renderAdminDocsUi } from './docs/ui/admin'
import { generateStorageKey, inferMediaKind, slugifyMediaValue, UploadSessionRequest } from './mediaContracts'
import { compareVersions, getExtensionKey, validateExtensionManifest } from './extensions'
import { AnyQueueMessage, buildEmailSendMessage, buildMediaFinalizeMessage, buildSiteRebuildMessage, isValidEnvelope, MEDIA_FINALIZE_EVENT, MEDIA_FINALIZE_SCHEMA } from './queues/contracts'
import { handleMediaFinalizeMessage, mediaQueueHandler } from './queues/mediaConsumer'
import { notificationsQueueHandler } from './queues/notificationsConsumer'
import { dlqQueueHandler } from './queues/dlqConsumer'
import { logReplay } from './queues/observability'
import { requireDocsAccess } from './middleware/docs/require-docs-access'
import type { AppEnv, Bindings, UserContext } from './lib/runtime-types'
import { getJsonBody, handleRouteError, requireJsonBody, requireString } from './lib/http'
import { requireBearerSession, resolveBearerOrServiceActor } from './lib/auth'
import { issueTenantRouteToken, resolveTenantRouteToken } from './lib/tenantRouteTokens'
import { getEmdashSeedTemplate, loadEmdashExternalSeedTemplate } from './lib/emdashSeedTemplates'

export const app = new Hono<AppEnv>()

// CORS: restrict to CORS_ALLOWED_ORIGINS binding when set; allow all in local dev (unset).
app.use('*', async (c, next) => {
  const rawOrigins = c.env?.CORS_ALLOWED_ORIGINS?.trim()
  const allowedOrigins = rawOrigins
    ? rawOrigins.split(',').map((o) => o.trim()).filter(Boolean)
    : null

  const requestOrigin = c.req.header('Origin') ?? ''

  let allowOrigin: string
  if (!allowedOrigins) {
    // No restriction configured — allow all (dev/unset)
    allowOrigin = '*'
  } else if (allowedOrigins.includes(requestOrigin)) {
    allowOrigin = requestOrigin
  } else {
    // Origin not in allowlist — reject preflight immediately
    if (c.req.method === 'OPTIONS') {
      return c.text('Forbidden', 403)
    }
    // For non-preflight requests, omit Allow-Origin header (browser will block)
    allowOrigin = ''
  }

  const corsMiddleware = cors({
    origin: allowOrigin || requestOrigin,
    allowHeaders: ['Authorization', 'Content-Type', 'x-tenant-id'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['Content-Length'],
    maxAge: 600,
    credentials: true,
  })
  return corsMiddleware(c, next)
})

app.get('/health', (c) => c.json({ ok: true, service: 'awcms-edge' }))

app.get('/openapi/public.json', (c) => {
  const origin = new URL(c.req.url).origin
  return c.json(generatePublicOpenApi(origin), 200)
})

app.get('/docs', (c) => {
  return renderPublicDocsUi(c)
})

app.get('/openapi/admin.json', requireDocsAccess(), (c) => {
  const origin = new URL(c.req.url).origin
  return c.json(generateAdminOpenApi(origin), 200)
})

app.get('/docs/admin', requireDocsAccess(), (c) => {
  return renderAdminDocsUi(c)
})

const getAuthedSupabase = (env: Bindings, token: string) => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  global: { headers: { Authorization: `Bearer ${token}` } }
})

const getAdminSupabase = (env: Bindings) => createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY)

const getR2S3Client = (env: Bindings) => new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
})

const headStoredObject = async (
  env: Bindings,
  storageKey: string,
): Promise<{ ContentLength?: number; ETag?: string } | null> => {
  if (env.R2_ACCOUNT_ID === 'local-dev') {
    if (!env.STORAGE) return null
    const obj = await env.STORAGE.head(storageKey)
    if (!obj) return null
    return { ContentLength: obj.size, ETag: obj.etag }
  }
  const client = getR2S3Client(env)
  return client.send(new HeadObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: storageKey,
  }))
}

const getStoredObject = async (
  env: Bindings,
  storageKey: string,
): Promise<{ Body?: ReadableStream | null; ContentType?: string; ETag?: string } | null> => {
  if (env.R2_ACCOUNT_ID === 'local-dev') {
    if (!env.STORAGE) return null
    const obj = await env.STORAGE.get(storageKey)
    if (!obj) return null
    return {
      Body: obj.body as ReadableStream,
      ContentType: obj.httpMetadata?.contentType,
      ETag: obj.etag,
    }
  }
  const client = getR2S3Client(env)
  return client.send(new GetObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: storageKey,
  }))
}

const ensureR2SigningConfig = (env: Bindings) => {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET_NAME) {
    throw new Error('Missing R2 signing configuration')
  }
}

const sanitizeFolder = (folder?: string) => String(folder || '')
  .trim()
  .replace(/(^\/|\/$)/g, '')
  .replace(/[^a-zA-Z0-9/_-]/g, '')

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const decodeJwtClaims = (token: string) => {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
    return JSON.parse(decoded) as { iat?: number; exp?: number }
  } catch {
    return null
  }
}

const getSessionBoundAccessWindowSeconds = (env: Bindings, token: string, requestedMaxAgeSeconds?: number | null) => {
  const claims = decodeJwtClaims(token)
  const now = Math.floor(Date.now() / 1000)
  const configuredMaxAge = parsePositiveInt(env.MEDIA_SECURE_SESSION_MAX_AGE_SECONDS, 900)
  const requestedMaxAge = requestedMaxAgeSeconds && requestedMaxAgeSeconds > 0
    ? Math.min(requestedMaxAgeSeconds, configuredMaxAge)
    : configuredMaxAge

  const sessionRemaining = claims?.exp ? claims.exp - now : 0
  const loginWindowRemaining = claims?.iat ? (claims.iat + requestedMaxAge) - now : requestedMaxAge
  const expiresIn = Math.max(0, Math.min(sessionRemaining, loginWindowRemaining))

  return {
    expiresIn,
    expiresAt: new Date((now + expiresIn) * 1000).toISOString(),
  }
}

const getRequestIp = (request: Request) => {
  return request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || null
}

const buildStorageKey = (tenantId: string, fileName: string, folder?: string, sessionBoundAccess = false) => {
  const baseKey = generateStorageKey(tenantId, fileName, sessionBoundAccess)
  const normalizedFolder = sanitizeFolder(folder)

  if (!normalizedFolder) return baseKey

  const [tenantPrefix, fileKey] = baseKey.split(/\/(.+)/)
  return `${tenantPrefix}/${normalizedFolder}/${fileKey}`
}

const buildMediaSlug = (fileName: string, sessionId: string) => {
  const base = slugifyMediaValue(fileName) || 'media-item'
  return `${base}-${sessionId.slice(0, 8)}`
}

const buildPublicMediaUrl = (requestUrl: string, storageKey: string) => {
  const encodedKey = String(storageKey || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return new URL(`/public/media/${encodedKey}`, requestUrl).toString()
}

const getUserContext = async (env: Bindings, userId: string): Promise<UserContext> => {
  const adminSupabase = getAdminSupabase(env)
  const { data, error } = await adminSupabase
    .from('users')
    .select('id, tenant_id, role:roles!users_role_id_fkey(is_platform_admin, is_full_access)')
    .eq('id', userId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error || !data) {
    throw new Error('Unable to resolve user tenant context')
  }

  const role = Array.isArray(data.role) ? data.role[0] : data.role
  return {
    id: data.id,
    tenantId: data.tenant_id,
    isPlatformAdmin: Boolean(role?.is_platform_admin),
    isFullAccess: Boolean(role?.is_full_access),
  }
}

const resolveTenantId = (requestedTenantId: string | null, userContext: { tenantId: string | null; isPlatformAdmin: boolean; isFullAccess: boolean }) => {
  if (userContext.isPlatformAdmin || userContext.isFullAccess) {
    return requestedTenantId || userContext.tenantId
  }

  if (!userContext.tenantId) {
    throw new Error('Missing tenant context')
  }

  if (requestedTenantId && requestedTenantId !== userContext.tenantId) {
    throw new Error('Tenant mismatch')
  }

  return userContext.tenantId
}

const hasAnyPermission = async (userSupabase: any, permissionNames: string[]) => {
  for (const permissionName of permissionNames) {
    const { data, error } = await userSupabase.rpc('has_permission', { permission_name: permissionName })
    if (!error && data) return true
  }
  return false
}

const resolveAssignableRole = async (adminSupabase: any, params: {
  roleId?: string | null
  tenantId?: string | null
  allowPlatformRole: boolean
}) => {
  const { roleId, tenantId, allowPlatformRole } = params

  let query = adminSupabase
    .from('roles')
    .select('id, name, tenant_id, scope, is_platform_admin, is_full_access, is_tenant_admin')
    .is('deleted_at', null)

  if (roleId) {
    query = query.eq('id', roleId)
  } else if (tenantId) {
    query = query.eq('tenant_id', tenantId).eq('name', 'admin')
  } else {
    query = query.is('tenant_id', null).eq('name', 'platform_admin')
  }

  const { data, error } = await query.order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (error || !data) {
    throw new Error('Assignable role not found')
  }

  const isPlatformRole = Boolean(data.is_platform_admin || data.is_full_access || data.scope === 'platform' || data.tenant_id === null)
  if (isPlatformRole && !allowPlatformRole) {
    throw new Error('Platform roles can only be assigned by platform admins')
  }

  if (!isPlatformRole && tenantId && data.tenant_id !== tenantId) {
    throw new Error('Role does not belong to the target tenant')
  }

  return data
}

const ensureManagedUserProfile = async (adminSupabase: any, payload: {
  authUserId: string
  email: string
  fullName?: string | null
  tenantId?: string | null
  roleId?: string | null
}) => {
  const { data: existingUser } = await adminSupabase
    .from('users')
    .select('id')
    .eq('id', payload.authUserId)
    .maybeSingle()

  const nextPayload: Record<string, unknown> = {
    id: payload.authUserId,
    email: payload.email,
    full_name: payload.fullName || null,
    tenant_id: payload.tenantId || null,
    role_id: payload.roleId || null,
    deleted_at: null,
    updated_at: new Date().toISOString(),
  }

  if (existingUser?.id) {
    const { error } = await adminSupabase
      .from('users')
      .update(nextPayload)
      .eq('id', payload.authUserId)
    if (error) throw error
    return
  }

  const { error } = await adminSupabase
    .from('users')
    .insert({
      ...nextPayload,
      created_at: new Date().toISOString(),
    })
  if (error) throw error
}

const provisionManagedUser = async (adminSupabase: any, params: {
  mode: 'create' | 'invite'
  email: string
  password?: string | null
  fullName?: string | null
  tenantId?: string | null
  roleId?: string | null
  allowPlatformRole: boolean
}) => {
  const assignableRole = await resolveAssignableRole(adminSupabase, {
    roleId: params.roleId || null,
    tenantId: params.tenantId || null,
    allowPlatformRole: params.allowPlatformRole,
  })

  const userMetadata = {
    full_name: params.fullName,
    tenant_id: params.tenantId || null,
    role_id: assignableRole.id,
  }

  const authOperation = params.mode === 'create'
    ? await adminSupabase.auth.admin.createUser({
      email: params.email,
      password: params.password,
      email_confirm: true,
      user_metadata: userMetadata,
    })
    : await adminSupabase.auth.admin.inviteUserByEmail(params.email, {
      data: userMetadata,
    })

  if (authOperation.error || !authOperation.data?.user) {
    const fallback = params.mode === 'create' ? 'Failed to create user' : 'Failed to invite user'
    throw new Error(authOperation.error?.message || fallback)
  }

  await ensureManagedUserProfile(adminSupabase, {
    authUserId: authOperation.data.user.id,
    email: params.email,
    fullName: params.fullName,
    tenantId: params.tenantId || null,
    roleId: assignableRole.id,
  })

  return {
    user: authOperation.data.user,
    roleId: assignableRole.id,
  }
}

const enforceRequestedTenantScope = (params: {
  isSuperAdmin: boolean
  requesterTenantId?: string | null
  requestedTenantId?: string | null
  mismatchMessage: string
}) => {
  if (params.isSuperAdmin) {
    return params.requestedTenantId || null
  }

  if (!params.requesterTenantId) {
    throw new HTTPException(403, { message: 'Forbidden: no tenant context' })
  }

  if (params.requestedTenantId && params.requestedTenantId !== params.requesterTenantId) {
    throw new HTTPException(403, { message: params.mismatchMessage })
  }

  return params.requesterTenantId
}

const enforceOwnedTargetTenant = (params: {
  isSuperAdmin: boolean
  requesterTenantId?: string | null
  targetTenantId?: string | null
  message?: string
}) => {
  if (params.isSuperAdmin) return
  if (params.targetTenantId && params.targetTenantId !== params.requesterTenantId) {
    throw new HTTPException(403, { message: params.message || 'Forbidden' })
  }
}

const loadAccountRequest = async (adminSupabase: any, requestId: string, select = '*') => {
  const { data } = await adminSupabase
    .from('account_requests')
    .select(select)
    .eq('id', requestId)
    .single()

  return data || null
}

const enforceAccountRequestAccess = (params: {
  isSuperAdmin: boolean
  requesterTenantId?: string | null
  accountRequest?: { tenant_id?: string | null } | null
}) => {
  enforceOwnedTargetTenant({
    isSuperAdmin: params.isSuperAdmin,
    requesterTenantId: params.requesterTenantId,
    targetTenantId: params.accountRequest?.tenant_id,
  })
}

const loadTenantExtensionForLifecycle = async (params: {
  adminSupabase: any
  tenantExtensionId: string
  requestedTenantId?: string | null
  userContext: UserContext
}) => {
  const { data: tenantExtension, error } = await params.adminSupabase
    .from('tenant_extensions')
    .select('*, catalog:platform_extension_catalog(*)')
    .eq('id', params.tenantExtensionId)
    .is('deleted_at', null)
    .single()

  if (error || !tenantExtension) {
    throw new HTTPException(404, { message: 'Tenant extension not found' })
  }

  const tenantId = resolveTenantId(params.requestedTenantId || tenantExtension.tenant_id, params.userContext)
  if (!tenantId || tenantId !== tenantExtension.tenant_id) {
    throw new HTTPException(403, { message: 'Tenant mismatch' })
  }

  return {
    tenantExtension,
    catalog: Array.isArray(tenantExtension.catalog) ? tenantExtension.catalog[0] : tenantExtension.catalog,
    tenantId,
  }
}

const finalizeTenantExtensionLifecycle = async (params: {
  adminSupabase: any
  tenantId: string
  catalog: any
  tenantExtensionId: string
  actorUserId: string
  action: string
  request: Request
  startedAt: number
  metadata?: Record<string, unknown>
}) => {
  const extensionKey = params.catalog
    ? `${params.catalog.vendor}/${params.catalog.slug}`
    : params.tenantExtensionId

  await writeExtensionAudit(params.adminSupabase, {
    tenantId: params.tenantId,
    catalogId: params.catalog?.id,
    tenantExtensionId: params.tenantExtensionId,
    actorUserId: params.actorUserId,
    action: params.action,
    status: 'succeeded',
    metadata: {
      extensionKey,
      ...(params.metadata || {}),
    },
  })

  await writeAccessAudit(params.adminSupabase, {
    tenantId: params.tenantId,
    userId: params.actorUserId,
    action: 'extensions.lifecycle',
    resource: 'extension_lifecycle',
    details: {
      action: params.action,
      tenant_extension_id: params.tenantExtensionId,
      ...(params.catalog?.id ? { catalog_id: params.catalog.id } : {}),
    },
    ipAddress: getRequestIp(params.request),
    channel: 'worker',
    actorType: 'user',
    authContext: { has_session: true },
    moduleName: 'extensions',
    featureName: 'lifecycle',
    actionName: params.action,
    resourceType: 'tenant_extension',
    resourceId: params.tenantExtensionId,
    requestDurationMs: Date.now() - params.startedAt,
    routePath: '/functions/v1/extensions-lifecycle',
    url: params.request.url,
    userAgent: params.request.headers.get('user-agent') || null,
    purpose: 'manage extension lifecycle actions',
    triggerSource: 'awcms_edge_route',
    businessIntent: 'extension_runtime_management',
    accessChannel: 'worker',
    accessMechanism: 'worker_route',
    authMethod: 'bearer_token',
  })
}

const normalizeReasonCategories = (value: unknown) => {
  if (!Array.isArray(value)) return [] as string[]
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

const buildExtensionValidationSummary = (validation: ReturnType<typeof validateExtensionManifest>) => {
  const diagnostics = validation.diagnostics || {
    validationStatus: validation.valid ? 'valid' : 'invalid',
    runtimeMode: null,
    compatibilityStatus: 'unknown',
    reasonCategories: validation.valid ? [] : ['invalid_manifest'],
    invalidCapabilities: [],
    missingArtifacts: [],
    warnings: [],
  }

  const reasonCategories = normalizeReasonCategories(diagnostics.reasonCategories)

  return {
    validationStatus: diagnostics.validationStatus,
    runtimeMode: diagnostics.runtimeMode,
    compatibilityStatus: diagnostics.compatibilityStatus,
    reasonCategories,
    primaryReasonCategory: reasonCategories[0] || null,
    invalidCapabilities: Array.isArray(diagnostics.invalidCapabilities) ? diagnostics.invalidCapabilities : [],
    missingArtifacts: Array.isArray(diagnostics.missingArtifacts) ? diagnostics.missingArtifacts : [],
    warnings: Array.isArray(diagnostics.warnings) ? diagnostics.warnings : [],
    errors: validation.errors || [],
  }
}

const syncCatalogValidationState = async (params: {
  adminSupabase: any
  actorUserId: string
  payload: Record<string, unknown>
}) => {
  const { data, error } = await params.adminSupabase.rpc('sync_extension_catalog_validation_state', {
    p_slug: params.payload.slug,
    p_vendor: params.payload.vendor,
    p_name: params.payload.name,
    p_description: params.payload.description,
    p_version: params.payload.version,
    p_kind: params.payload.kind,
    p_scope: params.payload.scope,
    p_source: params.payload.source,
    p_package_path: params.payload.package_path,
    p_checksum: params.payload.checksum,
    p_status: params.payload.status,
    p_compatibility: params.payload.compatibility,
    p_capabilities: params.payload.capabilities,
    p_manifest: params.payload.manifest,
    p_runtime_mode: params.payload.runtime_mode,
    p_validation_status: params.payload.validation_status,
    p_validation_summary: params.payload.validation_summary,
    p_actor_user_id: params.actorUserId,
  })

  if (error || !data?.[0]) {
    throw new Error(error?.message || 'Catalog state sync failed')
  }

  return data[0]
}

const writeFailedExtensionLifecycleAudit = async (params: {
  adminSupabase: any
  actorUserId: string
  action: string
  tenantId?: string | null
  catalogId?: string | null
  tenantExtensionId?: string | null
  metadata?: Record<string, unknown>
}) => {
  await writeExtensionAudit(params.adminSupabase, {
    tenantId: params.tenantId,
    catalogId: params.catalogId,
    tenantExtensionId: params.tenantExtensionId,
    actorUserId: params.actorUserId,
    action: params.action,
    status: 'failed',
    metadata: params.metadata || {},
  })
}

const writeExtensionAudit = async (adminSupabase: any, payload: {
  tenantId?: string | null
  catalogId?: string | null
  tenantExtensionId?: string | null
  actorUserId: string
  action: string
  status: string
  metadata?: Record<string, unknown>
}) => {
  await adminSupabase.from('extension_lifecycle_audit').insert({
    tenant_id: payload.tenantId || null,
    catalog_id: payload.catalogId || null,
    tenant_extension_id: payload.tenantExtensionId || null,
    actor_user_id: payload.actorUserId,
    action: payload.action,
    status: payload.status,
    metadata: payload.metadata || {},
  })
}

const writeAccessAudit = async (adminSupabase: any, payload: {
  tenantId?: string | null
  userId?: string | null
  action?: string
  resource?: string
  details?: Record<string, unknown>
  ipAddress?: string | null
  channel?: string | null
  actorType?: string | null
  actorRole?: string | null
  authContext?: Record<string, unknown>
  moduleName?: string | null
  featureName?: string | null
  actionName?: string | null
  resourceType?: string | null
  resourceId?: string | null
  permissionKey?: string | null
  requestDurationMs?: number | null
  workspaceSource?: string | null
  routePath?: string | null
  url?: string | null
  userAgent?: string | null
  purpose?: string | null
  triggerSource?: string | null
  businessIntent?: string | null
  accessChannel?: string | null
  accessMechanism?: string | null
  authMethod?: string | null
}) => {
  await adminSupabase.rpc('log_access_event', {
    p_tenant_id: payload.tenantId || null,
    p_user_id: payload.userId || null,
    p_action: payload.action || 'access',
    p_resource: payload.resource || 'access',
    p_details: payload.details || {},
    p_ip_address: payload.ipAddress || null,
    p_channel: payload.channel || null,
    p_actor_type: payload.actorType || null,
    p_actor_role: payload.actorRole || null,
    p_auth_context: payload.authContext || {},
    p_module_name: payload.moduleName || null,
    p_feature_name: payload.featureName || null,
    p_action_name: payload.actionName || payload.action || 'access',
    p_resource_type: payload.resourceType || payload.resource || 'access',
    p_resource_id: payload.resourceId || null,
    p_permission_key: payload.permissionKey || null,
    p_server_timestamp: new Date().toISOString(),
    p_request_duration_ms: payload.requestDurationMs || null,
    p_workspace_source: payload.workspaceSource || 'awcms-edge',
    p_route_path: payload.routePath || null,
    p_url: payload.url || null,
    p_user_agent: payload.userAgent || null,
    p_purpose: payload.purpose || null,
    p_trigger_source: payload.triggerSource || null,
    p_business_intent: payload.businessIntent || null,
    p_access_channel: payload.accessChannel || payload.channel || 'api',
    p_access_mechanism: payload.accessMechanism || 'worker_route',
    p_auth_method: payload.authMethod || null,
  })
}

const getExtensionRouteSecret = (env: Bindings) => env.EXTENSION_ROUTE_SECRET || env.SUPABASE_SECRET_KEY

const normalizeExtensionRoutePath = (routePath: string, vendor: string, slug: string) => {
  const normalized = String(routePath || '').trim().replace(/^\/+/, '')
  const legacyPrefixes = [
    `functions/v1/ext/:tenantRoute/${vendor}/${slug}/`,
    `functions/v1/extensions/${vendor}/${slug}/`,
    `functions/v1/extensions/${slug}/`,
  ]

  for (const prefix of legacyPrefixes) {
    if (normalized.startsWith(prefix)) {
      return normalized.slice(prefix.length).replace(/^\/+|\/+$/g, '') || 'index'
    }
  }

  return normalized.replace(/^\/+|\/+$/g, '') || 'index'
}

const syncTenantExtensionRoutes = async (params: {
  adminSupabase: any
  tenantId: string
  catalog: any
  tenantExtensionId: string
  manifest: any
}) => {
  const routes = Array.isArray(params.manifest?.edgeRoutes) ? params.manifest.edgeRoutes : []
  await params.adminSupabase
    .from('tenant_extension_routes')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('tenant_extension_id', params.tenantExtensionId)

  for (const route of routes) {
    const routeMethod = String(route?.method || 'POST').toUpperCase()
    const routePath = normalizeExtensionRoutePath(String(route?.path || ''), params.catalog.vendor, params.catalog.slug)
    if (!routePath || !route?.capability) continue

    const routeKey = `${routeMethod}:${routePath}`
    const metadata = typeof route?.metadata === 'object' && route.metadata ? route.metadata : {}
    const resolvedMetadata = {
      ...metadata,
      original_path: route.path,
      handler:
        metadata.handler
        || (params.catalog.vendor === 'ahliweb' && params.catalog.slug === 'events' && routePath === 'health' ? 'events.health' : null)
        || (params.catalog.vendor === 'ahliweb' && params.catalog.slug === 'events' && routePath === 'public' ? 'events.public' : null),
    }

    await params.adminSupabase
      .from('tenant_extension_routes')
      .upsert({
        tenant_id: params.tenantId,
        catalog_id: params.catalog.id,
        tenant_extension_id: params.tenantExtensionId,
        vendor: params.catalog.vendor,
        extension_slug: params.catalog.slug,
        route_key: routeKey,
        route_path: routePath,
        route_method: routeMethod,
        visibility: route?.visibility === 'public' ? 'public' : 'authenticated',
        capability: route.capability,
        permission: typeof route?.permission === 'string' ? route.permission : null,
        metadata: resolvedMetadata,
        is_active: true,
        deleted_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_extension_id,route_key' })
  }
}

const slugifyImportValue = (value: string, fallback: string) => {
  const normalized = String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || fallback
}

const getTenantImportMapping = async (adminSupabase: any, params: {
  tenantId: string
  sourceKind: string
  sourceId: string
  targetTable: string
}) => {
  const { data } = await adminSupabase
    .from('tenant_import_mappings')
    .select('*')
    .eq('tenant_id', params.tenantId)
    .eq('source_kind', params.sourceKind)
    .eq('source_id', params.sourceId)
    .eq('target_table', params.targetTable)
    .is('deleted_at', null)
    .maybeSingle()

  return data || null
}

const writeTenantImportMapping = async (adminSupabase: any, params: {
  tenantId: string
  jobId: string
  sourceKind: string
  sourceId: string
  targetTable: string
  targetId: string
  mappingPayload?: Record<string, unknown>
}) => {
  await adminSupabase
    .from('tenant_import_mappings')
    .upsert({
      tenant_id: params.tenantId,
      job_id: params.jobId,
      source_kind: params.sourceKind,
      source_id: params.sourceId,
      target_table: params.targetTable,
      target_id: params.targetId,
      mapping_payload: params.mappingPayload || {},
      deleted_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,source_kind,source_id,target_table' })
}

const writeTenantImportArtifact = async (adminSupabase: any, params: {
  tenantId: string
  jobId: string
  artifactKind: string
  artifactKey: string
  artifactPayload: Record<string, unknown>
}) => {
  await adminSupabase
    .from('tenant_import_artifacts')
    .upsert({
      tenant_id: params.tenantId,
      job_id: params.jobId,
      artifact_kind: params.artifactKind,
      artifact_key: params.artifactKey,
      artifact_payload: params.artifactPayload,
      deleted_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'job_id,artifact_kind,artifact_key' })
}

const upsertImportedPage = async (adminSupabase: any, params: {
  tenantId: string
  jobId: string
  sourceId: string
  page: {
    title: string
    slug: string
    excerpt: string
    rawPayload: Record<string, unknown>
    content: Record<string, unknown>
  }
}) => {
  const mapping = await getTenantImportMapping(adminSupabase, {
    tenantId: params.tenantId,
    sourceKind: 'page',
    sourceId: params.sourceId,
    targetTable: 'pages',
  })

  let existingPage = null
  if (mapping?.target_id) {
    const { data } = await adminSupabase
      .from('pages')
      .select('id')
      .eq('id', mapping.target_id)
      .eq('tenant_id', params.tenantId)
      .is('deleted_at', null)
      .maybeSingle()
    existingPage = data || null
  }

  if (!existingPage) {
    const { data } = await adminSupabase
      .from('pages')
      .select('id')
      .eq('tenant_id', params.tenantId)
      .eq('page_type', 'single_post')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    existingPage = data || null
  }

  const payload = {
    tenant_id: params.tenantId,
    title: params.page.title,
    slug: params.page.slug,
    excerpt: params.page.excerpt,
    status: 'published',
    workflow_state: 'published',
    editor_type: 'visual',
    page_type: 'single_post',
    is_public: true,
    is_active: true,
    content_draft: params.page.content,
    content_published: params.page.content,
    published_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const pageResult = existingPage?.id
    ? await adminSupabase.from('pages').update(payload).eq('id', existingPage.id).select('id').single()
    : await adminSupabase.from('pages').insert(payload).select('id').single()

  if (pageResult.error || !pageResult.data?.id) {
    throw new Error(pageResult.error?.message || 'Failed to materialize EmDash single-post page template')
  }

  await writeTenantImportMapping(adminSupabase, {
    tenantId: params.tenantId,
    jobId: params.jobId,
    sourceKind: 'page',
    sourceId: params.sourceId,
    targetTable: 'pages',
    targetId: pageResult.data.id,
    mappingPayload: {
      page_type: 'single_post',
      editor_type: 'visual',
    },
  })

  return pageResult.data.id as string
}

const upsertImportedWidgetArea = async (adminSupabase: any, params: {
  tenantId: string
  jobId: string
  area: {
    sourceId: string
    slug: string
    name: string
    rawPayload: Record<string, unknown>
  }
}) => {
  const mapping = await getTenantImportMapping(adminSupabase, {
    tenantId: params.tenantId,
    sourceKind: 'widget_area',
    sourceId: params.area.sourceId,
    targetTable: 'template_parts',
  })

  let existingPart = null
  if (mapping?.target_id) {
    const { data } = await adminSupabase
      .from('template_parts')
      .select('id')
      .eq('id', mapping.target_id)
      .eq('tenant_id', params.tenantId)
      .is('deleted_at', null)
      .maybeSingle()
    existingPart = data || null
  }

  if (!existingPart) {
    const { data } = await adminSupabase
      .from('template_parts')
      .select('id')
      .eq('tenant_id', params.tenantId)
      .eq('type', 'widget_area')
      .eq('slug', params.area.slug)
      .is('deleted_at', null)
      .maybeSingle()
    existingPart = data || null
  }

  const payload = {
    tenant_id: params.tenantId,
    name: params.area.name,
    type: 'widget_area',
    slug: params.area.slug,
    content: { content: [], root: {} },
    is_active: true,
    source_system: 'emdash',
    source_version: 'emdash-template-v1',
    normalization_status: 'normalized',
    last_normalized_at: new Date().toISOString(),
    raw_emdash_payload: params.area.rawPayload,
    updated_at: new Date().toISOString(),
    deleted_at: null,
  }

  const partResult = existingPart?.id
    ? await adminSupabase.from('template_parts').update(payload).eq('id', existingPart.id).select('id').single()
    : await adminSupabase.from('template_parts').insert(payload).select('id').single()

  if (partResult.error || !partResult.data?.id) {
    throw new Error(partResult.error?.message || `Failed to materialize EmDash widget area ${params.area.slug}`)
  }

  await writeTenantImportMapping(adminSupabase, {
    tenantId: params.tenantId,
    jobId: params.jobId,
    sourceKind: 'widget_area',
    sourceId: params.area.sourceId,
    targetTable: 'template_parts',
    targetId: partResult.data.id,
    mappingPayload: {
      slug: params.area.slug,
      type: 'widget_area',
    },
  })

  return partResult.data.id as string
}

const upsertImportedWidget = async (adminSupabase: any, params: {
  tenantId: string
  jobId: string
  areaId: string
  areaSlug: string
  widget: {
    sourceId: string
    name: string
    type: string
    order: number
    showTitle?: boolean
    content?: string | null
    config?: Record<string, unknown>
    rawPayload: Record<string, unknown>
  }
}) => {
  const mapping = await getTenantImportMapping(adminSupabase, {
    tenantId: params.tenantId,
    sourceKind: 'widget',
    sourceId: params.widget.sourceId,
    targetTable: 'widgets',
  })

  let existingWidget = null
  if (mapping?.target_id) {
    const { data } = await adminSupabase
      .from('widgets')
      .select('id')
      .eq('id', mapping.target_id)
      .eq('tenant_id', params.tenantId)
      .is('deleted_at', null)
      .maybeSingle()
    existingWidget = data || null
  }

  const payload = {
    tenant_id: params.tenantId,
    area_id: params.areaId,
    area: params.areaSlug,
    name: params.widget.name,
    type: params.widget.type,
    config: params.widget.config || {},
    content: params.widget.content || null,
    order: params.widget.order,
    sort_order: params.widget.order,
    is_active: true,
    show_title: params.widget.showTitle !== false,
    source_system: 'emdash',
    source_version: 'emdash-template-v1',
    normalization_status: 'normalized',
    last_normalized_at: new Date().toISOString(),
    raw_emdash_payload: params.widget.rawPayload,
    updated_at: new Date().toISOString(),
    deleted_at: null,
  }

  const widgetResult = existingWidget?.id
    ? await adminSupabase.from('widgets').update(payload).eq('id', existingWidget.id).select('id').single()
    : await adminSupabase.from('widgets').insert(payload).select('id').single()

  if (widgetResult.error || !widgetResult.data?.id) {
    throw new Error(widgetResult.error?.message || `Failed to materialize EmDash widget ${params.widget.sourceId}`)
  }

  await writeTenantImportMapping(adminSupabase, {
    tenantId: params.tenantId,
    jobId: params.jobId,
    sourceKind: 'widget',
    sourceId: params.widget.sourceId,
    targetTable: 'widgets',
    targetId: widgetResult.data.id,
    mappingPayload: {
      area_slug: params.areaSlug,
      widget_type: params.widget.type,
      order: params.widget.order,
    },
  })

  return widgetResult.data.id as string
}

const upsertImportedBlog = async (adminSupabase: any, params: {
  tenantId: string
  jobId: string
  authorId: string
  blog: {
    sourceId: string
    title: string
    slug: string
    excerpt: string
    content: string
    featuredImage?: string | null
    rawPayload: Record<string, unknown>
  }
}) => {
  const mapping = await getTenantImportMapping(adminSupabase, {
    tenantId: params.tenantId,
    sourceKind: 'blog',
    sourceId: params.blog.sourceId,
    targetTable: 'blogs',
  })

  let existingBlog = null
  if (mapping?.target_id) {
    const { data } = await adminSupabase
      .from('blogs')
      .select('id')
      .eq('id', mapping.target_id)
      .eq('tenant_id', params.tenantId)
      .is('deleted_at', null)
      .maybeSingle()
    existingBlog = data || null
  }

  if (!existingBlog) {
    const { data } = await adminSupabase
      .from('blogs')
      .select('id')
      .eq('tenant_id', params.tenantId)
      .eq('slug', params.blog.slug)
      .is('deleted_at', null)
      .maybeSingle()
    existingBlog = data || null
  }

  const publishedAt = new Date().toISOString()
  const payload = {
    tenant_id: params.tenantId,
    title: params.blog.title,
    slug: params.blog.slug,
    excerpt: params.blog.excerpt,
    content: params.blog.content,
    featured_image: params.blog.featuredImage || null,
    author_id: params.authorId,
    created_by: params.authorId,
    status: 'published',
    workflow_state: 'published',
    is_active: true,
    is_public: true,
    published_at: publishedAt,
    updated_at: publishedAt,
  }

  const blogResult = existingBlog?.id
    ? await adminSupabase.from('blogs').update(payload).eq('id', existingBlog.id).select('id').single()
    : await adminSupabase.from('blogs').insert(payload).select('id').single()

  if (blogResult.error || !blogResult.data?.id) {
    throw new Error(blogResult.error?.message || `Failed to materialize EmDash blog ${params.blog.slug}`)
  }

  await writeTenantImportMapping(adminSupabase, {
    tenantId: params.tenantId,
    jobId: params.jobId,
    sourceKind: 'blog',
    sourceId: params.blog.sourceId,
    targetTable: 'blogs',
    targetId: blogResult.data.id,
    mappingPayload: {
      slug: params.blog.slug,
      status: 'published',
    },
  })

  return blogResult.data.id as string
}

const executeEmdashImportJob = async (params: {
  adminSupabase: any
  tenantId: string
  job: any
  userId: string
  templateSlug: string
  importType: string
  sourceLocator: string | null
}) => {
  const externalSeedTemplate = await loadEmdashExternalSeedTemplate({
    sourceLocator: params.sourceLocator,
    templateSlug: params.templateSlug,
  })
  const seedTemplate = externalSeedTemplate || getEmdashSeedTemplate(params.templateSlug, params.importType)
  if (!seedTemplate) {
    throw new Error(`No built-in EmDash seed is available for ${params.templateSlug}/${params.importType}`)
  }

  const adminSupabase = params.adminSupabase
  const startedAt = new Date().toISOString()

  await adminSupabase
    .from('tenant_import_jobs')
    .update({
      status: 'running',
      started_at: startedAt,
      updated_at: startedAt,
      result_summary: {
        mode: 'execute',
        template_slug: params.templateSlug,
      },
    })
    .eq('id', params.job.id)

  try {
    const pageId = await upsertImportedPage(adminSupabase, {
      tenantId: params.tenantId,
      jobId: params.job.id,
      sourceId: seedTemplate.pageTemplate.sourceId,
      page: seedTemplate.pageTemplate,
    })

    const widgetSnapshots: Array<Record<string, unknown>> = []
    for (const area of seedTemplate.widgetAreas) {
      const areaId = await upsertImportedWidgetArea(adminSupabase, {
        tenantId: params.tenantId,
        jobId: params.job.id,
        area,
      })

      for (const widget of area.widgets) {
        const widgetId = await upsertImportedWidget(adminSupabase, {
          tenantId: params.tenantId,
          jobId: params.job.id,
          areaId,
          areaSlug: area.slug,
          widget,
        })

        widgetSnapshots.push({
          id: widgetId,
          sourceId: widget.sourceId,
          type: widget.type,
          areaSlug: area.slug,
        })
      }
    }

    const blogIds: string[] = []
    for (const blog of seedTemplate.blogs) {
      const blogId = await upsertImportedBlog(adminSupabase, {
        tenantId: params.tenantId,
        jobId: params.job.id,
        authorId: params.userId,
        blog,
      })
      blogIds.push(blogId)
    }

    await writeTenantImportArtifact(adminSupabase, {
      tenantId: params.tenantId,
      jobId: params.job.id,
      artifactKind: 'seed',
      artifactKey: seedTemplate.sourceKey,
      artifactPayload: {
        source_locator: params.sourceLocator,
        source_version: seedTemplate.sourceVersion,
        template_slug: seedTemplate.templateSlug,
        source_mode: externalSeedTemplate ? 'external_seed_json' : 'builtin_fallback',
      },
    })

    await writeTenantImportArtifact(adminSupabase, {
      tenantId: params.tenantId,
      jobId: params.job.id,
      artifactKind: 'visual_snapshot',
      artifactKey: seedTemplate.pageTemplate.slug,
      artifactPayload: {
        page_id: pageId,
        content: seedTemplate.pageTemplate.content,
      },
    })

    await writeTenantImportArtifact(adminSupabase, {
      tenantId: params.tenantId,
      jobId: params.job.id,
      artifactKind: 'widget_snapshot',
      artifactKey: seedTemplate.widgetAreas[0]?.slug || 'widget-area',
      artifactPayload: {
        widget_areas: seedTemplate.widgetAreas.map((area) => ({
          sourceId: area.sourceId,
          slug: area.slug,
          widgets: area.widgets.map((widget) => ({
            sourceId: widget.sourceId,
            type: widget.type,
          })),
        })),
        materialized_widgets: widgetSnapshots,
      },
    })

    const completedAt = new Date().toISOString()
    const resultSummary = {
      mode: 'execute',
      template_slug: seedTemplate.templateSlug,
      imported_counts: {
        blogs: blogIds.length,
        widget_areas: seedTemplate.widgetAreas.length,
        widgets: widgetSnapshots.length,
        pages: 1,
      },
      source_mode: externalSeedTemplate ? 'external_seed_json' : 'builtin_fallback',
      page_id: pageId,
      blog_ids: blogIds,
    }

    await adminSupabase
      .from('tenant_import_jobs')
      .update({
        status: 'succeeded',
        completed_at: completedAt,
        updated_at: completedAt,
        result_summary: resultSummary,
      })
      .eq('id', params.job.id)

    await adminSupabase.from('tenant_import_audit').insert({
      tenant_id: params.tenantId,
      job_id: params.job.id,
      actor_user_id: params.userId,
      action: 'execute-job',
      status: 'succeeded',
      metadata: resultSummary,
    })

    const { data: refreshedJob } = await adminSupabase
      .from('tenant_import_jobs')
      .select('*, sources:tenant_import_sources(*), artifacts:tenant_import_artifacts(*), mappings:tenant_import_mappings(*)')
      .eq('id', params.job.id)
      .maybeSingle()

    return refreshedJob || { ...params.job, status: 'succeeded', result_summary: resultSummary }
  } catch (error) {
    const completedAt = new Date().toISOString()
    const message = error instanceof Error ? error.message : 'EmDash import execution failed'

    await adminSupabase
      .from('tenant_import_jobs')
      .update({
        status: 'failed',
        completed_at: completedAt,
        updated_at: completedAt,
        result_summary: {
          mode: 'execute',
          template_slug: params.templateSlug,
          error: message,
        },
      })
      .eq('id', params.job.id)

    await adminSupabase.from('tenant_import_audit').insert({
      tenant_id: params.tenantId,
      job_id: params.job.id,
      actor_user_id: params.userId,
      action: 'execute-job',
      status: 'failed',
      metadata: {
        templateSlug: params.templateSlug,
        importType: params.importType,
        error: message,
      },
    })

    throw error
  }
}

// Local-dev proxy upload route.
// Registered BEFORE the /api/* JWT middleware so the browser PUT (which carries
// no Authorization header, matching presigned-URL semantics) is not rejected.
// Auth is provided by the session record itself — only the holder of a valid,
// pending, non-expired sessionId can write bytes here.
// Used only when R2_ACCOUNT_ID=local-dev (wrangler dev / Miniflare).
app.put('/api/media/upload-proxy/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')
  const adminSupabase = getAdminSupabase(c.env)

  // Fetch the session to get the storage key and validate it is still pending.
  const { data: session, error: sessionError } = await adminSupabase
    .from('media_upload_sessions')
    .select('id, storage_key, mime_type, status, expires_at')
    .eq('id', sessionId)
    .single()

  if (sessionError || !session) {
    return c.json({ error: 'Upload session not found' }, 404)
  }
  if (session.status !== 'pending') {
    return c.json({ error: 'Upload session is no longer pending' }, 409)
  }
  if (new Date(session.expires_at) < new Date()) {
    return c.json({ error: 'Upload session expired' }, 410)
  }

  const body = await c.req.arrayBuffer()
  if (!body || body.byteLength === 0) {
    return c.json({ error: 'Empty request body' }, 400)
  }

  try {
    await c.env.STORAGE.put(session.storage_key, body, {
      httpMetadata: { contentType: session.mime_type ?? 'application/octet-stream' },
    })
    return c.json({ ok: true })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Proxy upload failed' }, 500)
  }
})

// Middleware to verify Supabase JWT
app.use('/api/*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid authorization header' }, 401);
  }

  const token = authHeader.split(' ')[1];
  const supabase = createClient(c.env.VITE_SUPABASE_URL, c.env.VITE_SUPABASE_PUBLISHABLE_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('user', user);
  c.set('token', token);
  c.set('supabase', supabase);
  await next();
});

app.post('/api/media/import-local', async (c) => {
  const user = c.get('user')

  if (c.env.R2_ACCOUNT_ID !== 'local-dev') {
    return c.json({ error: 'This endpoint is only available in local-dev mode' }, 403)
  }

  if (!c.env.STORAGE) {
    return c.json({ error: 'Local STORAGE binding is unavailable' }, 500)
  }

  let userContext: Awaited<ReturnType<typeof getUserContext>> | null = null
  try {
    userContext = await getUserContext(c.env, user.id)
  } catch {
    userContext = null
  }

  const isTrustedLocalSyncUser = user?.email === 'cms@ahliweb.com'
  if (!isTrustedLocalSyncUser && (!userContext || (!userContext.isPlatformAdmin && !userContext.isFullAccess))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = await getJsonBody(c.req.raw) as any
  if (!body?.media || !body?.fileBase64) {
    return c.json({ error: 'Missing media payload or fileBase64' }, 400)
  }

  const media = body.media
  if (!media.storage_key || !media.tenant_id || !media.file_name) {
    return c.json({ error: 'Missing required media fields' }, 400)
  }

  const requestedTenantId = typeof body.tenantId === 'string' ? body.tenantId : media.tenant_id
  let resolvedTenantId: string | null
  if (isTrustedLocalSyncUser && !userContext) {
    resolvedTenantId = requestedTenantId || media.tenant_id
  } else {
    try {
      resolvedTenantId = resolveTenantId(requestedTenantId, userContext!)
    } catch {
      return c.json({ error: 'Tenant mismatch or missing tenant context' }, 403)
    }
  }

  if (!resolvedTenantId || resolvedTenantId !== media.tenant_id) {
    return c.json({ error: 'Tenant mismatch' }, 403)
  }

  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(body.fileBase64), (char) => char.charCodeAt(0))
  } catch {
    return c.json({ error: 'Invalid fileBase64 payload' }, 400)
  }

  try {
    await c.env.STORAGE.put(media.storage_key, bytes, {
      httpMetadata: { contentType: media.mime_type ?? 'application/octet-stream' },
    })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to import object to local storage' }, 500)
  }

  const adminSupabase = getAdminSupabase(c.env)
  const row = {
    id: media.id,
    tenant_id: media.tenant_id,
    file_name: media.file_name,
    original_name: media.original_name,
    mime_type: media.mime_type,
    size_bytes: media.size_bytes,
    storage_key: media.storage_key,
    status: media.status,
    access_control: media.access_control,
    meta_data: media.meta_data,
    uploader_id: media.uploader_id,
    created_at: media.created_at,
    updated_at: media.updated_at,
    deleted_at: media.deleted_at,
    title: media.title,
    description: media.description,
    alt_text: media.alt_text,
    slug: media.slug,
    media_kind: media.media_kind,
    category_id: media.category_id,
    session_bound_access: media.session_bound_access,
  }

  const { error: upsertError } = await adminSupabase
    .from('media_objects')
    .upsert(row, { onConflict: 'storage_key' })

  if (upsertError) {
    return c.json({ error: upsertError.message }, 500)
  }

  return c.json({ ok: true, storageKey: media.storage_key, id: media.id })
})

app.post('/api/media/cleanup-local-duplicates', async (c) => {
  const user = c.get('user')

  if (c.env.R2_ACCOUNT_ID !== 'local-dev') {
    return c.json({ error: 'This endpoint is only available in local-dev mode' }, 403)
  }

  if (!c.env.STORAGE) {
    return c.json({ error: 'Local STORAGE binding is unavailable' }, 500)
  }

  let userContext: Awaited<ReturnType<typeof getUserContext>> | null = null
  try {
    userContext = await getUserContext(c.env, user.id)
  } catch {
    userContext = null
  }

  const isTrustedLocalSyncUser = user?.email === 'cms@ahliweb.com'
  if (!isTrustedLocalSyncUser && (!userContext || (!userContext.isPlatformAdmin && !userContext.isFullAccess))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = await getJsonBody(c.req.raw) as any
  if (!Array.isArray(body?.duplicates) || body.duplicates.length === 0) {
    return c.json({ error: 'Missing duplicates payload' }, 400)
  }

  const adminSupabase = getAdminSupabase(c.env)
  const removed: Array<{ id: string; storageKey: string }> = []

  for (const duplicate of body.duplicates) {
    if (!duplicate?.id || !duplicate?.storageKey) continue

    try {
      await c.env.STORAGE.delete(duplicate.storageKey)
    } catch {
      // Continue and still remove the DB row so local metadata can be reconciled.
    }

    const { error } = await adminSupabase
      .from('media_objects')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', duplicate.id)
      .is('deleted_at', null)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    removed.push({ id: duplicate.id, storageKey: duplicate.storageKey })
  }

  return c.json({ ok: true, removed })
})

// Request an upload session
app.post('/api/media/upload-session', async (c) => {
  const startedAt = Date.now()
  const user = c.get('user');
  const token = c.get('token');
  const body = await c.req.json<UploadSessionRequest>();
  
  if (!body.fileName || !body.mimeType || typeof body.sizeBytes !== 'number') {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  try {
    ensureR2SigningConfig(c.env)

    const userSupabase = getAuthedSupabase(c.env, token)
    const adminSupabase = getAdminSupabase(c.env)
    const userContext = await getUserContext(c.env, user.id)
    const tenantId = resolveTenantId(c.req.header('x-tenant-id') ?? null, userContext)

    if (!tenantId) {
      return c.json({ error: 'Missing tenant id header' }, 400)
    }

    const [{ data: canCreate, error: createPermissionError }, { data: canManage, error: managePermissionError }] = await Promise.all([
      userSupabase.rpc('has_permission', { permission_name: 'tenant.files.create' }),
      userSupabase.rpc('has_permission', { permission_name: 'tenant.files.manage' }),
    ])

    if (createPermissionError || managePermissionError) {
      return c.json({ error: 'Failed to verify upload permissions' }, 500)
    }

    if (!userContext.isPlatformAdmin && !userContext.isFullAccess && !canCreate && !canManage) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const sessionBoundAccess = Boolean(body.sessionBoundAccess)
    const storageKey = buildStorageKey(tenantId, body.fileName, body.folder, sessionBoundAccess)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
    // In local dev (R2_ACCOUNT_ID sentinel = 'local-dev') the S3 presigned URL
    // points to a non-existent host and TLS fails in the browser.
    // Instead, we generate a proxy upload URL that goes through this Worker,
    // which writes to the local STORAGE R2 binding via the Workers API.
    const isLocalDev = c.env.R2_ACCOUNT_ID === 'local-dev'

    let uploadUrl: string
    if (isLocalDev) {
      // Placeholder — will be replaced with the real proxy URL after session insert.
      uploadUrl = '__local_dev_proxy__'
    } else {
      const s3 = getR2S3Client(c.env)
      uploadUrl = await getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: c.env.R2_BUCKET_NAME,
          Key: storageKey,
          ContentType: body.mimeType,
        }),
        { expiresIn: 15 * 60 }
      )
    }

    const { data: session, error: dbError } = await adminSupabase
      .from('media_upload_sessions')
      .insert({
        tenant_id: tenantId,
        uploader_id: user.id,
        file_name: body.fileName,
        mime_type: body.mimeType,
        size_bytes: body.sizeBytes,
        storage_key: storageKey,
        upload_url: uploadUrl,
        category_id: body.categoryId || null,
        access_control: sessionBoundAccess ? 'private' : (body.accessControl || 'public'),
        session_bound_access: sessionBoundAccess,
        meta_data: {
          folder: sanitizeFolder(body.folder),
          source: 'r2',
        },
        expires_at: expiresAt,
        status: 'pending'
      })
      .select('id, expires_at, storage_key')
      .single();

    if (dbError || !session) {
      return c.json({ error: 'Failed to create upload session', details: dbError }, 500)
    }

    const finalizeUrl = new URL(`/api/media/upload/${session.id}/finalize`, c.req.url).toString()

    // Rewrite placeholder to real proxy URL now that we have the session id.
    if (isLocalDev) {
      uploadUrl = new URL(`/api/media/upload-proxy/${session.id}`, c.req.url).toString()
    }

    await writeAccessAudit(adminSupabase, {
      tenantId,
      userId: user.id,
      action: 'media.upload_session',
      resource: 'upload_session',
      details: { file_name: body.fileName, mime_type: body.mimeType, size_bytes: body.sizeBytes },
      ipAddress: getRequestIp(c.req.raw),
      channel: 'api',
      actorType: 'user',
      authContext: { has_session: true },
      moduleName: 'media',
      featureName: 'upload_session',
      actionName: 'create',
      resourceType: 'upload_session',
      resourceId: session.id,
      requestDurationMs: Date.now() - startedAt,
      routePath: '/api/media/upload-session',
      url: c.req.url,
      userAgent: c.req.header('user-agent') || null,
      purpose: 'create secure media upload session',
      triggerSource: 'awcms_edge_route',
      businessIntent: 'media_upload',
      accessChannel: 'api',
      accessMechanism: 'worker_route',
      authMethod: 'bearer_token',
    })

    return c.json({
      sessionId: session.id,
      uploadUrl,
      finalizeUrl,
      expiresAt: session.expires_at,
      storageKey: session.storage_key
    })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to create upload session' }, 500)
  }
});

// Finalize upload after the client PUTs directly to the signed R2 URL.
//
// This route now returns 202 Accepted immediately and enqueues a
// `media.upload.finalize` message for async processing by mediaConsumer.ts.
//
// The consumer re-reads authoritative session state from Supabase, verifies
// the R2 object, upserts media_objects, and marks the session completed.
// Clients should poll GET /api/media/upload/:sessionId/status to check
// completion, or subscribe to Supabase Realtime on media_objects.
app.post('/api/media/upload/:sessionId/finalize', async (c) => {
  const sessionId = c.req.param('sessionId');
  const user = c.get('user');
  const adminSupabase = getAdminSupabase(c.env)

  try {
    // Validate the session belongs to this user and is still pending.
    // We do a lightweight check here so the queue consumer doesn't need to
    // trust the caller — the consumer will re-validate independently.
    const { data: session, error: sessionError } = await adminSupabase
      .from('media_upload_sessions')
      .select('id, tenant_id, uploader_id, status, expires_at, file_name')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session || session.status !== 'pending' || session.uploader_id !== user.id) {
      return c.json({ error: 'Invalid or expired upload session' }, 403);
    }

    if (new Date(session.expires_at) < new Date()) {
      return c.json({ error: 'Session expired' }, 403);
    }

    // Build the finalize message.
    const traceId = c.req.header('x-request-id') ?? crypto.randomUUID()
    const message = buildMediaFinalizeMessage({
      session_id: sessionId,
      tenant_id: session.tenant_id,
      original_filename: session.file_name,
      trace_id: traceId,
    })

    // In local dev, Cloudflare Queues do not fire reliably under wrangler dev /
    // Miniflare. Bypass the queue entirely and run the consumer inline so the
    // upload completes synchronously and the status poll returns 'completed' on
    // the very next tick.
    const isLocalDev = c.env.R2_ACCOUNT_ID === 'local-dev'
    if (isLocalDev) {
      const result = await handleMediaFinalizeMessage(message, c.env)
      if (result === 'retry') {
        return c.json(
          { error: 'Finalization failed — R2 object not found. Is the proxy upload complete?' },
          500,
        )
      }
      return c.json(
        {
          ok: true,
          job_id: message.job_id,
          status: 'completed',
          message: 'Upload finalized synchronously (local-dev mode).',
        },
        202,
      )
    }

    // Production path: enqueue for async processing.
    await c.env.MEDIA_EVENTS_QUEUE.send(message)

    return c.json(
      {
        ok: true,
        job_id: message.job_id,
        status: 'processing',
        message: 'Upload finalization queued. Poll /api/media/upload/:sessionId/status for completion.',
      },
      202,
    );
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to queue finalization' }, 500)
  }
});

// Poll the status of an upload finalization job.
// Returns the current session status so clients know when async processing
// has completed (status === "completed") or failed (status === "failed").
app.get('/api/media/upload/:sessionId/status', async (c) => {
  const sessionId = c.req.param('sessionId');
  const user = c.get('user');
  const adminSupabase = getAdminSupabase(c.env);

  const { data: session, error } = await adminSupabase
    .from('media_upload_sessions')
    .select('id, status, completed_at, uploader_id, storage_key')
    .eq('id', sessionId)
    .single();

  if (error || !session || session.uploader_id !== user.id) {
    return c.json({ error: 'Session not found' }, 404);
  }

  // When finalization is complete, include the resolved media_objects record
  // so clients can use it directly without a second round-trip.
  if (session.status === 'completed' && session.storage_key) {
    const { data: mediaObject } = await adminSupabase
      .from('media_objects')
      .select('*')
      .eq('storage_key', session.storage_key)
      .is('deleted_at', null)
      .single();

    return c.json({
      sessionId: session.id,
      status: session.status,
      completedAt: session.completed_at ?? null,
      mediaObject: mediaObject ?? null,
    });
  }

  return c.json({ sessionId: session.id, status: session.status, completedAt: session.completed_at ?? null, mediaObject: null });
});

// Permanently delete a media file from R2 + DB.
// Requires tenant.files.permanent_delete or is_full_access on the role.
// The file MUST already be soft-deleted (deleted_at IS NOT NULL).
app.delete('/api/media/:id/permanent', async (c) => {
  const mediaId = c.req.param('id');
  const user = c.get('user');
  const adminSupabase = getAdminSupabase(c.env);

  // 0. Resolve caller context (platform admins bypass tenant isolation)
  let userContext: Awaited<ReturnType<typeof getUserContext>>;
  try {
    userContext = await getUserContext(c.env, user.id);
  } catch {
    return c.json({ error: 'Could not resolve user context' }, 500);
  }

  let resolvedTenantId: string | null;
  try {
    resolvedTenantId = resolveTenantId(c.req.header('x-tenant-id') ?? null, userContext);
  } catch {
    return c.json({ error: 'Tenant mismatch or missing tenant context' }, 403);
  }

  // 1. Fetch the row (must be soft-deleted)
  const { data: media, error: fetchError } = await adminSupabase
    .from('media_objects')
    .select('id, storage_key, tenant_id, deleted_at, uploader_id')
    .eq('id', mediaId)
    .single();

  if (fetchError || !media) {
    return c.json({ error: 'File not found' }, 404);
  }

  if (!media.deleted_at) {
    return c.json({ error: 'File must be moved to trash before it can be permanently deleted' }, 409);
  }

  // 2. Tenant isolation: non-platform users must own the tenant that owns the file
  if (!userContext.isPlatformAdmin && !userContext.isFullAccess) {
    if (!resolvedTenantId || media.tenant_id !== resolvedTenantId) {
      return c.json({ error: 'Access denied' }, 403);
    }
  }

  // 3. Delete from R2 (local-dev: use STORAGE binding; prod: use S3 client)
  const isLocalDev = c.env.R2_ACCOUNT_ID === 'local-dev';
  try {
    if (isLocalDev) {
      if (c.env.STORAGE) {
        await c.env.STORAGE.delete(media.storage_key);
      }
    } else {
      ensureR2SigningConfig(c.env);
      const s3 = getR2S3Client(c.env);
      await s3.send(new DeleteObjectCommand({
        Bucket: c.env.R2_BUCKET_NAME,
        Key: media.storage_key,
      }));
    }
  } catch (storageErr) {
    console.error('[permanent-delete] R2 delete failed', storageErr);
    // Non-fatal: log and continue so the DB row is still cleaned up
  }

  // 4. Hard-delete the DB row via RPC (enforces permission check server-side)
  const token = c.get('token');
  const callerSupabase = createClient(c.env.VITE_SUPABASE_URL, c.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { error: rpcError } = await callerSupabase.rpc('permanent_delete_media_object', {
    p_media_id: mediaId,
  });

  if (rpcError) {
    return c.json({ error: rpcError.message }, 403);
  }

  return c.json({ ok: true, id: mediaId });
});

// Get presigned URL for GET (Or proxy)
app.get('/api/media/file/:id/access', async (c) => {
  const mediaId = c.req.param('id')
  const token = c.get('token')
  const requestedMaxAgeSeconds = Number.parseInt(c.req.query('maxAgeSeconds') || '', 10)
  const supabase = getAuthedSupabase(c.env, token)

  const { data: media, error } = await supabase
    .from('media_objects')
    .select('*')
    .eq('id', mediaId)
    .eq('status', 'uploaded')
    .is('deleted_at', null)
    .single()

  if (error || !media) {
    return c.json({ error: 'File not found or access denied' }, 404)
  }

  if (media.session_bound_access) {
    const windowState = getSessionBoundAccessWindowSeconds(c.env, token, requestedMaxAgeSeconds)
    if (windowState.expiresIn <= 0) {
      return c.json({ error: 'Secure file access has expired for this session' }, 403)
    }

    await getAdminSupabase(c.env)
      .from('media_access_audit')
      .insert({
        media_object_id: media.id,
        tenant_id: media.tenant_id,
        accessor_id: c.get('user')?.id || null,
        action: 'read',
      })

    // In local-dev the S3 presigned URL points to a non-existent host.
    // Return a proxy URL through this Worker instead.
    const isLocalDev = c.env.R2_ACCOUNT_ID === 'local-dev'
    if (isLocalDev) {
      const proxyUrl = new URL(`/api/media/file/${mediaId}`, c.req.url).toString()
      return c.json({
        url: proxyUrl,
        expiresAt: windowState.expiresAt,
        sessionBound: true,
      })
    }

    ensureR2SigningConfig(c.env)
    const signedUrl = await getSignedUrl(
      getR2S3Client(c.env),
      new GetObjectCommand({
        Bucket: c.env.R2_BUCKET_NAME,
        Key: media.storage_key,
      }),
      { expiresIn: windowState.expiresIn },
    )

    return c.json({
      url: signedUrl,
      expiresAt: windowState.expiresAt,
      sessionBound: true,
    })
  }

  return c.json({
    url: buildPublicMediaUrl(c.req.url, media.storage_key),
    expiresAt: null,
    sessionBound: false,
  })
})

// Get presigned URL for GET (Or proxy)
app.get('/api/media/file/:id', async (c) => {
  const mediaId = c.req.param('id');
  const token = c.get('token');

  const supabase = getAuthedSupabase(c.env, token)

  const { data: media, error } = await supabase
    .from('media_objects')
    .select('*')
    .eq('id', mediaId)
    .eq('status', 'uploaded')
    .is('deleted_at', null)
    .single();

  if (error || !media) {
    return c.json({ error: 'File not found or access denied' }, 404);
  }

  if (media.session_bound_access) {
    const windowState = getSessionBoundAccessWindowSeconds(c.env, token, null)
    if (windowState.expiresIn <= 0) {
      return c.json({ error: 'Secure file access has expired for this session' }, 403)
    }
  }

  let object
  try {
    object = await getStoredObject(c.env, media.storage_key)
  } catch {
    object = null
  }

  if (!object || !object.Body) {
    return c.json({ error: 'File not found in storage' }, 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', media.mime_type || object.ContentType || 'application/octet-stream');
  if (object.ETag) {
    headers.set('etag', object.ETag);
  }

  return new Response(object.Body as ReadableStream, { headers });
});

// Public proxy for public images
app.get('/public/media/*', async (c) => {
  const pathname = new URL(c.req.url).pathname
  const storageKeyParam = pathname.replace(/^\/public\/media\//, '')
  if (!storageKeyParam) {
    return c.json({ error: 'Missing storage key' }, 400);
  }

  const storageKey = decodeURIComponent(storageKeyParam);
  // Public reads rely on the public-read policy; a publishable key is enough here.
  const supabase = createClient(c.env.VITE_SUPABASE_URL, c.env.VITE_SUPABASE_PUBLISHABLE_KEY);
  
  // Public policy allows anyone to read if status=uploaded and access_control=public
  const { data: media, error } = await supabase
    .from('media_objects')
    .select('storage_key, mime_type')
    .eq('storage_key', storageKey)
    .eq('status', 'uploaded')
    .eq('access_control', 'public')
    .is('deleted_at', null)
    .single();

  if (error || !media) {
    return c.json({ error: 'File not found or not public' }, 404);
  }

  let object
  try {
    object = await getStoredObject(c.env, storageKey)
  } catch {
    object = null
  }

  if (!object || !object.Body) {
    return c.json({ error: 'File not found in storage' }, 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', media.mime_type || object.ContentType || 'application/octet-stream');
  if (object.ETag) {
    headers.set('etag', object.ETag);
  }
  headers.set('Cache-Control', 'public, max-age=31536000');
  
  return new Response(object.Body as ReadableStream, { headers });
});

// ---- MIGRATED ENDPOINTS ----

app.post('/webhooks/public-rebuild/smandapbun', async (c) => {
  const expectedSecret = c.env.SMANDAPBUN_REBUILD_WEBHOOK_SECRET?.trim()
  const providedSecret = c.req.header('x-awcms-rebuild-secret')?.trim()

  if (!expectedSecret) {
    return c.json({ error: 'Webhook secret is not configured' }, 500)
  }

  if (!providedSecret || providedSecret !== expectedSecret) {
    return c.json({ error: 'Unauthorized webhook request' }, 401)
  }

  const githubOwner = c.env.GITHUB_REBUILD_OWNER?.trim()
  const githubRepo = c.env.GITHUB_REBUILD_REPO?.trim()
  const eventType = c.env.GITHUB_REBUILD_EVENT_TYPE?.trim() || 'smandapbun-content-changed'

  if (!githubOwner || !githubRepo) {
    return c.json({ error: 'GitHub rebuild integration is not configured' }, 500)
  }

  const payload = await getJsonBody(c.req.raw) as any
  const traceId = c.req.header('x-trace-id') || crypto.randomUUID()

  const msg = buildSiteRebuildMessage({
    // smandapbun has no authenticated tenant — use tenant_id from payload or a sentinel
    tenant_id: payload?.tenant_id || 'smandapbun',
    trace_id: traceId,
    backend: 'github_dispatch',
    github_owner: githubOwner,
    github_repo: githubRepo,
    github_event_type: eventType,
    source: 'supabase-trigger',
    tenant_slug: 'smandapbun',
    table: payload?.table || null,
    operation: payload?.operation || null,
  })

  await c.env.NOTIFICATIONS_QUEUE.send(msg)

  return c.json({ ok: true, job_id: msg.job_id, queued: true }, 202)
})

app.post('/api/public/rebuild', async (c) => {
  const startedAt = Date.now()
  const user = c.get('user')
  const token = c.get('token')
  const adminSupabase = getAdminSupabase(c.env)
  const userSupabase = getAuthedSupabase(c.env, token)

  let tenantId: string | null
  try {
    const userContext = await getUserContext(c.env, user.id)
    tenantId = resolveTenantId(c.req.header('x-tenant-id') ?? null, userContext)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Invalid tenant context' }, 403)
  }

  if (!tenantId) {
    return c.json({ error: 'Missing tenant id header' }, 400)
  }

  const [{ data: canManagePages }, { data: canManageBlogs }, { data: canManageMenus }] = await Promise.all([
    userSupabase.rpc('has_permission', { permission_name: 'tenant.page.update' }),
    userSupabase.rpc('has_permission', { permission_name: 'tenant.blog.update' }),
    userSupabase.rpc('has_permission', { permission_name: 'tenant.menu.update' }),
  ])

  if (!canManagePages && !canManageBlogs && !canManageMenus) {
    return c.json({ error: 'Insufficient permissions to trigger a public rebuild' }, 403)
  }

  const body = await getJsonBody(c.req.raw) as any

  // Resolve hook URL at enqueue time — consumer has no Supabase access
  const { data: setting, error: settingError } = await adminSupabase
    .from('settings')
    .select('value')
    .eq('tenant_id', tenantId)
    .eq('key', 'public_rebuild_webhook_url')
    .is('deleted_at', null)
    .maybeSingle()

  if (settingError) {
    return c.json({ error: 'Failed to load rebuild webhook configuration', details: settingError.message }, 500)
  }

  const hookUrl = String(setting?.value || '').trim()
  if (!hookUrl) {
    return c.json({ error: 'Public rebuild webhook is not configured for this tenant' }, 404)
  }

  const traceId = c.req.header('x-trace-id') || crypto.randomUUID()

  const msg = buildSiteRebuildMessage({
    tenant_id: tenantId,
    trace_id: traceId,
    backend: 'webhook',
    hook_url: hookUrl,
    source: 'admin-panel',
    resource: body?.resource || null,
    action: body?.action || 'update',
    actor_id: user.id,
  })

  await c.env.NOTIFICATIONS_QUEUE.send(msg)

  await writeAccessAudit(adminSupabase, {
    tenantId,
    userId: user.id,
    action: 'public.rebuild',
    resource: 'site_rebuild',
    details: { job_id: msg.job_id, action: body?.action || 'update', resource: body?.resource || null },
    ipAddress: getRequestIp(c.req.raw),
    channel: 'worker',
    actorType: 'user',
    authContext: { has_session: true },
    moduleName: 'public_portal',
    featureName: 'rebuild',
    actionName: 'trigger',
    resourceType: 'site_rebuild',
    resourceId: msg.job_id,
    requestDurationMs: Date.now() - startedAt,
    routePath: '/api/public/rebuild',
    url: c.req.url,
    userAgent: c.req.header('user-agent') || null,
    purpose: 'trigger tenant public rebuild',
    triggerSource: 'awcms_edge_route',
    businessIntent: 'public_content_delivery',
    accessChannel: 'worker',
    accessMechanism: 'worker_route',
    authMethod: 'bearer_token',
  })

  return c.json({ ok: true, job_id: msg.job_id, queued: true, tenantId }, 202)
})

// Sitemap generation
app.get('/public/sitemap', async (c) => {
  const domainParam = c.req.query('domain');
  const tenantIdParam = c.req.query('tenant_id');
  
  const supabase = createClient(c.env.VITE_SUPABASE_URL, c.env.SUPABASE_SECRET_KEY);
  
  let tenantId: string | null = null;
  let baseUrl = 'https://awcms.ahliweb.com';
  
  if (tenantIdParam) {
    tenantId = tenantIdParam;
    const { data: tenant } = await supabase.from('tenants').select('domain, config').eq('id', tenantId).single();
    if (tenant?.domain) baseUrl = `https://${tenant.domain}`;
  } else if (domainParam) {
    const { data: tenant } = await supabase.rpc('get_tenant_by_domain', { lookup_domain: domainParam });
    if (tenant) {
      tenantId = tenant.id;
      baseUrl = `https://${domainParam}`;
    }
  }

  if (!tenantId) {
    return c.text('<?xml version="1.0" encoding="UTF-8"?><error>Tenant not found</error>', 404, { 'Content-Type': 'application/xml' });
  }

  const { data: articles } = await supabase.from('articles').select('slug, updated_at').eq('tenant_id', tenantId).eq('status', 'published').is('deleted_at', null).order('updated_at', { ascending: false });
  const { data: pages } = await supabase.from('pages').select('slug, updated_at').eq('tenant_id', tenantId).eq('status', 'published').eq('is_public', true).is('deleted_at', null).order('updated_at', { ascending: false });
  const { data: products } = await supabase.from('products').select('slug, updated_at').eq('tenant_id', tenantId).eq('status', 'active').is('deleted_at', null).order('updated_at', { ascending: false });

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;
  
  xml += `\n  <url>\n    <loc>${baseUrl}/</loc>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>`;

  if (articles && articles.length > 0) {
    articles.forEach((item: any) => {
      xml += `\n  <url>\n    <loc>${baseUrl}/articles/${item.slug}</loc>\n    <lastmod>${new Date(item.updated_at).toISOString()}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`;
    });
  }

  if (pages && pages.length > 0) {
    pages.forEach((item: any) => {
      if (item.slug === 'home' || item.slug === '/') return;
      xml += `\n  <url>\n    <loc>${baseUrl}/${item.slug}</loc>\n    <lastmod>${new Date(item.updated_at).toISOString()}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>`;
    });
  }

  if (products && products.length > 0) {
    products.forEach((item: any) => {
      xml += `\n  <url>\n    <loc>${baseUrl}/products/${item.slug}</loc>\n    <lastmod>${new Date(item.updated_at).toISOString()}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>`;
    });
  }

  xml += `\n</urlset>`;

  return c.text(xml, 200, {
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': 'public, max-age=3600, s-maxage=86400'
  });
});

// Mailketing integration
const MAILKETING_API = 'https://api.mailketing.co.id/api/v1';

const handleMailketing = async (c: any) => {
  try {
    const apiToken = c.env.MAILKETING_API_TOKEN
    if (!apiToken) {
      throw new Error('MAILKETING_API_TOKEN not configured')
    }

    const body = await requireJsonBody(c.req.raw)
    const action = requireString(body.action, 'Missing action')

    // For "send" action: enqueue asynchronously and return 202
    if (action === 'send') {
      const recipient = requireString(body.recipient, 'Missing recipient')
      const subject = requireString(body.subject, 'Missing subject')
      const content = requireString(body.content, 'Missing content')
      const traceId = c.req.header('x-trace-id') || crypto.randomUUID()
      const tenantId = c.req.header('x-tenant-id') || 'platform'

      const msg = buildEmailSendMessage({
        tenant_id: tenantId,
        trace_id: traceId,
        from_name: typeof body.from_name === 'string' && body.from_name.trim() ? body.from_name.trim() : 'AWCMS',
        from_email: typeof body.from_email === 'string' && body.from_email.trim() ? body.from_email.trim() : 'noreply@awcms.com',
        recipient,
        subject,
        content,
        attach1: typeof body.attach1 === 'string' ? body.attach1 : undefined,
        attach2: typeof body.attach2 === 'string' ? body.attach2 : undefined,
        attach3: typeof body.attach3 === 'string' ? body.attach3 : undefined,
      })

      await (c.env as Bindings).NOTIFICATIONS_QUEUE.send(msg)
      return c.json({ ok: true, job_id: msg.job_id, queued: true }, 202)
    }

    // All other actions (subscribe, credits, lists) remain synchronous
    let endpoint = ''
    let params: Record<string, string | number> = {}

    switch (action) {
      case 'subscribe':
        params = {
          api_token: apiToken,
          list_id: typeof body.list_id === 'number' || typeof body.list_id === 'string'
            ? body.list_id as string | number
            : c.env.MAILKETING_DEFAULT_LIST_ID || 1,
          email: requireString(body.email, 'Missing email'),
        }
        endpoint = '/addsubtolist'
        if (typeof body.first_name === 'string' && body.first_name.trim()) params.first_name = body.first_name.trim()
        if (typeof body.last_name === 'string' && body.last_name.trim()) params.last_name = body.last_name.trim()
        if (typeof body.phone === 'string' && body.phone.trim()) params.phone = body.phone.trim()
        if (typeof body.mobile === 'string' && body.mobile.trim()) params.mobile = body.mobile.trim()
        if (typeof body.city === 'string' && body.city.trim()) params.city = body.city.trim()
        if (typeof body.state === 'string' && body.state.trim()) params.state = body.state.trim()
        if (typeof body.country === 'string' && body.country.trim()) params.country = body.country.trim()
        if (typeof body.company === 'string' && body.company.trim()) params.company = body.company.trim()
        break
      case 'credits':
        endpoint = '/ceksaldo'
        params = { api_token: apiToken }
        break
      case 'lists':
        endpoint = '/viewlist'
        params = { api_token: apiToken }
        break
      default:
        return c.json({ error: 'Invalid action. Use: send, subscribe, credits, lists' }, 400)
    }

    const formData = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      formData.append(key, String(value))
    }

    const response = await fetch(`${MAILKETING_API}${endpoint}`, {
      method: 'POST',
      body: formData,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    const result = await response.json() as Record<string, any>

    const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || 'unknown'
    return c.json({ ...result, client_ip: clientIp })
  } catch (error) {
    return handleRouteError(c, error, 'Mailketing request failed')
  }
}

app.post('/api/mailketing', handleMailketing);
app.post('/functions/v1/mailketing', handleMailketing);

// ---- SUPABASE EDGE FUNCTION MIGRATIONS ----

app.post('/functions/v1/content-transform', async (c) => {
  try {
    const startedAt = Date.now()
    const authHeader = c.req.header('Authorization')
    if (!authHeader) return c.json({ error: 'Unauthorized' }, 401)

    const callerClient = createClient(c.env.VITE_SUPABASE_URL, c.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: authData, error: authError } = await callerClient.auth.getUser()
    if (authError || !authData?.user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const userContext = await getUserContext(c.env, authData.user.id)
    const tenantId = resolveTenantId(c.req.header('x-tenant-id') ?? null, userContext)
    if (!tenantId) return c.json({ error: 'Missing x-tenant-id header' }, 400)

    const canUpdateBlog = userContext.isPlatformAdmin
      || userContext.isFullAccess
      || await hasAnyPermission(callerClient, ['tenant.blog.update'])

    if (!canUpdateBlog) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const adminClient = getAdminSupabase(c.env)
    const payload = await requireJsonBody(c.req.raw)
    const blogId = requireString(payload.blog_id, 'Missing blog_id')
    const transformed = payload.transformed
    if (transformed === null || transformed === undefined) {
      return c.json({ error: 'Missing transformed content' }, 400)
    }

    const { data, error } = await adminClient
      .from('blogs')
      .update({
        content: transformed,
        updated_at: new Date().toISOString(),
      })
      .eq('id', blogId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .select('id')
      .single()

    if (error) {
      console.error('[awcms-edge] Failed to transform blog content', error)
      return c.json({ error: 'Failed to update blog content' }, 500)
    }
    if (!data) return c.json({ error: 'Blog not found or access denied' }, 404)

    await writeAccessAudit(adminClient, {
      tenantId,
      userId: authData.user.id,
      action: 'content.transform',
      resource: 'content_transform',
      details: { blog_id: blogId },
      ipAddress: getRequestIp(c.req.raw),
      channel: 'worker',
      actorType: 'user',
      authContext: { has_session: true },
      moduleName: 'content',
      featureName: 'transform',
      actionName: 'update',
      resourceType: 'content_transform',
      resourceId: data.id,
      requestDurationMs: Date.now() - startedAt,
      routePath: '/functions/v1/content-transform',
      url: c.req.url,
      userAgent: c.req.header('user-agent') || null,
      purpose: 'apply transformed content payload',
      triggerSource: 'awcms_edge_route',
      businessIntent: 'content_processing',
      accessChannel: 'worker',
      accessMechanism: 'worker_route',
      authMethod: 'bearer_token',
    })

    return c.json({ ok: true, id: data.id }, 200)
  } catch (error) {
    return handleRouteError(c, error, 'Failed to transform content')
  }
})

app.post('/functions/v1/mailketing-webhook', async (c) => {
  try {
    const payload = await requireJsonBody(c.req.raw)
    const type = requireString(payload.type, 'Missing webhook type')
    const email = requireString(payload.email, 'Missing webhook email')
    const supabase = getAdminSupabase(c.env)

    const eventTypeMap: Record<string, string> = {
      'newsubscriber': 'subscribed',
      'unsubscribe': 'unsubscribed',
      'emailopen': 'opened',
      'emailclick': 'clicked',
      'bounce': 'bounced',
    }
    const eventType = eventTypeMap[type] || type

    const { error } = await supabase.from('email_logs').insert({
      event_type: eventType,
      recipient: email,
      metadata: payload,
    })

    if (error) console.error('[Mailketing Webhook] DB Error:', error)

    if (type === 'bounce' || type === 'unsubscribe') {
      await supabase
        .from('users')
        .update({
          email_verified: false,
          metadata: {
            email_status: type === 'bounce' ? 'bounced' : 'unsubscribed',
            email_status_reason: payload.reason,
            email_status_date: typeof payload.date === 'string' && payload.date ? payload.date : new Date().toISOString(),
          }
        })
        .eq('email', email)
    }
    return c.json({ status: 'success', event: eventType })
  } catch (error) {
    return handleRouteError(c, error, 'Mailketing webhook handling failed')
  }
})

app.post('/functions/v1/verify-turnstile', async (c) => {
  try {
    const payload = await requireJsonBody(c.req.raw)
    const token = requireString(payload.token, 'Missing turnstile token')

    const secretKey = c.env.TURNSTILE_SECRET_KEY
    if (!secretKey) return c.json({ success: false, error: 'Server configuration error' }, 500)

    const formData = new FormData()
    formData.append('secret', secretKey)
    formData.append('response', token)
    const ip = getRequestIp(c.req.raw)
    if (ip) formData.append('remoteip', ip)

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
    })
    const verifyResult = await res.json() as any

    if (verifyResult.success) {
      return c.json({ success: true, ip })
    } else {
      return c.json({ success: false, error: 'Verification failed', codes: verifyResult['error-codes'] }, 400)
    }
  } catch (error: any) {
    if (typeof error?.status === 'number' && typeof error?.message === 'string') {
      return c.json({ success: false, error: error.message }, error.status)
    }
    console.error('[awcms-edge] Turnstile verification failed', error)
    return c.json({ success: false, error: 'Turnstile verification failed' }, 500)
  }
})

app.post('/functions/v1/get-client-ip', async (c) => {
  try {
    await requireBearerSession(c.env, c.req.raw)
    return c.json({ ip: getRequestIp(c.req.raw) })
  } catch (error) {
    return handleRouteError(c, error, 'Failed to resolve client IP')
  }
})

app.post('/functions/v1/xendit-payment', async (c) => {
  try {
    await requireBearerSession(c.env, c.req.raw)
    return c.json({
      error: 'Xendit payment route is not configured in the Cloudflare Edge API.',
    }, 501)
  } catch (error) {
    return handleRouteError(c, error, 'Failed to resolve Xendit payment request')
  }
})

app.post('/functions/v1/manage-users', async (c) => {
  const startedAt = Date.now()
  try {
    const supabaseAdmin = getAdminSupabase(c.env)
    const body = await requireJsonBody(c.req.raw)
    let { action, email, password, full_name, role_id, user_id, tenant_id, request_id, reason } = body as any

    // --- PUBLIC ACTIONS (No Auth Required) ---
    if (action === 'submit_application') {
      const turnstileToken = requireString(body.turnstileToken, 'Security check required')

      const secretKey = c.env.TURNSTILE_SECRET_KEY
      if (!secretKey) return c.json({ error: 'Server configuration error' }, 500)

      const formData = new FormData()
      formData.append('secret', secretKey)
      formData.append('response', turnstileToken)

      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: formData,
      });
      const verification = await res.json() as any;

      if (!verification.success) return c.json({ error: 'Security check failed' }, 400);

      if (!email || !full_name) return c.json({ error: 'Email and Full Name are required' }, 400);

      const { data: existingUser } = await supabaseAdmin.from('users').select('id').eq('email', email).maybeSingle();
      if (existingUser) return c.json({ error: 'Email already registered' }, 400);

      const { data: existingRequest } = await supabaseAdmin.from('account_requests').select('status').eq('email', email).maybeSingle();
      if (existingRequest && existingRequest.status !== 'rejected') return c.json({ error: 'Application already pending for this email' }, 400);

      const { data: newRequest, error: insertError } = await supabaseAdmin
        .from('account_requests')
        .insert({
          email,
          full_name,
          tenant_id: tenant_id || null,
          status: 'pending_admin'
        })
        .select()
        .single();
      if (insertError) return c.json({ error: 'Failed to submit application' }, 500);

      return c.json({ message: 'Application submitted successfully', id: newRequest.id }, 200);
    }

    // --- PROTECTED ACTIONS (Auth Required) ---
    const { hasServiceToken, requestingUser } = await resolveBearerOrServiceActor(supabaseAdmin, c.req.raw, {
      missingAuthMessage: 'Unauthorized: No authorization header provided',
      invalidTokenMessage: 'Unauthorized: Invalid token',
    })

    let roleName = 'service_key'
    let requesterTenantId = tenant_id || null
    let isSuperAdmin = true
    let isAdmin = true

    if (requestingUser) {
      const { data: userData, error: userDataError } = await supabaseAdmin
        .from('users')
        .select('role_id, tenant_id, role:roles!users_role_id_fkey(name, is_platform_admin, is_full_access, is_tenant_admin)')
        .eq('id', requestingUser.id)
        .single();

      if (userDataError || !userData?.role) return c.json({ error: 'Failed to fetch user role' }, 500)

      const r = Array.isArray(userData.role) ? userData.role[0] : userData.role as any
      roleName = r.name
      requesterTenantId = userData.tenant_id as string | null
      isSuperAdmin = Boolean(r.is_platform_admin || r.is_full_access)
      isAdmin = isSuperAdmin || Boolean(r.is_tenant_admin)
    }

    if (!isAdmin) return c.json({ error: 'Forbidden: Insufficient privileges' }, 403)

    let result = null;
    switch (action) {
      case 'approve_application_admin': {
        if (!request_id) return c.json({ error: 'request_id required' }, 400);
        const reqData = await loadAccountRequest(supabaseAdmin, request_id, '*')
        if (!reqData) return c.json({ error: 'Request not found' }, 404);
        enforceAccountRequestAccess({
          isSuperAdmin,
          requesterTenantId,
          accountRequest: reqData,
        })

        const { error: updateError } = await supabaseAdmin
          .from('account_requests')
          .update({
            status: 'pending_super_admin',
            admin_approved_at: new Date().toISOString(),
            admin_approved_by: requestingUser?.id ?? null
          })
          .eq('id', request_id);
        if (updateError) throw updateError;
        result = { message: 'Application approved by Admin' };
        break;
      }
      case 'approve_application_super_admin': {
        if (!isSuperAdmin) return c.json({ error: 'Forbidden: Platform admin only' }, 403);
        if (!request_id) return c.json({ error: 'request_id required' }, 400);
        const reqData = await loadAccountRequest(supabaseAdmin, request_id, '*')
        if (!reqData) return c.json({ error: 'Request not found' }, 404);
        const defaultTenantRole = await resolveAssignableRole(supabaseAdmin, {
          tenantId: reqData.tenant_id || null,
          allowPlatformRole: true,
        });
        const { data: invitedUser, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(reqData.email, {
          data: { full_name: reqData.full_name, tenant_id: reqData.tenant_id, role_id: defaultTenantRole.id }
        });
        if (inviteError) return c.json({ error: 'Failed to invite user' }, 500);
        await ensureManagedUserProfile(supabaseAdmin, {
          authUserId: invitedUser.user.id,
          email: reqData.email,
          fullName: reqData.full_name,
          tenantId: reqData.tenant_id || null,
          roleId: defaultTenantRole.id,
        });
        await supabaseAdmin.from('account_requests').update({
          status: 'completed',
          super_admin_approved_at: new Date().toISOString(),
          super_admin_approved_by: requestingUser?.id ?? null
        }).eq('id', request_id);
        result = { message: 'Application approved and Invitation sent', user_id: invitedUser.user.id };
        break;
      }
      case 'reject_application': {
        if (!request_id) return c.json({ error: 'request_id required' }, 400);
        const reqData = await loadAccountRequest(supabaseAdmin, request_id, 'tenant_id')
        enforceAccountRequestAccess({
          isSuperAdmin,
          requesterTenantId,
          accountRequest: reqData,
        })
        await supabaseAdmin.from('account_requests').update({
          status: 'rejected',
          rejection_reason: reason || 'No reason provided',
          updated_at: new Date().toISOString()
        }).eq('id', request_id);
        result = { message: 'Application rejected' };
        break;
      }
      case 'create': {
        if (!email) return c.json({ error: 'Email is required' }, 400);
        if (!password) return c.json({ error: 'Password is required' }, 400);
        tenant_id = enforceRequestedTenantScope({
          isSuperAdmin,
          requesterTenantId,
          requestedTenantId: tenant_id || null,
          mismatchMessage: 'Forbidden: Cannot create user for another tenant',
        }) as any
        try {
          const { user } = await provisionManagedUser(supabaseAdmin, {
            mode: 'create',
            email,
            password,
            fullName: full_name,
            tenantId: tenant_id || null,
            roleId: role_id || null,
            allowPlatformRole: isSuperAdmin,
          })
          result = { user, message: 'User created successfully' }
        } catch (error: any) {
          return c.json({ error: `Failed to create user: ${error?.message || 'Unknown error'}` }, 500)
        }
        break;
      }
      case 'invite': {
        if (!email) return c.json({ error: 'Email is required' }, 400);
        tenant_id = enforceRequestedTenantScope({
          isSuperAdmin,
          requesterTenantId,
          requestedTenantId: tenant_id || null,
          mismatchMessage: 'Forbidden: Cannot invite user to another tenant',
        }) as any
        try {
          const { user } = await provisionManagedUser(supabaseAdmin, {
            mode: 'invite',
            email,
            fullName: full_name,
            tenantId: tenant_id || null,
            roleId: role_id || null,
            allowPlatformRole: isSuperAdmin,
          })
          result = { user, message: 'User invited successfully' }
        } catch (error: any) {
          return c.json({ error: `Failed to invite user: ${error?.message || 'Unknown error'}` }, 500)
        }
        break;
      }
      case 'update': {
        if (!user_id) return c.json({ error: 'user_id required' }, 400);
        if (!isSuperAdmin) {
          const { data: target } = await supabaseAdmin.from('users').select('tenant_id').eq('id', user_id).single();
          enforceOwnedTargetTenant({
            isSuperAdmin,
            requesterTenantId,
            targetTenantId: target?.tenant_id,
          })
        }
        const updates: any = { updated_at: new Date().toISOString() };
        if (full_name) updates.full_name = full_name;
        if (role_id) {
          const { data: target } = await supabaseAdmin.from('users').select('tenant_id').eq('id', user_id).single();
          const assignableRole = await resolveAssignableRole(supabaseAdmin, {
            roleId: role_id,
            tenantId: target?.tenant_id || null,
            allowPlatformRole: isSuperAdmin,
          });
          updates.role_id = assignableRole.id;
        }
        const { error: updateError } = await supabaseAdmin.from('users').update(updates).eq('id', user_id);
        if (updateError) throw updateError;
        result = { message: 'User updated successfully' };
        break;
      }
      case 'delete': {
        if (!user_id) return c.json({ error: 'user_id required' }, 400);
        const { data: targetUser } = await supabaseAdmin.from('users').select('role_id, tenant_id').eq('id', user_id).single();
        enforceOwnedTargetTenant({
          isSuperAdmin,
          requesterTenantId,
          targetTenantId: targetUser?.tenant_id,
        })
        const { error: deleteError } = await supabaseAdmin.from('users').update({ deleted_at: new Date().toISOString() }).eq('id', user_id);
        if (deleteError) throw deleteError;
        result = { message: 'User deleted successfully' };
        break;
      }
      default:
        return c.json({ error: `Unknown action: ${action}` }, 400);
    }
    await writeAccessAudit(supabaseAdmin, {
      tenantId: requesterTenantId,
      userId: requestingUser?.id || null,
      action: 'users.manage',
      resource: 'user_management',
      details: { action, request_id: request_id || null, user_id: user_id || null },
      ipAddress: getRequestIp(c.req.raw),
      channel: 'worker',
      actorType: requestingUser?.id ? 'user' : 'system',
      actorRole: roleName,
      authContext: { has_session: Boolean(requestingUser?.id), is_super_admin: isSuperAdmin },
      moduleName: 'users',
      featureName: 'manage_users',
      actionName: action || 'manage',
      resourceType: 'user_management',
      resourceId: user_id || request_id || null,
      requestDurationMs: Date.now() - startedAt,
      routePath: '/functions/v1/manage-users',
      url: c.req.url,
      userAgent: c.req.header('user-agent') || null,
      purpose: 'manage tenant or platform users',
      triggerSource: 'awcms_edge_route',
      businessIntent: 'identity_administration',
      accessChannel: 'worker',
      accessMechanism: 'worker_route',
      authMethod: hasServiceToken ? 'service_token' : 'bearer_token',
    })

    return c.json(result, 200)
  } catch (error) {
    return handleRouteError(c, error, 'Manage users request failed', 400)
  }
})

app.post('/functions/v1/extensions-lifecycle', async (c) => {
  try {
    const startedAt = Date.now()
    const { callerClient, user } = await requireBearerSession(c.env, c.req.raw)
    const body = await requireJsonBody(c.req.raw)
    const action = requireString(body.action, 'Missing lifecycle action')
    const adminSupabase = getAdminSupabase(c.env)
    const userContext = await getUserContext(c.env, user.id)

    switch (action) {
      case 'catalog-register': {
        const canManageCatalog = userContext.isPlatformAdmin
          || userContext.isFullAccess
          || await hasAnyPermission(callerClient, ['platform.extensions.create', 'platform.extensions.manage'])
        if (!canManageCatalog) {
          return c.json({ error: 'Forbidden' }, 403)
        }

        const validation = validateExtensionManifest(body.manifest)
        const validationSummary = buildExtensionValidationSummary(validation)
        const manifest = (validation.manifest || (body.manifest && typeof body.manifest === 'object' ? body.manifest : {})) as Record<string, unknown>

        if (!validation.valid || !validation.manifest) {
          await writeFailedExtensionLifecycleAudit({
            adminSupabase,
            actorUserId: user.id,
            action: 'catalog-register',
            metadata: {
              errors: validation.errors,
              diagnostics: validationSummary,
            },
          })
        }

        const payload = {
          slug: typeof manifest.slug === 'string' ? manifest.slug : '',
          vendor: typeof manifest.vendor === 'string' ? manifest.vendor : '',
          name: typeof manifest.name === 'string' ? manifest.name : '',
          description: typeof body.description === 'string' ? body.description : null,
          version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
          kind: typeof manifest.kind === 'string' ? manifest.kind : 'external',
          scope: typeof manifest.scope === 'string' ? manifest.scope : 'tenant',
          source: typeof body.source === 'string' ? body.source : 'workspace',
          package_path: typeof body.packagePath === 'string' ? body.packagePath : null,
          checksum: typeof body.checksum === 'string' ? body.checksum : null,
          status: typeof body.status === 'string' ? body.status : 'active',
          compatibility: validation.manifest?.compatibility || {},
          capabilities: validation.manifest?.capabilities || [],
          manifest: body.manifest,
          runtime_mode: validationSummary.runtimeMode || 'trusted',
          validation_status: validationSummary.validationStatus,
          validation_summary: validationSummary,
        }

        if (!payload.slug || !payload.vendor || !payload.name || !payload.version || !payload.kind || !payload.scope) {
          return c.json({ error: validation.errors.join(', ') || 'Catalog manifest is missing required identity fields' }, 400)
        }

        const syncResult = await syncCatalogValidationState({
          adminSupabase,
          actorUserId: user.id,
          payload,
        })

        const { data, error } = await adminSupabase
          .from('platform_extension_catalog')
          .select('*')
          .eq('id', syncResult.catalog_id)
          .single()

        if (error || !data) {
          await writeFailedExtensionLifecycleAudit({
            adminSupabase,
            actorUserId: user.id,
            action: 'catalog-register',
            metadata: {
              message: error?.message || 'Catalog readback failed',
              extensionKey: getExtensionKey({ vendor: payload.vendor as string, slug: payload.slug as string }),
            },
          })
          return c.json({ error: error?.message || 'Catalog readback failed' }, 400)
        }

        await writeExtensionAudit(adminSupabase, {
          actorUserId: user.id,
          catalogId: data.id,
          action: 'catalog-register',
          status: 'succeeded',
          metadata: {
            extensionKey: getExtensionKey({ vendor: payload.vendor as string, slug: payload.slug as string }),
            validation_status: validationSummary.validationStatus,
            runtime_mode: validationSummary.runtimeMode,
            reason_categories: validationSummary.reasonCategories,
            previous_catalog_version: syncResult.previous_version || null,
            catalog_version: payload.version,
            auto_deactivated_count: syncResult.auto_deactivated_count || 0,
            auto_restored_count: syncResult.auto_restored_count || 0,
          },
        })

        await writeAccessAudit(adminSupabase, {
          tenantId: userContext.tenantId,
          userId: user.id,
          action: 'extensions.lifecycle',
          resource: 'extension_lifecycle',
          details: { action, catalog_id: data.id },
          ipAddress: getRequestIp(c.req.raw),
          channel: 'worker',
          actorType: 'user',
          authContext: { has_session: true },
          moduleName: 'extensions',
          featureName: 'lifecycle',
          actionName: action,
          resourceType: 'extension_catalog',
          resourceId: data.id,
          requestDurationMs: Date.now() - startedAt,
          routePath: '/functions/v1/extensions-lifecycle',
          url: c.req.url,
          userAgent: c.req.header('user-agent') || null,
          purpose: 'manage extension lifecycle actions',
          triggerSource: 'awcms_edge_route',
          businessIntent: 'extension_runtime_management',
          accessChannel: 'worker',
          accessMechanism: 'worker_route',
          authMethod: 'bearer_token',
        })
        const responsePayload: Record<string, unknown> = {
          ok: true,
          catalog: data,
          diagnostics: validationSummary,
          affectedTenantExtensions: {
            autoDeactivated: syncResult.auto_deactivated_count || 0,
            autoRestored: syncResult.auto_restored_count || 0,
          },
        }
        if (!validation.valid) {
          responsePayload.warning = validation.errors.join(', ')
        }
        return c.json(responsePayload)
      }

      case 'install': {
        const tenantId = resolveTenantId(typeof body.tenantId === 'string' ? body.tenantId : null, userContext)
        if (!tenantId) return c.json({ error: 'Missing tenant context' }, 400)

        const canInstall = userContext.isPlatformAdmin
          || userContext.isFullAccess
          || await hasAnyPermission(callerClient, ['platform.extensions.update', 'platform.extensions.manage', 'tenant.setting.update'])
        if (!canInstall) {
          return c.json({ error: 'Forbidden' }, 403)
        }

        const { data: catalog, error: catalogError } = await adminSupabase
          .from('platform_extension_catalog')
          .select('*')
          .eq('id', body.catalogId)
          .is('deleted_at', null)
          .single()
        if (catalogError || !catalog) {
          return c.json({ error: 'Extension catalog entry not found' }, 404)
        }

        const validation = validateExtensionManifest(catalog.manifest)
        if (!validation.valid || !validation.manifest) {
          return c.json({ error: 'Catalog manifest is invalid' }, 400)
        }
        if (catalog.validation_status === 'invalid') {
          return c.json({ error: 'Catalog manifest is invalid and cannot be installed until a valid update is published' }, 400)
        }

        const now = new Date().toISOString()
        const activationState = body.autoActivate === false ? 'installed' : 'active'

        const { data: tenantExtension, error } = await adminSupabase
          .from('tenant_extensions')
          .upsert({
            tenant_id: tenantId,
            catalog_id: catalog.id,
            installed_version: catalog.version,
            activation_state: activationState,
            desired_activation_state: activationState === 'active' ? 'active' : 'inactive',
            validation_status: catalog.validation_status || 'valid',
            validation_summary: catalog.validation_summary || {},
            config: typeof body.config === 'object' && body.config ? body.config : {},
            installed_at: now,
            activated_at: activationState === 'active' ? now : null,
              deactivated_at: activationState === 'active' ? null : now,
              created_by: user.id,
              updated_by: user.id,
              deleted_at: null,
              updated_at: now,
          }, { onConflict: 'tenant_id,catalog_id' })
          .select('*')
          .single()

        if (error || !tenantExtension) {
          await writeFailedExtensionLifecycleAudit({
            adminSupabase,
            tenantId,
            catalogId: catalog.id,
            actorUserId: user.id,
            action: 'install',
            metadata: { extensionKey: getExtensionKey(validation.manifest), message: error?.message || 'Install failed' },
          })
          return c.json({ error: error?.message || 'Install failed' }, 400)
        }

        const permissions = Array.isArray(validation.manifest.permissions) ? validation.manifest.permissions : []
        for (const permission of permissions) {
          const key = typeof permission === 'string' ? permission : permission.key
          if (!key) continue
          const parts = key.split('.')
          const resource = parts.length >= 2 ? parts[1] : validation.manifest.slug
          const actionName = parts.length >= 3 ? parts[2] : 'read'
          await adminSupabase.from('permissions').upsert({
            name: key,
            resource,
            action: actionName,
            description: typeof permission === 'string' ? `Registered by ${getExtensionKey(validation.manifest)}` : permission.description || `Registered by ${getExtensionKey(validation.manifest)}`,
            deleted_at: null,
          }, { onConflict: 'name' })
        }

        await syncTenantExtensionRoutes({
          adminSupabase,
          tenantId,
          catalog,
          tenantExtensionId: tenantExtension.id,
          manifest: validation.manifest,
        })

        await finalizeTenantExtensionLifecycle({
          adminSupabase,
          tenantId,
          catalog,
          tenantExtensionId: tenantExtension.id,
          actorUserId: user.id,
          action,
          request: c.req.raw,
          startedAt,
          metadata: { activationState },
        })
        return c.json({ ok: true, tenantExtension })
      }

      case 'activate':
      case 'deactivate':
      case 'config-update':
      case 'uninstall':
      case 'upgrade': {
        const { tenantExtension, catalog, tenantId } = await loadTenantExtensionForLifecycle({
          adminSupabase,
          tenantExtensionId: requireString(body.tenantExtensionId, 'Missing tenantExtensionId'),
          requestedTenantId: typeof body.tenantId === 'string' ? body.tenantId : null,
          userContext,
        })

        const canManageTenantExtension = userContext.isPlatformAdmin
          || userContext.isFullAccess
          || await hasAnyPermission(callerClient, ['platform.extensions.update', 'platform.extensions.manage', 'tenant.setting.update'])
        if (!canManageTenantExtension) {
          return c.json({ error: 'Forbidden' }, 403)
        }

        const now = new Date().toISOString()
        let updates: Record<string, unknown> = { updated_at: now, updated_by: user.id }

        if (action === 'activate') {
          if (catalog?.validation_status === 'invalid') {
            return c.json({ error: 'Cannot activate an extension with an invalid catalog manifest' }, 400)
          }
          updates = { ...updates, activation_state: 'active', desired_activation_state: 'active', activated_at: now, deactivated_at: null, deleted_at: null }
        }
        if (action === 'deactivate') {
          updates = { ...updates, activation_state: 'inactive', desired_activation_state: 'inactive', deactivated_at: now }
        }
        if (action === 'config-update') {
          updates = { ...updates, config: typeof body.config === 'object' && body.config ? body.config : {} }
        }
        if (action === 'uninstall') {
          updates = { ...updates, activation_state: 'uninstall_requested', desired_activation_state: 'inactive', deactivated_at: now, deleted_at: now }
        }
        if (action === 'upgrade') {
          if (compareVersions(String(catalog.version), String(tenantExtension.installed_version)) < 0) {
            return c.json({ error: 'Upgrade must be forward-only' }, 400)
          }
          if (catalog?.validation_status === 'invalid') {
            return c.json({ error: 'Cannot upgrade to an invalid catalog manifest' }, 400)
          }
          updates = {
            ...updates,
            installed_version: catalog.version,
            activation_state: 'active',
            desired_activation_state: 'active',
            validation_status: catalog.validation_status || 'valid',
            validation_summary: catalog.validation_summary || {},
            activated_at: now,
            deleted_at: null,
          }
        }

        const { data, error } = await adminSupabase
          .from('tenant_extensions')
          .update(updates)
          .eq('id', tenantExtension.id)
          .select('*')
          .single()

        if (error || !data) {
          await writeFailedExtensionLifecycleAudit({
            adminSupabase,
            tenantId,
            catalogId: catalog?.id,
            tenantExtensionId: tenantExtension.id,
            actorUserId: user.id,
            action,
            metadata: { message: error?.message || `${action} failed` },
          })
          return c.json({ error: error?.message || `${action} failed` }, 400)
        }

        if (action === 'deactivate' || action === 'uninstall') {
          await adminSupabase
            .from('tenant_extension_routes')
            .update({ is_active: false, updated_at: now })
            .eq('tenant_extension_id', tenantExtension.id)
        } else {
          await syncTenantExtensionRoutes({
            adminSupabase,
            tenantId,
            catalog,
            tenantExtensionId: tenantExtension.id,
            manifest: catalog?.manifest || {},
          })
        }

        await finalizeTenantExtensionLifecycle({
          adminSupabase,
          tenantId,
          catalog,
          tenantExtensionId: tenantExtension.id,
          actorUserId: user.id,
          action,
          request: c.req.raw,
          startedAt,
        })
        return c.json({ ok: true, tenantExtension: data })
      }

      case 'health-check': {
        const tenantId = resolveTenantId(typeof body.tenantId === 'string' ? body.tenantId : null, userContext)
        const canViewHealth = userContext.isPlatformAdmin
          || userContext.isFullAccess
          || await hasAnyPermission(callerClient, ['platform.extensions.read', 'tenant.setting.read'])
        if (!canViewHealth) {
          return c.json({ error: 'Forbidden' }, 403)
        }
        const { data: activeExtensions, error } = await adminSupabase
          .from('tenant_extensions')
          .select('id, catalog:platform_extension_catalog(slug, vendor, manifest)')
          .eq('tenant_id', tenantId)
          .eq('activation_state', 'active')
          .is('deleted_at', null)

        if (error) {
          return c.json({ error: error.message }, 400)
        }

        const extensionKeys = (activeExtensions || []).map((row: any) => {
          const catalog = Array.isArray(row.catalog) ? row.catalog[0] : row.catalog
          return catalog ? `${catalog.vendor}/${catalog.slug}` : row.id
        })
        const collisions = new Set(extensionKeys).size === extensionKeys.length ? 'ok' : 'error'
        const permissions = canViewHealth ? 'ok' : 'error'
        const registry = (activeExtensions || []).every((row: any) => {
          const catalog = Array.isArray(row.catalog) ? row.catalog[0] : row.catalog
          return validateExtensionManifest(catalog?.manifest).valid
        }) ? 'ok' : 'error'
        const checks = {
          database: 'ok',
          registry,
          collisions,
          permissions,
        }
        const score = Object.values(checks).every((status) => status === 'ok') ? 100 : 50

        await writeAccessAudit(adminSupabase, {
          tenantId,
          userId: user.id,
          action: 'extensions.health_check',
          resource: 'extension_health',
          details: { action, score },
          ipAddress: getRequestIp(c.req.raw),
          channel: 'worker',
          actorType: 'user',
          authContext: { has_session: true },
          moduleName: 'extensions',
          featureName: 'health_check',
          actionName: 'health_check',
          resourceType: 'extension_health',
          requestDurationMs: Date.now() - startedAt,
          routePath: '/functions/v1/extensions-lifecycle',
          url: c.req.url,
          userAgent: c.req.header('user-agent') || null,
          purpose: 'inspect extension health state',
          triggerSource: 'awcms_edge_route',
          businessIntent: 'extension_runtime_management',
          accessChannel: 'worker',
          accessMechanism: 'worker_route',
          authMethod: 'bearer_token',
        })
        return c.json({ ok: true, checks, score })
      }

      default:
        return c.json({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (error) {
    return handleRouteError(c, error, 'Unhandled extension lifecycle error', 400)
  }
})

app.post('/functions/v1/site-blueprints', async (c) => {
  try {
    const { callerClient, user } = await requireBearerSession(c.env, c.req.raw)
    const body = await c.req.json().catch(() => ({})) as Record<string, any>
    const action = typeof body.action === 'string' ? body.action : null

    if (action !== 'apply') {
      return c.json({ error: 'Unsupported action' }, 400)
    }

    const blueprintId = typeof body.blueprintId === 'string' ? body.blueprintId : null
    if (!blueprintId) {
      return c.json({ error: 'Missing blueprintId' }, 400)
    }

    const userContext = await getUserContext(c.env, user.id)

    const adminSupabase = getAdminSupabase(c.env)
    const tenantId = resolveTenantId(typeof body.tenantId === 'string' ? body.tenantId : null, userContext)
    if (!tenantId) {
      return c.json({ error: 'Missing tenant context' }, 400)
    }

    const canApplyBlueprint = userContext.isPlatformAdmin
      || userContext.isFullAccess
      || await hasAnyPermission(callerClient, ['platform.template.manage', 'tenant.setting.update'])

    if (!canApplyBlueprint) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const { data: blueprint, error: blueprintError } = await adminSupabase
      .from('site_blueprints')
      .select('*')
      .eq('id', blueprintId)
      .is('deleted_at', null)
      .single()

    if (blueprintError || !blueprint) {
      return c.json({ error: blueprintError?.message || 'Site blueprint not found' }, 404)
    }

    if (!userContext.isPlatformAdmin && !userContext.isFullAccess && blueprint.owner_tenant_id && blueprint.owner_tenant_id !== tenantId) {
      return c.json({ error: 'Blueprint does not belong to the active tenant' }, 403)
    }

    const payload = blueprint.blueprint_payload || {}
    const assignments = Array.isArray(payload.assignments) ? payload.assignments : []
    const settingsPayload = payload.settings && typeof payload.settings === 'object' ? payload.settings : {}
    const publicModules = Array.isArray(payload.publicModules) ? payload.publicModules : []
    const now = new Date().toISOString()

    const statePayload = {
      tenant_id: tenantId,
      blueprint_id: blueprint.id,
      payload_snapshot: payload,
      applied_by: user.id,
      applied_at: now,
      updated_at: now,
      deleted_at: null,
    }

    const { error: stateError } = await adminSupabase
      .from('tenant_site_blueprint_state')
      .upsert(statePayload, { onConflict: 'tenant_id' })

    if (stateError) {
      return c.json({ error: stateError.message }, 400)
    }

    const settingsRows = [
      {
        tenant_id: tenantId,
        key: 'site_blueprint.active',
        value: JSON.stringify({ blueprint_id: blueprint.id, slug: blueprint.slug, applied_at: now }),
        type: 'json',
        deleted_at: null,
      },
      {
        tenant_id: tenantId,
        key: 'site_blueprint.public_modules',
        value: JSON.stringify(publicModules),
        type: 'json',
        deleted_at: null,
      },
      {
        tenant_id: tenantId,
        key: 'site_blueprint.settings_payload',
        value: JSON.stringify(settingsPayload),
        type: 'json',
        deleted_at: null,
      },
    ]

    const { error: settingsError } = await adminSupabase
      .from('settings')
      .upsert(settingsRows, { onConflict: 'tenant_id,key' })

    if (settingsError) {
      return c.json({ error: settingsError.message }, 400)
    }

    for (const assignment of assignments) {
      if (!assignment || typeof assignment !== 'object' || !assignment.route_type || !assignment.template_id) {
        continue
      }

      const { error: assignmentError } = await adminSupabase
        .from('template_assignments')
        .upsert({
          tenant_id: tenantId,
          route_type: assignment.route_type,
          template_id: assignment.template_id,
          channel: typeof assignment.channel === 'string' ? assignment.channel : 'web',
          updated_at: now,
        }, { onConflict: 'tenant_id,channel,route_type' })

      if (assignmentError) {
        return c.json({ error: assignmentError.message }, 400)
      }
    }

    await writeAccessAudit(adminSupabase, {
      tenantId,
      userId: user.id,
      action: 'site_blueprints.apply',
      resource: 'site_blueprint',
      details: {
        blueprint_id: blueprint.id,
        blueprint_slug: blueprint.slug,
        assignment_count: assignments.length,
        public_module_count: publicModules.length,
      },
      ipAddress: getRequestIp(c.req.raw),
      channel: 'worker',
      actorType: 'user',
      authContext: { has_session: true },
      moduleName: 'templates',
      featureName: 'site_blueprints',
      actionName: 'apply',
      resourceType: 'site_blueprint',
      resourceId: blueprint.id,
      routePath: '/functions/v1/site-blueprints',
      url: c.req.raw.url,
      userAgent: c.req.raw.headers.get('user-agent') || null,
      purpose: 'apply tenant site blueprint',
      triggerSource: 'awcms_edge_route',
      businessIntent: 'site_blueprint_bootstrap',
      accessChannel: 'worker',
      accessMechanism: 'worker_route',
      authMethod: 'bearer_token',
    })

    return c.json({
      ok: true,
      blueprint: {
        id: blueprint.id,
        slug: blueprint.slug,
        name: blueprint.name,
      },
      applied: {
        assignments: assignments.length,
        publicModules: publicModules.length,
      },
    })
  } catch (error) {
    return handleRouteError(c, error, 'Failed to apply site blueprint')
  }
})

app.post('/functions/v1/reusable-sections', async (c) => {
  try {
    const { callerClient, user } = await requireBearerSession(c.env, c.req.raw)
    const body = await c.req.json().catch(() => ({})) as Record<string, any>
    const action = typeof body.action === 'string' ? body.action : null

    if (action !== 'materialize') {
      return c.json({ error: 'Unsupported action' }, 400)
    }

    const sectionId = typeof body.sectionId === 'string' ? body.sectionId : null
    if (!sectionId) {
      return c.json({ error: 'Missing sectionId' }, 400)
    }

    const userContext = await getUserContext(c.env, user.id)
    const adminSupabase = getAdminSupabase(c.env)
    const tenantId = resolveTenantId(typeof body.tenantId === 'string' ? body.tenantId : null, userContext)
    if (!tenantId) {
      return c.json({ error: 'Missing tenant context' }, 400)
    }

    const canManageSections = userContext.isPlatformAdmin
      || userContext.isFullAccess
      || await hasAnyPermission(callerClient, ['platform.template.manage', 'tenant.setting.update'])

    if (!canManageSections) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const { data: section, error: sectionError } = await adminSupabase
      .from('reusable_sections')
      .select('*')
      .eq('id', sectionId)
      .is('deleted_at', null)
      .single()

    if (sectionError || !section) {
      return c.json({ error: sectionError?.message || 'Reusable section not found' }, 404)
    }

    if (!userContext.isPlatformAdmin && !userContext.isFullAccess && section.owner_tenant_id && section.owner_tenant_id !== tenantId) {
      return c.json({ error: 'Reusable section does not belong to the active tenant' }, 403)
    }

    const partType = typeof body.partType === 'string' ? body.partType : section.metadata?.defaultPartType || 'widget_area'
    if (!['header', 'footer', 'sidebar', 'widget_area'].includes(partType)) {
      return c.json({ error: 'Unsupported partType' }, 400)
    }

    const now = new Date().toISOString()
    const slugBase = String(section.slug || section.name || 'reusable-section').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'reusable-section'
    const materializedSlug = `${slugBase}-${Date.now()}`
    const content = section.section_mode === 'template_part_reference' && section.template_part_id
      ? (await adminSupabase.from('template_parts').select('content').eq('id', section.template_part_id).maybeSingle()).data?.content || section.content || { content: [], root: {} }
      : (section.content || { content: [], root: {} })

    const { data: part, error: partError } = await adminSupabase
      .from('template_parts')
      .insert({
        tenant_id: tenantId,
        name: `${section.name} Part`,
        type: partType,
        slug: materializedSlug,
        content,
        is_active: true,
        updated_at: now,
        deleted_at: null,
      })
      .select('*')
      .single()

    if (partError || !part) {
      return c.json({ error: partError?.message || 'Failed to materialize reusable section' }, 400)
    }

    await writeAccessAudit(adminSupabase, {
      tenantId,
      userId: user.id,
      action: 'reusable_sections.materialize',
      resource: 'reusable_section',
      details: {
        section_id: section.id,
        section_slug: section.slug,
        section_mode: section.section_mode,
        materialized_part_id: part.id,
        part_type: partType,
      },
      ipAddress: getRequestIp(c.req.raw),
      channel: 'worker',
      actorType: 'user',
      authContext: { has_session: true },
      moduleName: 'templates',
      featureName: 'reusable_sections',
      actionName: 'materialize',
      resourceType: 'reusable_section',
      resourceId: section.id,
      routePath: '/functions/v1/reusable-sections',
      url: c.req.raw.url,
      userAgent: c.req.raw.headers.get('user-agent') || null,
      purpose: 'materialize reusable section into template part',
      triggerSource: 'awcms_edge_route',
      businessIntent: 'reusable_section_materialization',
      accessChannel: 'worker',
      accessMechanism: 'worker_route',
      authMethod: 'bearer_token',
    })

    return c.json({
      ok: true,
      section: {
        id: section.id,
        slug: section.slug,
        name: section.name,
        section_mode: section.section_mode,
      },
      part,
    })
  } catch (error) {
    return handleRouteError(c, error, 'Failed to materialize reusable section')
  }
})

app.post('/functions/v1/tenant-imports', async (c) => {
  try {
    const startedAt = Date.now()
    const { callerClient, user } = await requireBearerSession(c.env, c.req.raw)
    const body = await requireJsonBody(c.req.raw)
    const action = requireString(body.action, 'Missing action')
    const adminSupabase = getAdminSupabase(c.env)
    const userContext = await getUserContext(c.env, user.id)
    const tenantId = resolveTenantId(typeof body.tenantId === 'string' ? body.tenantId : null, userContext)

    if (!tenantId) {
      return c.json({ error: 'Missing tenant context' }, 400)
    }

    if (action === 'list') {
      const canRead = userContext.isPlatformAdmin || userContext.isFullAccess || await hasAnyPermission(callerClient, ['tenant.emdash_import.read'])
      if (!canRead) return c.json({ error: 'Forbidden' }, 403)

      const { data, error } = await adminSupabase
        .from('tenant_import_jobs')
        .select('*, sources:tenant_import_sources(*), artifacts:tenant_import_artifacts(*), mappings:tenant_import_mappings(*)')
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(25)

      if (error) return c.json({ error: error.message }, 400)
      return c.json({ ok: true, jobs: data || [] })
    }

    if (action === 'create-job') {
      const canCreate = userContext.isPlatformAdmin || userContext.isFullAccess || await hasAnyPermission(callerClient, ['tenant.emdash_import.create'])
      if (!canCreate) return c.json({ error: 'Forbidden' }, 403)

      const importType = typeof body.importType === 'string' ? body.importType : 'seed'
      const templateSlug = typeof body.templateSlug === 'string' ? body.templateSlug : null
      const parameters = typeof body.parameters === 'object' && body.parameters ? body.parameters : {}
      const source = typeof body.source === 'object' && body.source ? body.source as Record<string, unknown> : null
      const status = body.dryRun ? 'dry_run' : 'queued'
      const now = new Date().toISOString()

      const { data: job, error: jobError } = await adminSupabase
        .from('tenant_import_jobs')
        .insert({
          tenant_id: tenantId,
          source_system: 'emdash',
          import_type: importType,
          template_slug: templateSlug,
          status,
          requested_by: user.id,
          parameters,
          result_summary: body.dryRun ? { mode: 'dry_run' } : {},
          updated_at: now,
        })
        .select('*')
        .single()

      if (jobError || !job) {
        return c.json({ error: jobError?.message || 'Failed to create import job' }, 400)
      }

      if (source) {
        await adminSupabase.from('tenant_import_sources').upsert({
          tenant_id: tenantId,
          job_id: job.id,
          source_key: typeof source.sourceKey === 'string' ? source.sourceKey : `${templateSlug || 'emdash'}:${job.id}`,
          source_kind: typeof source.sourceKind === 'string' ? source.sourceKind : 'seed',
          source_locator: typeof source.sourceLocator === 'string' ? source.sourceLocator : null,
          source_version: typeof source.sourceVersion === 'string' ? source.sourceVersion : null,
          checksum: typeof source.checksum === 'string' ? source.checksum : null,
          source_payload: typeof source.sourcePayload === 'object' && source.sourcePayload ? source.sourcePayload : {},
          updated_at: now,
        }, { onConflict: 'job_id,source_key,source_kind' })
      }

      await adminSupabase.from('tenant_import_audit').insert({
        tenant_id: tenantId,
        job_id: job.id,
        actor_user_id: user.id,
        action: 'create-job',
        status: 'succeeded',
        metadata: { importType, templateSlug, dryRun: Boolean(body.dryRun) },
      })

      await writeAccessAudit(adminSupabase, {
        tenantId,
        userId: user.id,
        action: 'tenant_imports.create_job',
        resource: 'tenant_import_job',
        details: { importType, templateSlug, dryRun: Boolean(body.dryRun) },
        ipAddress: getRequestIp(c.req.raw),
        channel: 'worker',
        actorType: 'user',
        authContext: { has_session: true },
        moduleName: 'emdash_imports',
        featureName: 'import_jobs',
        actionName: 'create_job',
        resourceType: 'tenant_import_job',
        resourceId: job.id,
        requestDurationMs: Date.now() - startedAt,
        routePath: '/functions/v1/tenant-imports',
        url: c.req.url,
        userAgent: c.req.header('user-agent') || null,
        purpose: 'create tenant import job',
        triggerSource: 'awcms_edge_route',
        businessIntent: 'emdash_tenant_import',
        accessChannel: 'worker',
        accessMechanism: 'worker_route',
        authMethod: 'bearer_token',
      })

      if (!body.dryRun) {
        const executedJob = await executeEmdashImportJob({
          adminSupabase,
          tenantId,
          job,
          userId: user.id,
          templateSlug: templateSlug || 'blog',
          importType,
          sourceLocator: typeof source?.sourceLocator === 'string' ? source.sourceLocator : null,
        })

        return c.json({ ok: true, job: executedJob })
      }

      const { data: refreshedJob } = await adminSupabase
        .from('tenant_import_jobs')
        .select('*, sources:tenant_import_sources(*), artifacts:tenant_import_artifacts(*), mappings:tenant_import_mappings(*)')
        .eq('id', job.id)
        .maybeSingle()

      return c.json({ ok: true, job: refreshedJob || job })
    }

    return c.json({ error: `Unsupported action: ${action}` }, 400)
  } catch (error) {
    return handleRouteError(c, error, 'Failed to process tenant import request', 400)
  }
})

app.post('/functions/v1/extensions/tenant-route-token', async (c) => {
  try {
    const { callerClient, user } = await requireBearerSession(c.env, c.req.raw)
    const body = await requireJsonBody(c.req.raw)
    const userContext = await getUserContext(c.env, user.id)
    const tenantId = resolveTenantId(typeof body.tenantId === 'string' ? body.tenantId : null, userContext)
    if (!tenantId) {
      return c.json({ error: 'Missing tenant context' }, 400)
    }

    const canRead = userContext.isPlatformAdmin || userContext.isFullAccess || await hasAnyPermission(callerClient, ['tenant.setting.read', 'tenant.emdash_import.read'])
    if (!canRead) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const token = await issueTenantRouteToken({
      tenantId,
      secret: getExtensionRouteSecret(c.env),
      ttlSeconds: Number.parseInt(String(body.ttlSeconds || ''), 10) || 900,
    })

    return c.json({ ok: true, tenantId, tenantRoute: token })
  } catch (error) {
    return handleRouteError(c, error, 'Failed to issue tenant route token', 400)
  }
})

app.all('/functions/v1/ext/:tenantRoute/:vendor/:extension/*', async (c) => {
  try {
    const tenantRoute = c.req.param('tenantRoute')
    const vendor = c.req.param('vendor')
    const extensionSlug = c.req.param('extension')
    const routeTail = normalizeExtensionRoutePath(c.req.param('*') || 'index', vendor, extensionSlug)
    const routeMethod = c.req.method.toUpperCase()
    const resolvedTenant = await resolveTenantRouteToken({ token: tenantRoute, secret: getExtensionRouteSecret(c.env) })
    if (!resolvedTenant?.tenantId) {
      return c.json({ error: 'Invalid tenant route token' }, 401)
    }

    const adminSupabase = getAdminSupabase(c.env)
    const { data: routeRow, error: routeError } = await adminSupabase
      .from('tenant_extension_routes')
      .select('*, tenant_extension:tenant_extensions(id, activation_state, catalog:platform_extension_catalog(id, slug, vendor, manifest))')
      .eq('tenant_id', resolvedTenant.tenantId)
      .eq('vendor', vendor)
      .eq('extension_slug', extensionSlug)
      .eq('route_method', routeMethod)
      .eq('route_path', routeTail)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle()

    if (routeError) {
      return c.json({ error: routeError.message }, 400)
    }
    if (!routeRow) {
      return c.json({ error: 'Extension route not found' }, 404)
    }

    const visibility = routeRow.visibility || 'authenticated'
    let callerClient: any = null
    let user: any = null
    let userContext: UserContext | null = null

    if (visibility !== 'public') {
      const session = await requireBearerSession(c.env, c.req.raw)
      callerClient = session.callerClient
      user = session.user
      userContext = await getUserContext(c.env, user.id)
      const tenantId = resolveTenantId(resolvedTenant.tenantId, userContext)
      if (tenantId !== resolvedTenant.tenantId) {
        return c.json({ error: 'Tenant mismatch' }, 403)
      }
      if (routeRow.permission) {
        const allowed = userContext.isPlatformAdmin || userContext.isFullAccess || await hasAnyPermission(callerClient, [routeRow.permission])
        if (!allowed) {
          return c.json({ error: 'Forbidden' }, 403)
        }
      }
    }

    const handler = routeRow.metadata?.handler
    if (handler === 'events.health') {
      const { data: extensionRows, error: extensionError } = await adminSupabase
        .from('tenant_extensions')
        .select('id, catalog:platform_extension_catalog(slug, vendor)')
        .eq('tenant_id', resolvedTenant.tenantId)
        .eq('activation_state', 'active')
        .is('deleted_at', null)

      if (extensionError) return c.json({ error: 'Failed to load events extension status' }, 500)
      const isInstalled = (extensionRows || []).some((row: any) => {
        const catalog = Array.isArray(row.catalog) ? row.catalog[0] : row.catalog
        return catalog?.slug === 'events' && catalog?.vendor === 'ahliweb'
      })
      if (!isInstalled) return c.json({ error: 'Events extension is not active for this tenant' }, 404)

      const [{ count: upcomingCount }, { count: publishedCount }] = await Promise.all([
        adminSupabase.from('events').select('id', { count: 'exact', head: true }).eq('tenant_id', resolvedTenant.tenantId).eq('status', 'published').gte('start_at', new Date().toISOString()).is('deleted_at', null),
        adminSupabase.from('events').select('id', { count: 'exact', head: true }).eq('tenant_id', resolvedTenant.tenantId).eq('status', 'published').is('deleted_at', null),
      ])

      return c.json({
        ok: true,
        tenantId: resolvedTenant.tenantId,
        extension: `${vendor}/${extensionSlug}`,
        capability: routeRow.capability,
        counts: { published: publishedCount || 0, upcoming: upcomingCount || 0 },
      })
    }

    if (handler === 'events.public') {
      const limit = Number.parseInt(c.req.query('limit') || '12', 10)
      const slug = c.req.query('slug') || ''
      const { data: extensionRows, error: extensionError } = await adminSupabase
        .from('tenant_extensions')
        .select('id, catalog:platform_extension_catalog(slug, vendor)')
        .eq('tenant_id', resolvedTenant.tenantId)
        .eq('activation_state', 'active')
        .is('deleted_at', null)

      if (extensionError) return c.json({ error: 'Failed to load events extension status' }, 500)
      const hasEventsExtension = (extensionRows || []).some((row: any) => {
        const catalog = Array.isArray(row.catalog) ? row.catalog[0] : row.catalog
        return catalog?.slug === 'events' && catalog?.vendor === 'ahliweb'
      })
      if (!hasEventsExtension) return c.json({ ok: true, events: [] })

      let query = adminSupabase
        .from('events')
        .select('id, title, slug, summary, location, start_at, end_at, published_at, status')
        .eq('tenant_id', resolvedTenant.tenantId)
        .eq('status', 'published')
        .is('deleted_at', null)

      if (slug) {
        query = query.eq('slug', slug)
      } else {
        query = query.order('start_at', { ascending: true }).limit(Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 48) : 12)
      }

      const { data: events, error } = await query
      if (error) return c.json({ error: 'Failed to load events' }, 500)
      if (slug) return c.json({ ok: true, event: Array.isArray(events) ? (events[0] || null) : null })
      return c.json({ ok: true, events: events || [] })
    }

    return c.json({
      ok: false,
      message: 'Extension route is registered but no runtime handler is implemented yet.',
      tenantId: resolvedTenant.tenantId,
      extension: `${vendor}/${extensionSlug}`,
      route: routeTail,
      capability: routeRow.capability,
    }, 501)
  } catch (error) {
    return handleRouteError(c, error, 'Failed to execute extension route', 400)
  }
})

app.get('/functions/v1/extensions/events/health', async (c) => {
  try {
    const { callerClient, user } = await requireBearerSession(c.env, c.req.raw)
    const userContext = await getUserContext(c.env, user.id)
    const tenantId = resolveTenantId(c.req.query('tenantId') || null, userContext)
    if (!tenantId) {
      return c.json({ error: 'Missing tenant context' }, 400)
    }

    const canReadEvents = userContext.isPlatformAdmin
      || userContext.isFullAccess
      || await hasAnyPermission(callerClient, ['tenant.events.read'])
    if (!canReadEvents) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const adminSupabase = getAdminSupabase(c.env)
    const { data: eventsExtension, error: extensionError } = await adminSupabase
      .from('tenant_extensions')
      .select('id, catalog:platform_extension_catalog(slug, vendor)')
      .eq('tenant_id', tenantId)
      .eq('activation_state', 'active')
      .is('deleted_at', null)

    if (extensionError) {
      console.error('[extensions/events/health] Failed to load tenant extensions', extensionError)
      return c.json({ error: 'Failed to load events extension status' }, 500)
    }

    const isInstalled = (eventsExtension || []).some((row: any) => {
      const catalog = Array.isArray(row.catalog) ? row.catalog[0] : row.catalog
      return catalog?.slug === 'events' && catalog?.vendor === 'ahliweb'
    })
    if (!isInstalled) {
      return c.json({ error: 'Events extension is not active for this tenant' }, 404)
    }

    const [{ count: upcomingCount }, { count: publishedCount }] = await Promise.all([
      adminSupabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'published')
        .gte('start_at', new Date().toISOString())
        .is('deleted_at', null),
      adminSupabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'published')
        .is('deleted_at', null),
    ])

    return c.json({
      ok: true,
      tenantId,
      capability: 'events:health',
      counts: {
        published: publishedCount || 0,
        upcoming: upcomingCount || 0,
      },
    })
  } catch (error) {
    return handleRouteError(c, error, 'Failed to load events health')
  }
})

app.get('/functions/v1/extensions/events/public', async (c) => {
  try {
    const tenantId = c.req.query('tenantId') || ''
    const limit = Number.parseInt(c.req.query('limit') || '12', 10)
    const slug = c.req.query('slug') || ''

    if (!tenantId) {
      return c.json({ error: 'Missing tenantId' }, 400)
    }

    const adminSupabase = getAdminSupabase(c.env)
    const { data: extensionRows, error: extensionError } = await adminSupabase
      .from('tenant_extensions')
      .select('id, catalog:platform_extension_catalog(slug, vendor)')
      .eq('tenant_id', tenantId)
      .eq('activation_state', 'active')
      .is('deleted_at', null)

    if (extensionError) {
      console.error('[extensions/events/public] Failed to load tenant extensions', extensionError)
      return c.json({ error: 'Failed to load events extension status' }, 500)
    }

    const hasEventsExtension = (extensionRows || []).some((row: any) => {
      const catalog = Array.isArray(row.catalog) ? row.catalog[0] : row.catalog
      return catalog?.slug === 'events' && catalog?.vendor === 'ahliweb'
    })

    if (!hasEventsExtension) {
      return c.json({ ok: true, events: [] })
    }

    let query = adminSupabase
      .from('events')
      .select('id, title, slug, summary, location, start_at, end_at, published_at, status')
      .eq('tenant_id', tenantId)
      .eq('status', 'published')
      .is('deleted_at', null)

    if (slug) {
      query = query.eq('slug', slug)
    } else {
      query = query.order('start_at', { ascending: true })
        .limit(Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 48) : 12)
    }

    const { data: events, error } = await query

    if (error) {
      console.error('[extensions/events/public] Failed to load events', error)
      return c.json({ error: 'Failed to load events' }, 500)
    }

    if (slug) {
      return c.json({ ok: true, event: Array.isArray(events) ? (events[0] || null) : null })
    }

    return c.json({ ok: true, events: events || [] })
  } catch (error) {
    return handleRouteError(c, error, 'Failed to load public events')
  }
})

app.get('/functions/v1/extensions/public-modules', async (c) => {
  const tenantId = c.req.query('tenantId') || ''
  if (!tenantId) {
    return c.json({ error: 'Missing tenantId' }, 400)
  }

  const adminSupabase = getAdminSupabase(c.env)
  const { data, error } = await adminSupabase
    .from('tenant_extensions')
    .select('catalog:platform_extension_catalog(manifest)')
    .eq('tenant_id', tenantId)
    .eq('activation_state', 'active')
    .is('deleted_at', null)

  if (error) {
    return c.json({ error: error.message }, 400)
  }

  const modules = (data || []).flatMap((row: any) => {
    const catalog = Array.isArray(row.catalog) ? row.catalog[0] : row.catalog
    const manifest = catalog?.manifest
    return Array.isArray(manifest?.publicModules) ? manifest.publicModules : []
  })

  return c.json({ ok: true, modules })
})

// redirect /functions/v1/serve-sitemap to /public/sitemap
app.get('/functions/v1/serve-sitemap', (c) => {
  const url = new URL(c.req.url);
  url.pathname = '/public/sitemap';
  return c.redirect(url.toString(), 301);
});

// ---------------------------------------------------------------------------
// Queue Dead-Letter Replay — POST /api/admin/queue/replay
// Superadmin-only. Re-enqueues a dead-letter row onto its originating live
// queue and marks the row as replayed.
// ---------------------------------------------------------------------------

app.post('/api/admin/queue/replay', async (c) => {
  try {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)

    let userContext: Awaited<ReturnType<typeof getUserContext>>
    try {
      userContext = await getUserContext(c.env, user.id)
    } catch {
      return c.json({ error: 'Unable to resolve user context' }, 403)
    }

    if (!userContext.isPlatformAdmin && !userContext.isFullAccess) {
      return c.json({ error: 'Forbidden: superadmin required' }, 403)
    }

    const body = await requireJsonBody(c.req.raw)
    const id = requireString(body.id, 'Missing required field: id')
    const adminSupabase = getAdminSupabase(c.env)

    const { data: row, error: fetchError } = await adminSupabase
      .from('queue_dead_letters')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (fetchError) {
      console.error('[queue/replay] Failed to fetch dead-letter row', fetchError)
      return c.json({ error: 'Failed to load dead-letter record' }, 500)
    }
    if (!row) {
      return c.json({ error: 'Dead-letter record not found' }, 404)
    }
    if (row.replayed_at !== null) {
      return c.json({ error: 'Message has already been replayed', replayed_at: row.replayed_at }, 409)
    }

    let targetQueue: Queue<AnyQueueMessage> | null = null
    if (row.queue_name === 'awcms-media-events-dlq') {
      targetQueue = (c.env as any).MEDIA_EVENTS_QUEUE
    } else if (row.queue_name === 'awcms-notifications-dlq') {
      targetQueue = (c.env as any).NOTIFICATIONS_QUEUE
    }

    if (!targetQueue) {
      return c.json({ error: `Unknown or unroutable queue: ${row.queue_name}` }, 400)
    }

    const replayed_job_id = crypto.randomUUID()
    await targetQueue.send(row.payload as AnyQueueMessage)

    const { error: updateError } = await adminSupabase
      .from('queue_dead_letters')
      .update({
        replayed_at: new Date().toISOString(),
        replayed_by: userContext.id,
        replayed_job_id,
      })
      .eq('id', id)

    if (updateError) {
      console.error('[queue/replay] Failed to mark dead-letter row as replayed:', updateError.message)
    }

    logReplay(
      {
        queue: row.queue_name,
        event_type: row.event_type,
        job_id: row.job_id,
        tenant_id: row.tenant_id ?? '',
      },
      { extra: { replayed_job_id, replayed_by: userContext.id, dead_letter_id: id } },
    )

    return c.json({ ok: true, replayed_job_id })
  } catch (error) {
    return handleRouteError(c, error, 'Failed to replay dead-letter message')
  }
})

export default {
  /**
   * HTTP request handler — all Hono routes.
   */
  fetch: app.fetch,

  /**
   * Cloudflare Queue consumer — routes incoming message batches to the
   * appropriate consumer by queue name.
   *
   * Registered queues (wrangler.jsonc):
   *   - awcms-media-events         → mediaQueueHandler
   *   - awcms-notifications        → notificationsQueueHandler
   *   - awcms-media-events-dlq     → dlqQueueHandler (DLQ sink → queue_dead_letters)
   *   - awcms-notifications-dlq    → dlqQueueHandler (DLQ sink → queue_dead_letters)
   */
  async queue(batch: MessageBatch<AnyQueueMessage>, env: Bindings): Promise<void> {
    try {
      if (batch.queue === 'awcms-media-events') {
        await mediaQueueHandler(batch, env)
      } else if (batch.queue === 'awcms-notifications') {
        await notificationsQueueHandler(batch, env)
      } else if (batch.queue === 'awcms-media-events-dlq') {
        await dlqQueueHandler(batch, env, 'awcms-media-events-dlq')
      } else if (batch.queue === 'awcms-notifications-dlq') {
        await dlqQueueHandler(batch, env, 'awcms-notifications-dlq')
      } else {
        console.warn(`[queue] unknown queue: ${batch.queue} — ${batch.messages.length} message(s) dropped`)
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[queue] unhandled dispatcher error on queue "${batch.queue}": ${errMsg}`)
      batch.retryAll()
    }
  },
}
