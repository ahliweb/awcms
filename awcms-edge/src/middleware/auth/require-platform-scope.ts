import { createClient } from '@supabase/supabase-js'
import { HTTPException } from 'hono/http-exception'
import type { MiddlewareHandler } from 'hono'

export const ensurePlatformScope = async (c: any) => {
  const user = c.get('user')
  if (!user?.id) {
    throw new HTTPException(401, { message: 'Unauthorized' })
  }

  const adminSupabase = createClient(c.env.VITE_SUPABASE_URL, c.env.SUPABASE_SECRET_KEY)
  const { data, error } = await adminSupabase
    .from('users')
    .select('id, role:roles!users_role_id_fkey(is_platform_admin, is_full_access)')
    .eq('id', user.id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error || !data) {
    throw new HTTPException(403, { message: 'Unable to resolve platform scope' })
  }

  const role = Array.isArray(data.role) ? data.role[0] : data.role
  if (!role?.is_platform_admin && !role?.is_full_access) {
    throw new HTTPException(403, { message: 'Platform scope required' })
  }

  return true
}

export const requirePlatformScope = (): MiddlewareHandler<any> => {
  return async (c, next) => {
    await ensurePlatformScope(c)
    await next()
  }
}
