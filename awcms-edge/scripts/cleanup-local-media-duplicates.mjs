import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

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

const localSupabase = createClient(localEnv.VITE_SUPABASE_URL, localEnv.VITE_SUPABASE_PUBLISHABLE_KEY, {
  global: { headers: { 'x-application-name': 'awcms-r2-cleanup-local' } },
})
const remoteSupabase = createClient(remoteEnv.VITE_SUPABASE_URL, remoteEnv.SUPABASE_SECRET_KEY, {
  global: { headers: { 'x-application-name': 'awcms-r2-cleanup-remote' } },
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

const localJwt = await login(localEnv.VITE_SUPABASE_URL, localEnv.VITE_SUPABASE_PUBLISHABLE_KEY, syncEmail, syncPassword)

const { data: localMedia, error: localError } = await localSupabase
  .from('media_objects')
  .select('id, tenant_id, file_name, storage_key')
  .is('deleted_at', null)

if (localError) throw localError

const { data: remoteMedia, error: remoteError } = await remoteSupabase
  .from('media_objects')
  .select('tenant_id, file_name, storage_key')
  .is('deleted_at', null)

if (remoteError) throw remoteError

const remoteByFile = new Set((remoteMedia || []).map((row) => `${row.tenant_id}::${row.file_name}`))
const localByFile = new Map()

for (const row of (localMedia || [])) {
  const fileKey = `${row.tenant_id}::${row.file_name}`
  if (!localByFile.has(fileKey)) localByFile.set(fileKey, [])
  localByFile.get(fileKey).push(row)
}

const duplicates = (localMedia || []).filter((row) => {
  const fileKey = `${row.tenant_id}::${row.file_name}`
  const localMatches = localByFile.get(fileKey) || []
  if (!remoteByFile.has(fileKey) || localMatches.length <= 1) return false
  const canonicalKey = [...localMatches].map((item) => item.storage_key).sort()[0]
  return row.storage_key !== canonicalKey
})

console.log(`Local rows: ${(localMedia || []).length}`)
console.log(`Remote rows: ${(remoteMedia || []).length}`)
console.log(`Duplicate local rows to clean: ${duplicates.length}`)

if (duplicates.length === 0) {
  console.log('No duplicate local rows to clean.')
  process.exit(0)
}

const response = await fetch(`${localEdgeUrl}/api/media/cleanup-local-duplicates`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${localJwt}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    duplicates: duplicates.map((row) => ({
      id: row.id,
      storageKey: row.storage_key,
    })),
  }),
})

const json = await response.json()
if (!response.ok) {
  throw new Error(`Cleanup failed: ${response.status} ${JSON.stringify(json)}`)
}

console.log(`Removed duplicates: ${json.removed?.length || 0}`)
