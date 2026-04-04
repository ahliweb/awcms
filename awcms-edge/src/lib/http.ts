import { HTTPException } from 'hono/http-exception'

type JsonBody = Record<string, unknown>

export const getJsonBody = async (request: Request): Promise<JsonBody | null> => {
  try {
    return await request.json<JsonBody>()
  } catch {
    return null
  }
}

export const requireJsonBody = async (request: Request, message = 'Invalid JSON body'): Promise<JsonBody> => {
  const body = await getJsonBody(request)
  if (!body) {
    throw new HTTPException(400, { message })
  }
  return body
}

export const requireString = (value: unknown, message: string) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HTTPException(400, { message })
  }
  return value.trim()
}

export const handleRouteError = (
  c: any,
  error: unknown,
  fallbackMessage = 'Internal server error',
  fallbackStatus = 500,
) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status)
  }

  console.error(`[awcms-edge] ${fallbackMessage}`, error)
  return c.json({ error: fallbackMessage }, fallbackStatus)
}
