const encoder = new TextEncoder()

const toBase64Url = (input: ArrayBuffer | Uint8Array) => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const fromBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(normalized)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

const getSecret = (secret: string) => crypto.subtle.importKey(
  'raw',
  encoder.encode(secret),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign'],
)

const signPayload = async (payload: string, secret: string) => {
  const key = await getSecret(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return toBase64Url(signature)
}

export const issueTenantRouteToken = async (params: {
  tenantId: string
  secret: string
  ttlSeconds?: number
}) => {
  const payload = {
    tenantId: params.tenantId,
    exp: Math.floor(Date.now() / 1000) + Math.max(60, params.ttlSeconds || 900),
  }
  const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(payload)))
  const signature = await signPayload(encodedPayload, params.secret)
  return `${encodedPayload}.${signature}`
}

export const resolveTenantRouteToken = async (params: {
  token: string
  secret: string
}) => {
  const [encodedPayload, signature] = String(params.token || '').split('.')
  if (!encodedPayload || !signature) return null

  const expectedSignature = await signPayload(encodedPayload, params.secret)
  if (expectedSignature !== signature) return null

  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload))) as {
      tenantId?: string
      exp?: number
    }
    if (!payload?.tenantId || !payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }
    return payload
  } catch {
    return null
  }
}
