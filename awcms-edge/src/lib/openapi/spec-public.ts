import { buildBoundarySpec } from './base-doc'

export const createPublicSpec = (origin?: string) => buildBoundarySpec('public', origin)
