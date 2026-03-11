import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createClient } from '@supabase/supabase-js'
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { generateStorageKey, inferMediaKind, slugifyMediaValue, UploadSessionRequest } from './mediaContracts'

type Bindings = {
  STORAGE: R2Bucket
  VITE_SUPABASE_URL: string
  VITE_SUPABASE_PUBLISHABLE_KEY: string
  SUPABASE_SECRET_KEY: string
  R2_ACCOUNT_ID: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
  R2_BUCKET_NAME: string
  MEDIA_SECURE_SESSION_MAX_AGE_SECONDS?: string
  MAILKETING_API_TOKEN: string
  MAILKETING_DEFAULT_LIST_ID?: string
  GITHUB_REBUILD_TOKEN?: string
  GITHUB_REBUILD_OWNER?: string
  GITHUB_REBUILD_REPO?: string
  GITHUB_REBUILD_EVENT_TYPE?: string
  SMANDAPBUN_REBUILD_WEBHOOK_SECRET?: string
  TURNSTILE_SECRET_KEY?: string
}

type Variables = {
  user: any
  token: string
  supabase: any
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

app.use('*', cors())

app.get('/health', (c) => c.json({ ok: true, service: 'awcms-edge' }))

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

const headStoredObject = (env: Bindings, storageKey: string) => {
  const client = getR2S3Client(env)
  return client.send(new HeadObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: storageKey,
  }))
}

