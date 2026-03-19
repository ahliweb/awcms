/**
 * Media Finalization Queue Consumer
 *
 * Processes `media.upload.finalize` messages from the `awcms-media-events` queue.
 *
 * Contract:
 *  - Message is a reference only. Consumer re-reads authoritative state from
 *    Supabase before performing any write (SYSTEM_MODEL.md §2.4).
 *  - Idempotent: if the session is already `completed` the message is acked
 *    without re-processing.
 *  - On unrecoverable error the message is acked to avoid infinite DLQ loops
 *    for data-level failures; transient errors are thrown to trigger retry.
 *
 * Authority: docs/architecture/queue-topology.md → contracts.ts
 */

import { createClient } from '@supabase/supabase-js'
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { inferMediaKind, slugifyMediaValue } from '../mediaContracts'
import {
  isValidEnvelope,
  MEDIA_FINALIZE_EVENT,
  MEDIA_FINALIZE_SCHEMA,
  type AnyQueueMessage,
  type MediaFinalizeMessage,
} from './contracts'
import { logAck, logRetry, logPermanent } from './observability'

// ---------------------------------------------------------------------------
// Minimal env shape the consumer needs — mirrors the subset of Bindings
// ---------------------------------------------------------------------------

interface ConsumerEnv {
  VITE_SUPABASE_URL: string
  SUPABASE_SECRET_KEY: string
  R2_ACCOUNT_ID: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
  R2_BUCKET_NAME: string
}

// ---------------------------------------------------------------------------
// Internal helpers (mirrors index.ts utilities — kept local to avoid circular
// imports; do not import from index.ts)
// ---------------------------------------------------------------------------

const getAdminSupabase = (env: ConsumerEnv) =>
  createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY)

const getR2S3Client = (env: ConsumerEnv) =>
  new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  })

const headStoredObject = (env: ConsumerEnv, storageKey: string) => {
  const client = getR2S3Client(env)
  return client.send(
    new HeadObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: storageKey }),
  )
}

const buildMediaSlug = (fileName: string, sessionId: string) => {
  const base = slugifyMediaValue(fileName) || 'media-item'
  return `${base}-${sessionId.slice(0, 8)}`
}

// ---------------------------------------------------------------------------
// Single-message handler
// ---------------------------------------------------------------------------

/**
 * Process one `media.upload.finalize` message.
 *
 * Returns `"ack"` when the message should be considered done (success or
 * permanent failure that should not be retried). Returns `"retry"` when
 * a transient error occurred and the caller should throw to let the runtime
 * retry.
 */
