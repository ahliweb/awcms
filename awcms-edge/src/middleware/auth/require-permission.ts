import { createClient } from '@supabase/supabase-js'
import { HTTPException } from 'hono/http-exception'
import type { MiddlewareHandler } from 'hono'

export const ensureAnyPermission = async (c: any, permissionNames: string[]) => {
  const token = c.get('token')
  if (!token) {
    throw new HTTPException(401, { message: 'Unauthorized' })
  }

  const callerClient = createClient(c.env.VITE_SUPABASE_URL, c.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  let sawRpcError = false
  for (const permissionName of permissionNames) {
    const { data, error } = await callerClient.rpc('has_permission', { permission_name: permissionName })
    if (!error && data) {
      return true
    }
    if (error) {
      sawRpcError = true
    }
  }

  if (sawRpcError) {
    throw new HTTPException(500, { message: 'Failed to verify permission grants' })
  }

  throw new HTTPException(403, { message: 'Forbidden' })
}

export const requirePermission = (permissionNames: string[]): MiddlewareHandler<any> => {
  return async (c, next) => {
    await ensureAnyPermission(c, permissionNames)
    await next()
  }
}
