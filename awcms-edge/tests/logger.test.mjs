import test from 'node:test'
import assert from 'node:assert/strict'

import { createLogger, redact, loggerForRequest } from '../src/lib/logger.ts'

function capture(level = 'debug') {
  const lines = []
  const logger = createLogger({
    base: { service: 'awcms-edge' },
    level,
    sink: (lvl, line) => lines.push({ lvl, json: JSON.parse(line) }),
  })
  return { logger, lines }
}

test('logger: emit JSON terstruktur dengan ts/level/msg/base', () => {
  const { logger, lines } = capture()
  logger.info('hello', { foo: 'bar' })
  assert.equal(lines.length, 1)
  assert.equal(lines[0].json.level, 'info')
  assert.equal(lines[0].json.msg, 'hello')
  assert.equal(lines[0].json.service, 'awcms-edge')
  assert.equal(lines[0].json.foo, 'bar')
  assert.match(lines[0].json.ts, /^\d{4}-\d{2}-\d{2}T/)
})

test('logger: level filtering — debug di bawah info tidak diemit', () => {
  const { logger, lines } = capture('info')
  logger.debug('skipme')
  logger.info('keepme')
  assert.equal(lines.length, 1)
  assert.equal(lines[0].json.msg, 'keepme')
})

test('logger: error/warn memakai level yang benar', () => {
  const { logger, lines } = capture()
  logger.warn('w')
  logger.error('e')
  assert.equal(lines[0].lvl, 'warn')
  assert.equal(lines[1].lvl, 'error')
})

test('logger: redaction menyensor password/token/secret (nested)', () => {
  const { logger, lines } = capture()
  logger.info('login', { password: 'rahasia', data: { token: 'abc', ok: 'visible' } })
  assert.equal(lines[0].json.password, '[REDACTED]')
  assert.equal(lines[0].json.data.token, '[REDACTED]')
  assert.equal(lines[0].json.data.ok, 'visible')
})

test('logger: redaction menyensor authorization & NIK & service_role', () => {
  const { logger, lines } = capture()
  logger.info('ctx', { authorization: 'Bearer x', nik: '3201', service_role_key: 'srv' })
  assert.equal(lines[0].json.authorization, '[REDACTED]')
  assert.equal(lines[0].json.nik, '[REDACTED]')
  assert.equal(lines[0].json.service_role_key, '[REDACTED]')
})

test('logger: redact() pure — tidak memutasi input', () => {
  const input = { password: 'x', nested: { token: 'y' } }
  const out = redact(input)
  assert.equal(input.password, 'x', 'input asli tidak boleh berubah')
  assert.equal(out.password, '[REDACTED]')
  assert.equal(out.nested.token, '[REDACTED]')
})

test('logger: child menambahkan binding (requestId)', () => {
  const lines = []
  const logger = createLogger({ sink: (_l, line) => lines.push(JSON.parse(line)) })
  const child = logger.child({ requestId: 'req-1', tenant_id: 't1' })
  child.info('x')
  assert.equal(lines[0].requestId, 'req-1')
  assert.equal(lines[0].tenant_id, 't1')
})

test('logger: loggerForRequest memakai x-request-id header bila ada', () => {
  const lines = []
  const req = new Request('https://x/', { headers: { 'x-request-id': 'hdr-123' } })
  const logger = loggerForRequest(req, { sink: (_l, line) => lines.push(JSON.parse(line)) })
  logger.info('hit')
  assert.equal(lines[0].requestId, 'hdr-123')
})

test('logger: loggerForRequest generate requestId bila header kosong', () => {
  const lines = []
  const req = new Request('https://x/')
  const logger = loggerForRequest(req, { sink: (_l, line) => lines.push(JSON.parse(line)) })
  logger.info('hit')
  assert.ok(typeof lines[0].requestId === 'string' && lines[0].requestId.length >= 8)
})
