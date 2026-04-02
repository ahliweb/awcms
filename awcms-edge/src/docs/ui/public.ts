const buildSwaggerHtml = (params: {
  title: string
  specUrl: string
  authorizationHeader?: string | null
}) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${params.title}</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #0b1120; }
      #swagger-ui { min-height: 100vh; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      const authHeader = ${JSON.stringify(params.authorizationHeader || '')};
      window.ui = SwaggerUIBundle({
        url: ${JSON.stringify(params.specUrl)},
        dom_id: '#swagger-ui',
        deepLinking: true,
        displayRequestDuration: true,
        docExpansion: 'list',
        filter: true,
        persistAuthorization: false,
        supportedSubmitMethods: [],
        requestInterceptor: (request) => {
          if (authHeader && request.url.endsWith('/openapi/admin.json')) {
            request.headers = request.headers || {};
            request.headers.Authorization = authHeader;
          }
          return request;
        },
      });
    </script>
  </body>
</html>`

const DOCS_CSP = [
  "default-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "img-src 'self' data: https:",
  "font-src 'self' https://cdn.jsdelivr.net data:",
  "connect-src 'self'",
].join('; ')

export const renderSwaggerUi = (c: any, params: {
  title: string
  specUrl: string
  authorizationHeader?: string | null
}) => {
  c.header('Content-Security-Policy', DOCS_CSP)
  c.header('Referrer-Policy', 'no-referrer')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Cache-Control', 'private, no-store')
  return c.html(buildSwaggerHtml(params))
}

export const renderPublicDocsUi = (c: any) => {
  return renderSwaggerUi(c, {
    title: 'AWCMS Edge Public API Docs',
    specUrl: '/openapi/public.json',
  })
}
