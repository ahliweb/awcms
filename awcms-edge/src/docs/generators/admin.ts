import { createAdminSpec } from '../../lib/openapi/spec-admin'

export const generateAdminOpenApi = (origin?: string) => createAdminSpec(origin)
