import { createClient } from '@supabase/supabase-js'
import { HTTPException } from 'hono/http-exception'
import type { MiddlewareHandler } from 'hono'

export const authenticateSession = async (c: any) => {
  const authHeader = c.req.header('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) {
    throw new HTTPException(401, { message: 'Missing or invalid authorization header' })
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    throw new HTTPException(401, { message: 'Missing bearer token' })
  }

  const supabase = createClient(c.env.VITE_SUPABASE_URL, c.env.VITE_SUPABASE_PUBLISHABLE_KEY)
  const { data: { user }, error } = await supabase.auth.getUser(token)

  if (error || !user) {
    throw new HTTPException(401, { message: 'Unauthorized' })
  }

  c.set('user', user)
  c.set('token', token)
  c.set('supabase', supabase)

  return { user, token, supabase }
}

export const requireSession = (): MiddlewareHandler<any> => {
  return async (c, next) => {
    await authenticateSession(c)
    await next()
  }
}
