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

const localSupabase = createClient(localEnv.VITE_SUPABASE_URL, localEnv.VITE_SUPABASE_PUBLISHABLE_KEY, {
  global: { headers: { 'x-application-name': 'awcms-r2-cleanup-local-ref' } },
})
const remoteSupabase = createClient(remoteEnv.VITE_SUPABASE_URL, remoteEnv.SUPABASE_SECRET_KEY, {
  global: { headers: { 'x-application-name': 'awcms-r2-cleanup-remote' } },
})

const remoteR2BucketName = remoteEnv.R2_BUCKET_NAME || 'awcms-s3'

const deleteRemoteObject = async (storageKey) => {
  await execFileAsync(
    'npx',
    [
      'wrangler',
      'r2',
      'object',
      'delete',
      `${remoteR2BucketName}/${storageKey}`,
      '--remote',
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
}

const { data: localMedia, error: localError } = await localSupabase
  .from('media_objects')
  .select('tenant_id, file_name, storage_key')
  .is('deleted_at', null)

if (localError) throw localError

const { data: remoteMedia, error: remoteError } = await remoteSupabase
  .from('media_objects')
  .select('id, tenant_id, file_name, storage_key')
  .is('deleted_at', null)

if (remoteError) throw remoteError

const localByFile = new Set((localMedia || []).map((row) => `${row.tenant_id}::${row.file_name}`))
const remoteByFile = new Map()

for (const row of (remoteMedia || [])) {
  const fileKey = `${row.tenant_id}::${row.file_name}`
  if (!remoteByFile.has(fileKey)) remoteByFile.set(fileKey, [])
  remoteByFile.get(fileKey).push(row)
}

const duplicates = (remoteMedia || []).filter((row) => {
  const fileKey = `${row.tenant_id}::${row.file_name}`
  const remoteMatches = remoteByFile.get(fileKey) || []
  if (!localByFile.has(fileKey) || remoteMatches.length <= 1) return false
  const canonicalKey = [...remoteMatches].map((item) => item.storage_key).sort()[0]
  return row.storage_key !== canonicalKey
})

console.log(`Remote rows: ${(remoteMedia || []).length}`)
console.log(`Local rows: ${(localMedia || []).length}`)
console.log(`Duplicate remote rows to clean: ${duplicates.length}`)

for (const duplicate of duplicates) {
  console.log(`Cleaning remote duplicate ${duplicate.file_name} (${duplicate.storage_key})`)

  await deleteRemoteObject(duplicate.storage_key)

  const { error } = await remoteSupabase
    .from('media_objects')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', duplicate.id)
    .is('deleted_at', null)

  if (error) throw error
}

console.log('Remote duplicate cleanup complete.')
