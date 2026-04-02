import type { Boundary } from './visibility'

export const SECURITY_SCHEMES = {
  supabaseBearerAuth: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'Supabase access token for authenticated operator requests.',
  },
  secretHeaderAuth: {
    type: 'apiKey',
    in: 'header',
    name: 'x-awcms-rebuild-secret',
    description: 'Shared secret header for server-to-server rebuild callbacks.',
  },
} as const

export const getSecuritySchemesForBoundary = (boundary: Boundary) => {
  if (boundary === 'internal') {
    return SECURITY_SCHEMES
  }

  return {
    supabaseBearerAuth: SECURITY_SCHEMES.supabaseBearerAuth,
  }
}
