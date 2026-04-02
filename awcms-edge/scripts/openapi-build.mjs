import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { generatePublicOpenApi } from '../src/docs/generators/public.ts'
import { generateAdminOpenApi } from '../src/docs/generators/admin.ts'
import { generateInternalOpenApi } from '../src/docs/generators/internal.ts'

const outputDir = resolve(process.cwd(), 'openapi')
const origin = process.env.AWCMS_EDGE_OPENAPI_SERVER_URL || 'https://edge.example.com'

const specs = {
  'public.json': generatePublicOpenApi(origin),
  'admin.json': generateAdminOpenApi(origin),
  'internal.json': generateInternalOpenApi(origin),
}

await mkdir(outputDir, { recursive: true })

for (const [fileName, spec] of Object.entries(specs)) {
  await writeFile(resolve(outputDir, fileName), `${JSON.stringify(spec, null, 2)}\n`, 'utf8')
  console.log(`wrote openapi/${fileName}`)
}
