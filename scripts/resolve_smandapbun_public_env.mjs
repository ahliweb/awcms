import { existsSync, readFileSync, appendFileSync } from 'node:fs'

const candidates = [
  'awcms-public/smandapbun/.env.production',
  'awcms-public/smandapbun/.env.remote',
  'awcms-public/smandapbun/.env.local',
  'awcms-public/smandapbun/.env',
  'awcms/.env.production',
  'awcms/.env.remote',
  'awcms/.env.local',
  'awcms/.env',
]

const parseEnv = (filePath) => {
  const parsed = {}

  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const separatorIndex = line.indexOf('=')
    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/gu, '')
    parsed[key] = value
  }

  return parsed
}

const outputs = {
  public_supabase_url: '',
  public_supabase_key: '',
  public_tenant_id: '',
  url_source: '',
  key_source: '',
  tenant_source: '',
}

for (const candidate of candidates) {
  if (!existsSync(candidate)) continue
  const parsed = parseEnv(candidate)

  if (!outputs.public_supabase_url) {
    const urlValue = parsed.PUBLIC_SUPABASE_URL?.trim() || parsed.VITE_SUPABASE_URL?.trim()
    if (urlValue) {
      outputs.public_supabase_url = urlValue
      outputs.url_source = candidate
    }
  }

  if (!outputs.public_supabase_key) {
    const keyValue = parsed.PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
      || parsed.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
      || parsed.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY?.trim()

    if (keyValue) {
      outputs.public_supabase_key = keyValue
      outputs.key_source = candidate
    }
  }

  if (!outputs.public_tenant_id) {
    const tenantValue = parsed.PUBLIC_TENANT_ID?.trim()
      || parsed.VITE_PUBLIC_TENANT_ID?.trim()
      || parsed.VITE_TENANT_ID?.trim()

    if (tenantValue) {
      outputs.public_tenant_id = tenantValue
      outputs.tenant_source = candidate
    }
  }
}

if (!outputs.public_supabase_url) {
  const urlValue = process.env.SECRET_PUBLIC_SUPABASE_URL?.trim()
  if (urlValue) {
    outputs.public_supabase_url = urlValue
    outputs.url_source = 'github_secret_or_var'
  }
}

if (!outputs.public_supabase_key) {
  const keyValue = process.env.SECRET_PUBLIC_SUPABASE_KEY?.trim()
  if (keyValue) {
    outputs.public_supabase_key = keyValue
    outputs.key_source = 'github_secret_or_var'
  }
}

if (!outputs.public_tenant_id) {
  const tenantValue = process.env.SECRET_PUBLIC_TENANT_ID?.trim()
  if (tenantValue) {
    outputs.public_tenant_id = tenantValue
    outputs.tenant_source = 'github_secret_or_var'
  }
}

const missing = []
if (!outputs.public_supabase_url) missing.push('PUBLIC_SUPABASE_URL/VITE_SUPABASE_URL')
if (!outputs.public_supabase_key) missing.push('PUBLIC_SUPABASE_PUBLISHABLE_KEY/VITE_SUPABASE_PUBLISHABLE_KEY')
if (!outputs.public_tenant_id) missing.push('PUBLIC_TENANT_ID/VITE_PUBLIC_TENANT_ID/VITE_TENANT_ID')

if (missing.length > 0) {
  throw new Error(
    'Missing required Smandapbun public build env: '
    + `${missing.join(', ')}. `
    + 'Set the matching GitHub Actions secret or repository variable '
    + '(recommended: SMANDAPBUN_SUPABASE_URL, SMANDAPBUN_SUPABASE_KEY, SMANDAPBUN_TENANT_ID).',
  )
}

const outputPath = process.env.GITHUB_OUTPUT
if (!outputPath) {
  throw new Error('GITHUB_OUTPUT is required')
}

appendFileSync(outputPath, `public_supabase_url=${outputs.public_supabase_url}\n`)
appendFileSync(outputPath, `public_supabase_key=${outputs.public_supabase_key}\n`)
appendFileSync(outputPath, `public_tenant_id=${outputs.public_tenant_id}\n`)
appendFileSync(outputPath, `url_source=${outputs.url_source}\n`)
appendFileSync(outputPath, `key_source=${outputs.key_source}\n`)
appendFileSync(outputPath, `tenant_source=${outputs.tenant_source}\n`)

for (const value of [outputs.public_supabase_url, outputs.public_supabase_key, outputs.public_tenant_id]) {
  process.stdout.write(`::add-mask::${value}\n`)
}
