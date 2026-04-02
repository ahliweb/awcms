import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { generatePublicOpenApi } from '../src/docs/generators/public.ts'
import { generateAdminOpenApi } from '../src/docs/generators/admin.ts'
import { generateInternalOpenApi } from '../src/docs/generators/internal.ts'

const origin = process.env.AWCMS_EDGE_OPENAPI_SERVER_URL || 'https://edge.example.com'
const expected = {
  'public.json': `${JSON.stringify(generatePublicOpenApi(origin), null, 2)}\n`,
  'admin.json': `${JSON.stringify(generateAdminOpenApi(origin), null, 2)}\n`,
  'internal.json': `${JSON.stringify(generateInternalOpenApi(origin), null, 2)}\n`,
}

let hasDiff = false

for (const [fileName, contents] of Object.entries(expected)) {
  const filePath = resolve(process.cwd(), 'openapi', fileName)
  let current = ''
  try {
    current = await readFile(filePath, 'utf8')
  } catch {
    hasDiff = true
    console.log(`missing openapi artifact: ${fileName}`)
    continue
  }

  if (current !== contents) {
    hasDiff = true
    console.log(`changed openapi artifact: ${fileName}`)
  }
}

if (hasDiff) {
  process.exitCode = 1
} else {
  console.log('openapi artifacts are in sync')
}
