import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createClient } from '@supabase/supabase-js'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
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
  MAILKETING_API_TOKEN: string
  MAILKETING_DEFAULT_LIST_ID?: string
}

type Variables = {
  user: any
  token: string
  supabase: any
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

app.use('*', cors())

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

const ensureR2SigningConfig = (env: Bindings) => {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET_NAME) {
    throw new Error('Missing R2 signing configuration')
  }
}

const sanitizeFolder = (folder?: string) => String(folder || '')
  .trim()
  .replace(/(^\/|\/$)/g, '')
  .replace(/[^a-zA-Z0-9/_-]/g, '')

const buildStorageKey = (tenantId: string, fileName: string, folder?: string) => {
  const baseKey = generateStorageKey(tenantId, fileName)
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

    const storageKey = buildStorageKey(tenantId, body.fileName, body.folder)
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
        access_control: body.accessControl || 'public',
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

    const object = await c.env.STORAGE.head(session.storage_key)
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
        size_bytes: object.size || session.size_bytes || 0,
        storage_key: session.storage_key,
        category_id: session.category_id || null,
        uploader_id: user.id,
        status: 'uploaded',
        access_control: session.access_control || 'public',
        meta_data: {
          ...(session.meta_data || {}),
          etag: object.httpEtag,
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

// Get presigned URL for GET (Or proxy)
app.get('/api/media/file/:id', async (c) => {
  const mediaId = c.req.param('id');
  const token = c.get('token');

  const supabase = getAuthedSupabase(c.env, token)

  const { data: media, error } = await supabase
    .from('media_objects')
    .select('*')
    .eq('id', mediaId)
    .single();

  if (error || !media) {
    return c.json({ error: 'File not found or access denied' }, 404);
  }

  const object = await c.env.STORAGE.get(media.storage_key);
  if (!object) {
    return c.json({ error: 'File not found in storage' }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  
  return new Response(object.body, { headers });
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
    .select('storage_key')
    .eq('storage_key', storageKey)
    .eq('status', 'uploaded')
    .eq('access_control', 'public')
    .is('deleted_at', null)
    .single();

  if (error || !media) {
    return c.json({ error: 'File not found or not public' }, 404);
  }

  const object = await c.env.STORAGE.get(storageKey);
  if (!object) {
    return c.json({ error: 'File not found in storage' }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000');
  
  return new Response(object.body, { headers });
});

// ---- MIGRATED ENDPOINTS ----

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

app.post('/api/mailketing', async (c) => {
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
});

export default app
