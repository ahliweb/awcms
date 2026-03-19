/**
 * Dead-Letter Queue Consumer
 *
 * Handles batches arriving on:
 *   - awcms-media-events-dlq
 *   - awcms-notifications-dlq
 *
 * These queues receive messages only after the primary consumer exhausted all
 * retries (max_retries in wrangler.jsonc). The DLQ is a terminal path — we
 * log the failed message to the `queue_dead_letters` Supabase table for admin
 * inspection and optional replay, then ack every message to clear the DLQ.
 *
 * Replay is handled by POST /api/admin/queue/replay in index.ts.
 *
 * Authority: docs/architecture/queue-topology.md → Phase 5 Observability
 */

import { createClient } from '@supabase/supabase-js'
import { isValidEnvelope, type AnyQueueMessage } from './contracts'
import { logDlq, queueLog } from './observability'

// ---------------------------------------------------------------------------
// Env subset the DLQ consumer needs
// ---------------------------------------------------------------------------

interface DlqConsumerEnv {
  VITE_SUPABASE_URL: string
  SUPABASE_SECRET_KEY: string
}

// ---------------------------------------------------------------------------
// Row shape for queue_dead_letters insert
// ---------------------------------------------------------------------------

interface DeadLetterRow {
  queue_name: string
  job_id: string
  event_type: string
  tenant_id: string | null
  resource_type: string | null
  resource_id: string | null
  trace_id: string | null
  payload: unknown
  failure_reason: string | null
  failed_at: string
}

// ---------------------------------------------------------------------------
// Single-message DLQ handler
// ---------------------------------------------------------------------------

/**
 * Persist one dead-lettered message to `queue_dead_letters`.
 * Always resolves — any insert error is logged but does not re-throw,
 * because the message must always be acked on the DLQ (no retry path).
 */
async function persistDeadLetter(
  queueName: string,
  rawBody: unknown,
  env: DlqConsumerEnv,
): Promise<void> {
  const adminSupabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY)

  // Build the row whether or not the envelope is valid.
  const envelope = isValidEnvelope(rawBody) ? rawBody : null

  const row: DeadLetterRow = {
    queue_name: queueName,
    job_id: envelope?.job_id ?? `unknown-${crypto.randomUUID()}`,
    event_type: envelope?.event_type ?? 'unknown',
    tenant_id: envelope?.tenant_id ?? null,
    resource_type: envelope?.resource_type ?? null,
    resource_id: envelope?.resource_id ?? null,
    trace_id: envelope?.trace_id ?? null,
    payload: rawBody,
    failure_reason: envelope
      ? `Exhausted retries on ${queueName}`
      : `Malformed envelope — exhausted retries on ${queueName}`,
    failed_at: new Date().toISOString(),
  }

  logDlq(
    {
      queue: queueName,
      event_type: row.event_type,
      job_id: row.job_id,
      tenant_id: row.tenant_id ?? 'unknown',
    },
    row.failure_reason ?? 'exhausted retries',
    { extra: { resource_type: row.resource_type, resource_id: row.resource_id } },
  )

  const { error } = await adminSupabase.from('queue_dead_letters').insert(row)

  if (error) {
    // Cannot do anything useful here beyond logging — the message still gets acked.
    queueLog({
      level: 'error',
      queue: queueName,
      event_type: row.event_type,
      job_id: row.job_id,
      tenant_id: row.tenant_id ?? 'unknown',
      outcome: 'dlq',
      message: `Failed to persist dead-letter row: ${error.message}`,
      extra: { supabase_code: error.code },
    })
  }
}

// ---------------------------------------------------------------------------
// Batch entry point — one function handles both DLQ queues
// ---------------------------------------------------------------------------

/**
 * Process a DLQ batch. The `queueName` must be passed in from the dispatcher
 * in index.ts so the row records which queue it came from.
 */
export async function dlqQueueHandler(
  batch: MessageBatch<AnyQueueMessage>,
  env: DlqConsumerEnv,
  queueName: string,
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      await persistDeadLetter(queueName, msg.body, env)
    } catch (err: unknown) {
      // Absolute last-resort: log to console and ack anyway.
      console.error(
        `[dlqConsumer][${queueName}] Unexpected error persisting dead-letter:`,
        err instanceof Error ? err.message : String(err),
      )
    } finally {
      // DLQ messages are always acked — there is no retry path from a DLQ.
      msg.ack()
    }
  }
}
