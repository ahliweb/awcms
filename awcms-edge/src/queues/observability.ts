/**
 * Structured Queue Observability Logger
 *
 * Emits newline-delimited JSON log lines compatible with Cloudflare Workers Logs
 * and Logpush. Each line is a self-contained event record with consistent fields
 * for filtering, alerting, and replay audit.
 *
 * Usage:
 *   import { queueLog } from './observability'
 *   queueLog({ queue: 'awcms-media-events', job_id, event_type, tenant_id, outcome: 'ack', durationMs })
 *
 * Authority: docs/architecture/queue-topology.md → Phase 5 Observability
 */

// ---------------------------------------------------------------------------
// Log record shape
// ---------------------------------------------------------------------------

export type QueueOutcome =
  | 'ack'       // Message processed successfully — no further action
  | 'retry'     // Transient failure — runtime will retry
  | 'permanent' // Permanent failure — acked to stop DLQ loop
  | 'dlq'       // Received on DLQ — logged to queue_dead_letters
  | 'replay'    // Message re-enqueued from dead-letter store by admin

export interface QueueLogRecord {
  /** ISO 8601 timestamp emitted at log time */
  ts: string
  /** Log level — mirrors console semantics */
  level: 'info' | 'warn' | 'error'
  /** The Cloudflare Queue name this message was consumed from */
  queue: string
  /** event_type from the message envelope */
  event_type: string
  /** job_id from the message envelope */
  job_id: string
  /** tenant_id from the message envelope */
  tenant_id: string
  /** What the consumer decided to do with the message */
  outcome: QueueOutcome
  /** Elapsed processing time in milliseconds */
  durationMs?: number
  /** Human-readable context — transient errors, skip reasons */
  message?: string
  /** Additional structured context — arbitrary key/value */
  extra?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Primary logger
// ---------------------------------------------------------------------------

/**
 * Emit a structured JSON log record to stdout (captured by Workers Logs / Logpush).
 * Always use this instead of bare console.log in queue consumers.
 */
export function queueLog(record: Omit<QueueLogRecord, 'ts'>): void {
  const line: QueueLogRecord = {
    ts: new Date().toISOString(),
    ...record,
  }
  // JSON on a single line — Logpush / Workers Logs parses newline-delimited JSON
  console.log(JSON.stringify(line))
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

type BaseFields = Pick<QueueLogRecord, 'queue' | 'event_type' | 'job_id' | 'tenant_id'>

export function logAck(base: BaseFields, opts?: { durationMs?: number; message?: string; extra?: Record<string, unknown> }): void {
  queueLog({ level: 'info', outcome: 'ack', ...base, ...opts })
}

export function logRetry(base: BaseFields, error: string, opts?: { durationMs?: number; extra?: Record<string, unknown> }): void {
  queueLog({ level: 'warn', outcome: 'retry', message: error, ...base, ...opts })
}

export function logPermanent(base: BaseFields, error: string, opts?: { durationMs?: number; extra?: Record<string, unknown> }): void {
  queueLog({ level: 'error', outcome: 'permanent', message: error, ...base, ...opts })
}

export function logDlq(base: BaseFields, failureReason: string, opts?: { extra?: Record<string, unknown> }): void {
  queueLog({ level: 'error', outcome: 'dlq', message: failureReason, ...base, ...opts })
}

export function logReplay(base: BaseFields, opts?: { extra?: Record<string, unknown> }): void {
  queueLog({ level: 'info', outcome: 'replay', ...base, ...opts })
}
