import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createClient } from '@supabase/supabase-js'

const execFileAsync = promisify(execFile)

const rootDir = path.resolve(process.cwd(), '..')
const localEnvPath = path.join(process.cwd(), '.dev.vars')
const remoteEnvPath = path.join(rootDir, 'awcms', '.env.remote')

const readEnvFile = async (filePath) => {
  const content = await fs.readFile(filePath, 'utf8')
  const values = {}
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const [key, ...rest] = trimmed.split('=')
    values[key] = rest.join('=')
  }
  return values
}

const localEnv = await readEnvFile(localEnvPath)
const remoteEnv = await readEnvFile(remoteEnvPath)

const remoteR2BucketName = remoteEnv.R2_BUCKET_NAME || 'awcms-s3'

const localSupabase = createClient(localEnv.VITE_SUPABASE_URL, localEnv.VITE_SUPABASE_PUBLISHABLE_KEY, {
  global: { headers: { 'x-application-name': 'awcms-r2-sync-local' } },
})

const remoteSupabase = createClient(remoteEnv.VITE_SUPABASE_URL, remoteEnv.SUPABASE_SECRET_KEY, {
  global: { headers: { 'x-application-name': 'awcms-r2-sync-remote' } },
})

const localEdgeUrl = 'http://127.0.0.1:8787'
const syncEmail = 'cms@ahliweb.com'
const syncPassword = 'Password123456@$#'

const login = async (baseUrl, publishableKey, email, password) => {
  const response = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })
  const json = await response.json()
  if (!response.ok || !json.access_token) {
    throw new Error(`Login failed for ${baseUrl}: ${json.msg || json.error || response.status}`)
  }
  return json.access_token
}

const uploadExactKeyToRemoteR2 = async (storageKey, mimeType, fileBuffer) => {
  const tempFile = path.join(os.tmpdir(), `awcms-r2-sync-${Date.now()}-${path.basename(storageKey)}`)
  await fs.writeFile(tempFile, fileBuffer)

  try {
    await execFileAsync(
      'npx',
      [
        'wrangler',
        'r2',
        'object',
        'put',
        `${remoteR2BucketName}/${storageKey}`,
        '--remote',
        '--file',
        tempFile,
        '--content-type',
        mimeType || 'application/octet-stream',
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: remoteEnv.CLOUDFLARE_API_TOKEN,
          CLOUDFLARE_ACCOUNT_ID: remoteEnv.CLOUDFLARE_ACCOUNT_ID,
        },
      },
    )
  } finally {
    await fs.rm(tempFile, { force: true })
  }
}

const localJwt = await login(localEnv.VITE_SUPABASE_URL, localEnv.VITE_SUPABASE_PUBLISHABLE_KEY, syncEmail, syncPassword)

const { data: localMedia, error: localError } = await localSupabase
  .from('media_objects')
  .select('*')
  .is('deleted_at', null)
  .order('tenant_id', { ascending: true })
  .order('created_at', { ascending: true })

if (localError) throw localError

const { data: remoteMedia, error: remoteError } = await remoteSupabase
  .from('media_objects')
  .select('tenant_id, storage_key')
  .is('deleted_at', null)

if (remoteError) throw remoteError

const remoteKeys = new Set((remoteMedia || []).map((row) => `${row.tenant_id}::${row.storage_key}`))
const missing = (localMedia || []).filter((row) => !remoteKeys.has(`${row.tenant_id}::${row.storage_key}`))

console.log(`Local media rows: ${(localMedia || []).length}`)
console.log(`Remote media rows: ${(remoteMedia || []).length}`)
console.log(`Missing remotely: ${missing.length}`)

for (const media of missing) {
  console.log(`Syncing ${media.file_name} for tenant ${media.tenant_id}`)

  const localFileResponse = await fetch(`${localEdgeUrl}/api/media/file/${media.id}`, {
    headers: {
      Authorization: `Bearer ${localJwt}`,
      'x-tenant-id': media.tenant_id,
    },
  })

  if (!localFileResponse.ok) {
    throw new Error(`Local file fetch failed for ${media.id}: ${localFileResponse.status}`)
  }

  const fileBuffer = Buffer.from(await localFileResponse.arrayBuffer())

  await uploadExactKeyToRemoteR2(media.storage_key, media.mime_type, fileBuffer)

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

  const { error: upsertError } = await remoteSupabase
    .from('media_objects')
    .upsert(row, { onConflict: 'storage_key' })

  if (upsertError) {
    throw upsertError
  }
}

console.log('Sync complete.')
