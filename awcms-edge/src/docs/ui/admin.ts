import { renderSwaggerUi } from './public'

export const renderAdminDocsUi = (c: any) => {
  return renderSwaggerUi(c, {
    title: 'AWCMS Edge Admin API Docs',
    specUrl: '/openapi/admin.json',
    authorizationHeader: c.req.header('Authorization') || '',
  })
}
