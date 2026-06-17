/**
 * Structured HTTP/general logger untuk awcms-edge (Cloudflare Workers).
 *
 * Pino tidak berjalan di runtime Workers (workerd), jadi ini adapter native yang
 * menghasilkan **NDJSON** selaras format `queues/observability.ts` (kompatibel
 * Cloudflare Workers Logs / Logpush) dan selaras logging Pino di awcms-mini
 * (ADR-021): JSON terstruktur, child logger ber-`requestId`, redaction field
 * sensitif.
 *
 * Pakai ini sebagai pengganti `console.error`/`console.log` ad-hoc di jalur HTTP.
 *
 * Authority: personal-coding `awcms-shared-standards.md` §8.1/§8.3, ADR-021.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const CENSOR = '[REDACTED]'

/**
 * Nama key yang WAJIB di-redact (case-insensitive). Selaras klasifikasi data:
 * jangan log restricted/highly_restricted mentah.
 */
const REDACT_KEYS = new Set(
  [
    'password',
    'passwordhash',
    'password_hash',
    'token',
    'accesstoken',
    'access_token',
    'refreshtoken',
    'refresh_token',
    'secret',
    'apikey',
    'api_key',
    'authorization',
    'cookie',
    'set-cookie',
    'nik',
    'nikenc',
    'nik_enc',
    'service_role',
    'service_role_key',
  ].map((k) => k.toLowerCase()),
)

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Kembalikan salinan dengan field sensitif tersensor (deep). Tidak memutasi input.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return value
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT_KEYS.has(k.toLowerCase()) ? CENSOR : redact(v, depth + 1)
    }
    return out
  }
  return value
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
  /** Logger turunan dengan binding tetap (mis. requestId, tenant_id). */
  child(bindings: Record<string, unknown>): Logger
}

export interface CreateLoggerOptions {
  /** Field dasar yang disertakan di setiap baris (mis. service). */
  base?: Record<string, unknown>
  /** Level minimum (default env LOG_LEVEL atau "info"). */
  level?: LogLevel
  /** Sink kustom (untuk test). Default: console sesuai level. */
  sink?: (level: LogLevel, line: string) => void
}

function defaultSink(level: LogLevel, line: string): void {
  // NDJSON satu baris — diparse oleh Workers Logs / Logpush.
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

/**
 * Buat structured logger. Output: satu baris JSON per log dengan
 * `{ ts, level, msg, ...base, ...fields }`, field sensitif ter-redact.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const base = options.base ?? {}
  const minLevel = LEVEL_ORDER[options.level ?? 'info']
  const sink = options.sink ?? defaultSink

  function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < minLevel) return
    const record = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...base,
      ...(fields ?? {}),
    }
    sink(level, JSON.stringify(redact(record)))
  }

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child(bindings) {
      return createLogger({ base: { ...base, ...bindings }, level: options.level, sink })
    },
  }
}

/**
 * Buat child logger terikat pada satu request (ber-`requestId`).
 * Pasang dari header `x-request-id` atau `crypto.randomUUID()`.
 */
export function loggerForRequest(
  request: Request,
  options: CreateLoggerOptions = {},
): Logger {
  const headerId = request.headers.get('x-request-id')?.trim()
  const requestId = headerId && headerId.length > 0 ? headerId : crypto.randomUUID()
  return createLogger(options).child({ requestId })
}