const getStoredObject = (env: Bindings, storageKey: string) => {
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

const getJsonBody = async (request: Request) => {
  try {
    return await request.json<Record<string, unknown>>()
  } catch {
    return null
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

const getUserContext = async (env: Bindings, userId: string) => {
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

// Request an upload session
app.post('/api/media/upload-session', async (c) => {
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
    const s3 = getR2S3Client(c.env)
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: c.env.R2_BUCKET_NAME,
        Key: storageKey,
        ContentType: body.mimeType,
      }),
      { expiresIn: 15 * 60 }
    )

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

// Finalize upload after the client PUTs directly to signed R2 URL
app.post('/api/media/upload/:sessionId/finalize', async (c) => {
  const sessionId = c.req.param('sessionId');
  const user = c.get('user');
  const adminSupabase = getAdminSupabase(c.env)

  try {
    const { data: session, error: sessionError } = await adminSupabase
      .from('media_upload_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session || session.status !== 'pending' || session.uploader_id !== user.id) {
      return c.json({ error: 'Invalid or expired upload session' }, 403);
    }

    if (new Date(session.expires_at) < new Date()) {
      return c.json({ error: 'Session expired' }, 403);
    }

    let object
    try {
      object = await headStoredObject(c.env, session.storage_key)
    } catch {
      object = null
    }

    if (!object) {
      return c.json({ error: 'Uploaded file not found in storage' }, 404)
    }

    const { data: mediaObject, error: insertError } = await adminSupabase
      .from('media_objects')
      .upsert({
        tenant_id: session.tenant_id,
        title: slugifyMediaValue(session.file_name).replace(/-/g, ' ').trim() || session.file_name,
        file_name: session.file_name,
        original_name: session.file_name,
        slug: buildMediaSlug(session.file_name, session.id),
        description: null,
        alt_text: session.file_name,
        mime_type: session.mime_type,
        media_kind: inferMediaKind(session.mime_type),
        size_bytes: object.ContentLength || session.size_bytes || 0,
        storage_key: session.storage_key,
        category_id: session.category_id || null,
        uploader_id: user.id,
        status: 'uploaded',
        access_control: session.access_control || 'public',
        session_bound_access: Boolean(session.session_bound_access),
        meta_data: {
          ...(session.meta_data || {}),
          etag: object.ETag,
          uploaded_via: 'cloudflare-r2',
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'storage_key' })
      .select('*')
      .single();

    if (insertError) {
      return c.json({ error: 'Failed to create media object', details: insertError }, 500);
    }

    await adminSupabase
      .from('media_upload_sessions')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', sessionId);

    return c.json({
      mediaObject,
      publicUrl: buildPublicMediaUrl(c.req.url, session.storage_key),
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to finalize upload' }, 500)
  }
});

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

    ensureR2SigningConfig(c.env)
    const signedUrl = await getSignedUrl(
      getR2S3Client(c.env),
      new GetObjectCommand({
        Bucket: c.env.R2_BUCKET_NAME,
        Key: media.storage_key,
      }),
      { expiresIn: windowState.expiresIn },
    )

    await getAdminSupabase(c.env)
      .from('media_access_audit')
      .insert({
        media_object_id: media.id,
        tenant_id: media.tenant_id,
        accessor_id: c.get('user')?.id || null,
        action: 'read',
      })

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

  const githubToken = c.env.GITHUB_REBUILD_TOKEN?.trim()
  const githubOwner = c.env.GITHUB_REBUILD_OWNER?.trim()
  const githubRepo = c.env.GITHUB_REBUILD_REPO?.trim()
  const eventType = c.env.GITHUB_REBUILD_EVENT_TYPE?.trim() || 'smandapbun-content-changed'

  if (!githubToken || !githubOwner || !githubRepo) {
    return c.json({ error: 'GitHub rebuild integration is not configured' }, 500)
  }

  const payload = await getJsonBody(c.req.raw)
  const dispatchResponse = await fetch(`https://api.github.com/repos/${githubOwner}/${githubRepo}/dispatches`, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${githubToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'awcms-edge-public-rebuild',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      event_type: eventType,
      client_payload: {
        source: 'supabase-trigger',
        tenant_slug: 'smandapbun',
        tenant_id: payload?.tenant_id || null,
        table: payload?.table || null,
        operation: payload?.operation || null,
        changed_at: payload?.changed_at || new Date().toISOString(),
      },
    }),
  })

  if (!dispatchResponse.ok) {
    const responseText = await dispatchResponse.text()
    return c.json({
      error: 'Failed to dispatch GitHub deployment workflow',
      details: responseText,
      status: dispatchResponse.status,
    }, 502)
  }

  return c.json({
    ok: true,
    eventType,
    repository: `${githubOwner}/${githubRepo}`,
  })
})

app.post('/api/public/rebuild', async (c) => {
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

  const body = await getJsonBody(c.req.raw)
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

  const response = await fetch(hookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'awcms-edge-public-rebuild',
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      source: 'admin-panel',
      resource: body?.resource || null,
      action: body?.action || 'update',
      actor_id: user.id,
      triggered_at: new Date().toISOString(),
    }),
  })

  if (!response.ok) {
    const details = await response.text()
    return c.json({ error: 'Failed to trigger deploy hook', details, status: response.status }, 502)
  }

  return c.json({ ok: true, tenantId, hookUrlConfigured: true })
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
  const apiToken = c.env.MAILKETING_API_TOKEN;
  if (!apiToken) {
    return c.json({ error: 'MAILKETING_API_TOKEN not configured' }, 500);
  }

  const body = await c.req.json();
  const { action } = body;

  let endpoint = '';
  let params: Record<string, string | number> = {};

  switch (action) {
    case 'send':
      endpoint = '/send';
      params = {
        api_token: apiToken,
        from_name: body.from_name || 'AWCMS',
        from_email: body.from_email || 'noreply@awcms.com',
        recipient: body.recipient || '',
        subject: body.subject || '',
        content: body.content || '',
      };
      if (body.attach1) params.attach1 = body.attach1;
      if (body.attach2) params.attach2 = body.attach2;
      if (body.attach3) params.attach3 = body.attach3;
      break;
    case 'subscribe':
      endpoint = '/addsubtolist';
      params = {
        api_token: apiToken,
        list_id: body.list_id || c.env.MAILKETING_DEFAULT_LIST_ID || 1,
        email: body.email || '',
      };
      if (body.first_name) params.first_name = body.first_name;
      if (body.last_name) params.last_name = body.last_name;
      if (body.phone) params.phone = body.phone;
      if (body.mobile) params.mobile = body.mobile;
      if (body.city) params.city = body.city;
      if (body.state) params.state = body.state;
      if (body.country) params.country = body.country;
      if (body.company) params.company = body.company;
      break;
    case 'credits':
      endpoint = '/ceksaldo';
      params = { api_token: apiToken };
      break;
    case 'lists':
      endpoint = '/viewlist';
      params = { api_token: apiToken };
      break;
    default:
      return c.json({ error: 'Invalid action. Use: send, subscribe, credits, lists' }, 400);
  }

  const formData = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    formData.append(key, String(value));
  }

  try {
    const response = await fetch(`${MAILKETING_API}${endpoint}`, {
      method: 'POST',
      body: formData,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const result = await response.json() as Record<string, any>;
    
    const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || 'unknown';
    return c.json({ ...result, client_ip: clientIp });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
};

app.post('/api/mailketing', handleMailketing);
app.post('/functions/v1/mailketing', handleMailketing);

// ---- SUPABASE EDGE FUNCTION MIGRATIONS ----

app.post('/functions/v1/content-transform', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) return c.json({ error: 'Unauthorized' }, 401);

  const supabaseUrl = c.env.VITE_SUPABASE_URL;
  const publishableKey = c.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const callerClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: authData, error: authError } = await callerClient.auth.getUser();
  if (authError || !authData?.user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const tenantId = c.req.header('x-tenant-id');
  if (!tenantId) return c.json({ error: 'Missing x-tenant-id header' }, 400);

  const adminClient = getAdminSupabase(c.env);
  const payload = await getJsonBody(c.req.raw);
  if (!payload?.blog_id || !payload?.transformed) {
    return c.json({ error: 'Missing blog_id or transformed content' }, 400);
  }

  const { data, error } = await adminClient
    .from('blogs')
    .update({
      content: payload.transformed,
      updated_at: new Date().toISOString(),
    })
    .eq('id', payload.blog_id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .select('id')
    .single();

  if (error) return c.json({ error: error.message }, 400);
  if (!data) return c.json({ error: 'Blog not found or access denied' }, 404);

  return c.json({ ok: true, id: data.id }, 200);
});

app.post('/functions/v1/mailketing-webhook', async (c) => {
  try {
    const supabase = getAdminSupabase(c.env);
    const payload = await getJsonBody(c.req.raw) as any;
    if (!payload) return c.json({ error: 'Invalid JSON' }, 400);

    const type = String(payload.type);
    const email = String(payload.email);

    const eventTypeMap: Record<string, string> = {
      'newsubscriber': 'subscribed',
      'unsubscribe': 'unsubscribed',
      'emailopen': 'opened',
      'emailclick': 'clicked',
      'bounce': 'bounced',
    };
    const eventType = eventTypeMap[type] || type;

    const { error } = await supabase.from('email_logs').insert({
      event_type: eventType,
      recipient: email,
      metadata: payload,
    });

    if (error) console.error('[Mailketing Webhook] DB Error:', error);

    if (type === 'bounce' || type === 'unsubscribe') {
      await supabase
        .from('users')
        .update({
          email_verified: false,
          metadata: {
            email_status: type === 'bounce' ? 'bounced' : 'unsubscribed',
            email_status_reason: payload.reason,
            email_status_date: payload.date || new Date().toISOString(),
          }
        })
        .eq('email', email);
    }
    return c.json({ status: 'success', event: eventType });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

app.post('/functions/v1/verify-turnstile', async (c) => {
  try {
    const payload = await getJsonBody(c.req.raw) as any;
    const token = payload?.token;
    if (!token) return c.json({ success: false, error: 'Missing turnstile token' }, 400);

    const secretKey = c.env.TURNSTILE_SECRET_KEY;
    if (!secretKey) return c.json({ success: false, error: 'Server configuration error' }, 500);

    const formData = new FormData();
    formData.append('secret', secretKey);
    formData.append('response', token);
    const ip = getRequestIp(c.req.raw);
    if (ip) formData.append('remoteip', ip);

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
    });
    const verifyResult = await res.json() as any;

    if (verifyResult.success) {
      return c.json({ success: true, ip });
    } else {
      return c.json({ success: false, error: 'Verification failed', codes: verifyResult['error-codes'] }, 400);
    }
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

app.post('/functions/v1/get-client-ip', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) return c.json({ error: 'Unauthorized' }, 401);

  const token = authHeader.replace('Bearer ', '');
  const callerClient = createClient(c.env.VITE_SUPABASE_URL, c.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: authData, error: authError } = await callerClient.auth.getUser();
  if (authError || !authData?.user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return c.json({ ip: getRequestIp(c.req.raw) });
});

app.post('/functions/v1/xendit-payment', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) return c.json({ error: 'Unauthorized' }, 401);

  const token = authHeader.replace('Bearer ', '');
  const callerClient = createClient(c.env.VITE_SUPABASE_URL, c.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: authData, error: authError } = await callerClient.auth.getUser();
  if (authError || !authData?.user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return c.json({
    error: 'Xendit payment route is not configured in the Cloudflare Edge API.',
  }, 501);
});

app.post('/functions/v1/manage-users', async (c) => {
  try {
    const supabaseAdmin = getAdminSupabase(c.env);
    const body = await getJsonBody(c.req.raw) as any || {};
    let { action, email, password, full_name, role_id, user_id, tenant_id, request_id, reason } = body;

    // --- PUBLIC ACTIONS (No Auth Required) ---
    if (action === 'submit_application') {
      const turnstileToken = body.turnstileToken;
      if (!turnstileToken) return c.json({ error: 'Security check required' }, 400);

      const secretKey = c.env.TURNSTILE_SECRET_KEY;
      if (!secretKey) return c.json({ error: 'Server configuration error' }, 500);

      const formData = new FormData();
      formData.append('secret', secretKey);
      formData.append('response', turnstileToken);

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
    const authHeader = c.req.header('Authorization');
    if (!authHeader) return c.json({ error: 'Unauthorized: No authorization header provided' }, 401);

    const token = authHeader.replace('Bearer ', '');
    const hasServiceToken = token.startsWith('sb_secret_');
    let requestingUser = null;

    if (!hasServiceToken) {
      const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
      if (authError || !authData?.user) return c.json({ error: 'Unauthorized: Invalid token' }, 401);
      requestingUser = authData.user;
    }

    let roleName = 'service_key';
    let requesterTenantId = tenant_id || null;
    let isSuperAdmin = true;
    let isAdmin = true;

    if (requestingUser) {
      const { data: userData, error: userDataError } = await supabaseAdmin
        .from('users')
        .select('role_id, tenant_id, role:roles!users_role_id_fkey(name, is_platform_admin, is_full_access, is_tenant_admin)')
        .eq('id', requestingUser.id)
        .single();

      if (userDataError || !userData?.role) return c.json({ error: 'Failed to fetch user role' }, 500);

      const r = Array.isArray(userData.role) ? userData.role[0] : userData.role as any;
      roleName = r.name;
      requesterTenantId = userData.tenant_id as string | null;
      isSuperAdmin = Boolean(r.is_platform_admin || r.is_full_access);
      isAdmin = isSuperAdmin || Boolean(r.is_tenant_admin);
    }

    if (!isAdmin) return c.json({ error: 'Forbidden: Insufficient privileges' }, 403);

    let result = null;
    switch (action) {
      case 'approve_application_admin': {
        if (!request_id) return c.json({ error: 'request_id required' }, 400);
        const { data: reqData } = await supabaseAdmin.from('account_requests').select('*').eq('id', request_id).single();
        if (!reqData) return c.json({ error: 'Request not found' }, 404);
        if (!isSuperAdmin && reqData.tenant_id && reqData.tenant_id !== requesterTenantId) return c.json({ error: 'Forbidden' }, 403);

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
        const { data: reqData } = await supabaseAdmin.from('account_requests').select('*').eq('id', request_id).single();
        if (!reqData) return c.json({ error: 'Request not found' }, 404);
        const { data: invitedUser, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(reqData.email, {
          data: { full_name: reqData.full_name, tenant_id: reqData.tenant_id }
        });
        if (inviteError) return c.json({ error: 'Failed to invite user' }, 500);
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
        const { data: reqData } = await supabaseAdmin.from('account_requests').select('tenant_id').eq('id', request_id).single();
        if (!isSuperAdmin && reqData?.tenant_id && reqData.tenant_id !== requesterTenantId) return c.json({ error: 'Forbidden' }, 403);
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
        if (!isSuperAdmin) {
          if (!requesterTenantId) return c.json({ error: 'Forbidden: no tenant context' }, 403);
          if (tenant_id && tenant_id !== requesterTenantId) return c.json({ error: 'Forbidden: Cannot create user for another tenant' }, 403);
          tenant_id = requesterTenantId as any;
        }
        const { data: newAuthUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: { full_name, tenant_id }
        });
        if (createError) return c.json({ error: 'Failed to create user: ' + createError.message }, 500);
        result = { user: newAuthUser.user, message: 'User created successfully' };
        break;
      }
      case 'invite': {
        if (!email) return c.json({ error: 'Email is required' }, 400);
        if (!isSuperAdmin) {
          if (!requesterTenantId) return c.json({ error: 'Forbidden: no tenant context' }, 403);
          if (tenant_id && tenant_id !== requesterTenantId) return c.json({ error: 'Forbidden: Cannot invite user to another tenant' }, 403);
          tenant_id = requesterTenantId as any;
        }
        const { data: invitedUser, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
          data: { full_name, tenant_id }
        });
        if (inviteError) return c.json({ error: 'Failed to invite user: ' + inviteError.message }, 500);
        result = { user: invitedUser.user, message: 'User invited successfully' };
        break;
      }
      case 'update': {
        if (!user_id) return c.json({ error: 'user_id required' }, 400);
        if (!isSuperAdmin) {
          const { data: target } = await supabaseAdmin.from('users').select('tenant_id').eq('id', user_id).single();
          if (target && target.tenant_id !== requesterTenantId) return c.json({ error: 'Forbidden' }, 403);
        }
        const updates: any = { updated_at: new Date().toISOString() };
        if (full_name) updates.full_name = full_name;
        if (role_id) updates.role_id = role_id;
        const { error: updateError } = await supabaseAdmin.from('users').update(updates).eq('id', user_id);
        if (updateError) throw updateError;
        result = { message: 'User updated successfully' };
        break;
      }
      case 'delete': {
        if (!user_id) return c.json({ error: 'user_id required' }, 400);
        const { data: targetUser } = await supabaseAdmin.from('users').select('role_id, tenant_id').eq('id', user_id).single();
        if (!isSuperAdmin && targetUser && targetUser.tenant_id !== requesterTenantId) return c.json({ error: 'Forbidden' }, 403);
        const { error: deleteError } = await supabaseAdmin.from('users').update({ deleted_at: new Date().toISOString() }).eq('id', user_id);
        if (deleteError) throw deleteError;
        result = { message: 'User deleted successfully' };
        break;
      }
      default:
        return c.json({ error: `Unknown action: ${action}` }, 400);
    }
    return c.json(result, 200);
  } catch (error: any) {
    return c.json({ error: error.message }, 400);
  }
});

// redirect /functions/v1/serve-sitemap to /public/sitemap
app.get('/functions/v1/serve-sitemap', (c) => {
  const url = new URL(c.req.url);
  url.pathname = '/public/sitemap';
  return c.redirect(url.toString(), 301);
});

export default app
