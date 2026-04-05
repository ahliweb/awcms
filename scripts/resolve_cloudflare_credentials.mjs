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
  api_token: '',
  account_id: '',
  token_source: '',
  account_source: '',
}

for (const candidate of candidates) {
  if (!existsSync(candidate)) continue
  const parsed = parseEnv(candidate)

  if (!outputs.api_token) {
    const tokenValue = parsed.CLOUDFLARE_API_TOKEN?.trim()
    if (tokenValue) {
      outputs.api_token = tokenValue
      outputs.token_source = candidate
    }
  }

  if (!outputs.account_id) {
    const accountIdValue = parsed.CLOUDFLARE_ACCOUNT_ID?.trim() || parsed.R2_ACCOUNT_ID?.trim()
    if (accountIdValue) {
      outputs.account_id = accountIdValue
      outputs.account_source = candidate
    }
  }

  if (!outputs.account_id) {
    const endpoint = parsed.R2_S3_API_ENDPOINT?.trim() || ''
    const match = endpoint.match(/^https:\/\/([a-f0-9]{32})\./u)
    if (match) {
      outputs.account_id = match[1]
      outputs.account_source = `${candidate} (derived from R2_S3_API_ENDPOINT)`
    }
  }
}

if (!outputs.api_token) {
  const tokenValue = process.env.SECRET_CF_API_TOKEN?.trim()
  if (tokenValue) {
    outputs.api_token = tokenValue
    outputs.token_source = 'github_secret'
  }
}

if (!outputs.account_id) {
  const accountIdValue = process.env.SECRET_CF_ACCOUNT_ID?.trim()
  if (accountIdValue) {
    outputs.account_id = accountIdValue
    outputs.account_source = 'github_actions_secret_or_var'
  }
}

const outputPath = process.env.GITHUB_OUTPUT
if (!outputPath) {
  throw new Error('GITHUB_OUTPUT is required')
}

appendFileSync(outputPath, `api_token=${outputs.api_token}\n`)
appendFileSync(outputPath, `account_id=${outputs.account_id}\n`)
appendFileSync(outputPath, `token_source=${outputs.token_source}\n`)
appendFileSync(outputPath, `account_source=${outputs.account_source}\n`)

if (outputs.api_token) {
  process.stdout.write(`::add-mask::${outputs.api_token}\n`)
}

if (outputs.account_id) {
  process.stdout.write(`Resolved Cloudflare account id: ${outputs.account_id}\n`)
} else {
  process.stdout.write('Cloudflare account id not resolved from env files, secrets, or repository variables; preflight will derive it when the token only has one accessible account.\n')
}
