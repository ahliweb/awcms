import type { MiddlewareHandler } from 'hono'
import { authenticateSession } from '../auth/require-session'
import { ensurePlatformScope } from '../auth/require-platform-scope'
import { ensureAnyPermission } from '../auth/require-permission'

const DOCS_READ_PERMISSIONS = ['platform.docs.read']

export const requireDocsAccess = (): MiddlewareHandler<any> => {
  return async (c, next) => {
    await authenticateSession(c)
    await ensurePlatformScope(c)
    await ensureAnyPermission(c, DOCS_READ_PERMISSIONS)
    await next()
  }
}
