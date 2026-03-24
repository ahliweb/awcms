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
const localSupabase = createClient(localEnv.VITE_SUPABASE_URL, localEnv.SUPABASE_PUBLISHABLE_KEY ?? localEnv.VITE_SUPABASE_PUBLISHABLE_KEY, {
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

const downloadExactKeyFromRemoteR2 = async (storageKey) => {
  const tempFile = path.join(os.tmpdir(), `awcms-r2-sync-${Date.now()}-${path.basename(storageKey)}`)
  try {
    await execFileAsync(
      'npx',
      [
        'wrangler',
        'r2',
        'object',
        'get',
        `${remoteR2BucketName}/${storageKey}`,
        '--remote',
        '--file',
        tempFile,
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

    return await fs.readFile(tempFile)
  } finally {
    await fs.rm(tempFile, { force: true })
  }
}

const localJwt = await login(localEnv.VITE_SUPABASE_URL, localEnv.VITE_SUPABASE_PUBLISHABLE_KEY, syncEmail, syncPassword)

const { data: localMedia, error: localError } = await localSupabase
  .from('media_objects')
  .select('tenant_id, storage_key')
  .is('deleted_at', null)

if (localError) throw localError

const { data: remoteMedia, error: remoteError } = await remoteSupabase
  .from('media_objects')
  .select('*')
  .is('deleted_at', null)
  .order('tenant_id', { ascending: true })
  .order('created_at', { ascending: true })

if (remoteError) throw remoteError

const localKeys = new Set((localMedia || []).map((row) => `${row.tenant_id}::${row.storage_key}`))
const missing = (remoteMedia || []).filter((row) => !localKeys.has(`${row.tenant_id}::${row.storage_key}`))

console.log(`Remote media rows: ${(remoteMedia || []).length}`)
console.log(`Local media rows: ${(localMedia || []).length}`)
console.log(`Missing locally: ${missing.length}`)

for (const media of missing) {
  console.log(`Syncing ${media.file_name} for tenant ${media.tenant_id}`)

  const fileBuffer = await downloadExactKeyFromRemoteR2(media.storage_key)

  const importResponse = await fetch(`${localEdgeUrl}/api/media/import-local`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${localJwt}`,
      'Content-Type': 'application/json',
      'x-tenant-id': media.tenant_id,
    },
    body: JSON.stringify({
      tenantId: media.tenant_id,
      media,
      fileBase64: fileBuffer.toString('base64'),
    }),
  })

  if (!importResponse.ok) {
    const importJson = await importResponse.text()
    throw new Error(`Local import failed: ${importResponse.status} ${importJson}`)
  }
}

console.log('Remote -> local sync complete.')
