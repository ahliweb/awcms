import { createPublicSpec } from '../../lib/openapi/spec-public'

export const generatePublicOpenApi = (origin?: string) => createPublicSpec(origin)