export async function handleMediaFinalizeMessage(
  message: MediaFinalizeMessage,
  env: ConsumerEnv,
): Promise<'ack' | 'retry'> {
  const sessionId = message.resource_id
  const adminSupabase = getAdminSupabase(env)

  const base = {
    queue: 'awcms-media-events',
    event_type: message.event_type,
    job_id: message.job_id,
    tenant_id: message.tenant_id,
  }

  // 1. Re-read authoritative session state from Supabase.
  const { data: session, error: sessionError } = await adminSupabase
    .from('media_upload_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (sessionError) {
    // Transient DB error — let the runtime retry.
    logRetry(base, `DB error reading session ${sessionId}: ${sessionError.message}`)
    return 'retry'
  }

  if (!session) {
    // Session deleted before consumer ran — permanent, ack and move on.
    logPermanent(base, `Session ${sessionId} not found; acking.`)
    return 'ack'
  }

  // 2. Idempotency: already processed.
  if (session.status === 'completed') {
    logAck(base, { message: `Session ${sessionId} already completed; skipping.` })
    return 'ack'
  }

  // 3. Guard: session must still be in `pending` state.
  if (session.status !== 'pending') {
    logPermanent(base, `Session ${sessionId} status="${session.status}"; acking without action.`)
    return 'ack'
  }

  // 4. Guard: session must not be expired.
  if (new Date(session.expires_at) < new Date()) {
    logPermanent(base, `Session ${sessionId} expired; marking failed.`)
    await adminSupabase
      .from('media_upload_sessions')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', sessionId)
    return 'ack'
  }

  // 5. Verify the object exists in R2.
  let r2Head: Awaited<ReturnType<typeof headStoredObject>> | null
  try {
    r2Head = await headStoredObject(env, session.storage_key)
  } catch {
    r2Head = null
  }

  if (!r2Head) {
    // Object not in R2 yet — could be a race with the upload completing.
    // Treat as transient so the runtime retries (up to max_retries in wrangler.jsonc).
    logRetry(base, `R2 object not found for session ${sessionId}; retrying.`)
    return 'retry'
  }

  // 6. Upsert the media_objects record (idempotent via storage_key conflict).
  const { data: mediaObject, error: upsertError } = await adminSupabase
    .from('media_objects')
    .upsert(
      {
        tenant_id: session.tenant_id,
        title:
          slugifyMediaValue(session.file_name).replace(/-/g, ' ').trim() ||
          session.file_name,
        file_name: session.file_name,
        original_name: session.file_name,
        slug: buildMediaSlug(session.file_name, session.id),
        description: null,
        alt_text: session.file_name,
        mime_type: session.mime_type,
        media_kind: inferMediaKind(session.mime_type),
        size_bytes: r2Head.ContentLength ?? session.size_bytes ?? 0,
        storage_key: session.storage_key,
        category_id: session.category_id ?? null,
        uploader_id: session.uploader_id,
        status: 'uploaded',
        access_control: session.access_control ?? 'public',
        session_bound_access: Boolean(session.session_bound_access),
        meta_data: {
          ...(session.meta_data ?? {}),
          etag: r2Head.ETag,
          uploaded_via: 'cloudflare-r2',
          finalized_by: 'queue-consumer',
          job_id: message.job_id,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'storage_key' },
    )
    .select('id')
    .single()

  if (upsertError) {
    // Transient DB error — retry.
    logRetry(base, `Upsert failed for session ${sessionId}: ${upsertError.message}`)
    return 'retry'
  }

  // 7. Mark session as completed.
  const { error: updateError } = await adminSupabase
    .from('media_upload_sessions')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', sessionId)

  if (updateError) {
    // media_object was already upserted; next retry will hit the idempotency
    // guard at step 2, so retrying is safe.
    logRetry(base, `Failed to mark session ${sessionId} completed: ${updateError.message}`)
    return 'retry'
  }

  logAck(base, {
    message: `Finalized session ${sessionId} → media_object ${mediaObject?.id}`,
    extra: { session_id: sessionId, media_object_id: mediaObject?.id },
  })
  return 'ack'
}

// ---------------------------------------------------------------------------
// Batch handler — wired into `export default { queue }` in index.ts
// ---------------------------------------------------------------------------

/**
 * Entry point for the Cloudflare Queue consumer.
 * Called by the runtime with a batch of messages from `awcms-media-events`.
 */
export async function mediaQueueHandler(
  batch: MessageBatch<AnyQueueMessage>,
  env: ConsumerEnv,
): Promise<void> {
  for (const msg of batch.messages) {
    const body = msg.body

    // Reject malformed envelopes immediately.
    if (!isValidEnvelope(body)) {
      logPermanent(
        { queue: 'awcms-media-events', event_type: 'unknown', job_id: 'unknown', tenant_id: 'unknown' },
        'Malformed envelope; acking to avoid DLQ loop.',
        { extra: { raw: JSON.stringify(body) } },
      )
      msg.ack()
      continue
    }

    // Route by event type + schema version.
    if (
      body.event_type === MEDIA_FINALIZE_EVENT &&
      body.schema_version === MEDIA_FINALIZE_SCHEMA
    ) {
      const result = await handleMediaFinalizeMessage(body as MediaFinalizeMessage, env)
      if (result === 'ack') {
        msg.ack()
      } else {
        // Throw to let the Cloudflare runtime retry this individual message.
        msg.retry()
      }
      continue
    }

    // Unknown event type for this consumer — ack to avoid blocking the queue.
    logPermanent(
      { queue: 'awcms-media-events', event_type: body.event_type, job_id: body.job_id, tenant_id: body.tenant_id },
      `Unknown event_type="${body.event_type}" schema="${body.schema_version}"; acking.`,
    )
    msg.ack()
  }
}
