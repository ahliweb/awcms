import { createClient } from '@supabase/supabase-js'
import { HTTPException } from 'hono/http-exception'
import type { Bindings } from './runtime-types'

export const requireBearerToken = (request: Request, message = 'Unauthorized') => {
  const authHeader = request.headers.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) {
    throw new HTTPException(401, { message })
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    throw new HTTPException(401, { message })
  }

  return token
}

export const resolveBearerOrServiceActor = async (
  adminSupabase: any,
  request: Request,
  options?: {
    missingAuthMessage?: string
    invalidTokenMessage?: string
  },
) => {
  const token = requireBearerToken(request, options?.missingAuthMessage || 'Unauthorized')
  const hasServiceToken = token.startsWith('sb_secret_')

  if (hasServiceToken) {
    return {
      token,
      hasServiceToken,
      requestingUser: null,
    }
  }

  const { data: authData, error: authError } = await adminSupabase.auth.getUser(token)
  if (authError || !authData?.user) {
    throw new HTTPException(401, { message: options?.invalidTokenMessage || 'Unauthorized' })
  }

  return {
    token,
    hasServiceToken,
    requestingUser: authData.user,
  }
}

export const requireBearerSession = async (env: Bindings, request: Request) => {
  const token = requireBearerToken(request)
  const callerClient = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: authData, error: authError } = await callerClient.auth.getUser()
  if (authError || !authData?.user) {
    throw new HTTPException(401, { message: 'Unauthorized' })
  }

  return {
    token,
    callerClient,
    user: authData.user,
  }
}
