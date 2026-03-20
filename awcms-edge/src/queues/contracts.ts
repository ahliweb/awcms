/**
 * Queue Message Contracts
 *
 * All Cloudflare Queue messages in awcms-edge use this typed envelope.
 * Consumers MUST treat message fields as references only — re-read
 * authoritative state from Supabase before performing any write.
 *
 * Authority: SYSTEM_MODEL.md §2.4 → docs/architecture/queue-topology.md
 */

// ---------------------------------------------------------------------------
// Base envelope — every message must satisfy this shape
// ---------------------------------------------------------------------------

export interface QueueMessageEnvelope {
  /** Schema version for safe forward/backward compatibility. Consumers must reject unknown versions. */
  schema_version: string;
  /** Namespaced event name, e.g. "media.upload.finalize" */
  event_type: string;
  /** UUID v4 generated at enqueue time */
  job_id: string;
  /** Deterministic key to prevent double-processing on delivery retry */
  idempotency_key: string;
  /** UUID of the owning tenant — used for logging and consumer scoping */
  tenant_id: string;
  /** Canonical resource type, e.g. "media_upload_session" */
  resource_type: string;
  /** UUID of the specific resource the consumer must look up in Supabase */
  resource_id: string;
  /** ISO 8601 timestamp of the originating event */
  occurred_at: string;
  /** Passed through from the originating HTTP request for distributed tracing */
  trace_id: string;
  /** Non-authoritative context hints — never trusted as a data grant */
  meta: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Event: media.upload.finalize
// Enqueued by: POST /api/media/upload/:sessionId/finalize
// Consumed by: mediaConsumer.ts
// ---------------------------------------------------------------------------

export const MEDIA_FINALIZE_EVENT = "media.upload.finalize" as const;
export const MEDIA_FINALIZE_SCHEMA = "1.0" as const;

export interface MediaFinalizeMessage extends QueueMessageEnvelope {
  schema_version: typeof MEDIA_FINALIZE_SCHEMA;
  event_type: typeof MEDIA_FINALIZE_EVENT;
  resource_type: "media_upload_session";
  meta: {
    /** Original filename hint — informational only; consumer reads from session record */
    original_filename: string;
    /** Tenant slug hint for log labelling only */
    tenant_slug?: string;
  };
}

/**
 * Build a typed MediaFinalizeMessage.
 * Caller supplies the session_id (resource_id) and trace context.
 */
export function buildMediaFinalizeMessage(opts: {
  session_id: string;
  tenant_id: string;
  original_filename: string;
  tenant_slug?: string;
  trace_id: string;
}): MediaFinalizeMessage {
  return {
    schema_version: MEDIA_FINALIZE_SCHEMA,
    event_type: MEDIA_FINALIZE_EVENT,
    job_id: crypto.randomUUID(),
    idempotency_key: `media-finalize:${opts.session_id}`,
    tenant_id: opts.tenant_id,
    resource_type: "media_upload_session",
    resource_id: opts.session_id,
    occurred_at: new Date().toISOString(),
    trace_id: opts.trace_id,
    meta: {
      original_filename: opts.original_filename,
      tenant_slug: opts.tenant_slug,
    },
  };
}

// ---------------------------------------------------------------------------
// Event: site.rebuild.requested
// Enqueued by: POST /api/public/rebuild  (tenant deploy hook)
//              POST /webhooks/public-rebuild/smandapbun  (GitHub dispatch)
// Consumed by: notificationsConsumer.ts
// ---------------------------------------------------------------------------

export const SITE_REBUILD_EVENT = "site.rebuild.requested" as const;
export const SITE_REBUILD_SCHEMA = "1.0" as const;

/** Which external backend the consumer should call */
export type RebuildBackend = "webhook" | "github_dispatch";

export interface SiteRebuildMessage extends QueueMessageEnvelope {
  schema_version: typeof SITE_REBUILD_SCHEMA;
  event_type: typeof SITE_REBUILD_EVENT;
  resource_type: "site_rebuild";
  meta: {
    /** Which external call the consumer should make */
    backend: RebuildBackend;
    /** For backend === "webhook": the outbound URL (resolved at enqueue time from settings) */
    hook_url?: string;
    /** For backend === "github_dispatch": owner/repo/event_type (env vars resolved at enqueue time) */
    github_owner?: string;
    github_repo?: string;
    github_event_type?: string;
    /** Informational context passed to the outbound call body */
    source: string;
    resource?: string | null;
    action?: string;
    actor_id?: string;
    /** Smandapbun-specific fields */
    tenant_slug?: string;
    table?: string | null;
    operation?: string | null;
  };
}

export function buildSiteRebuildMessage(opts: {
  tenant_id: string;
  trace_id: string;
  backend: RebuildBackend;
  hook_url?: string;
  github_owner?: string;
  github_repo?: string;
  github_event_type?: string;
  source: string;
  resource?: string | null;
  action?: string;
  actor_id?: string;
  tenant_slug?: string;
  table?: string | null;
  operation?: string | null;
}): SiteRebuildMessage {
  return {
    schema_version: SITE_REBUILD_SCHEMA,
    event_type: SITE_REBUILD_EVENT,
    job_id: crypto.randomUUID(),
    idempotency_key: `site-rebuild:${opts.tenant_id}:${opts.source}:${Date.now()}`,
    tenant_id: opts.tenant_id,
    resource_type: "site_rebuild",
    resource_id: opts.tenant_id, // tenant is the resource for a rebuild
    occurred_at: new Date().toISOString(),
    trace_id: opts.trace_id,
    meta: {
      backend: opts.backend,
      hook_url: opts.hook_url,
      github_owner: opts.github_owner,
      github_repo: opts.github_repo,
      github_event_type: opts.github_event_type,
      source: opts.source,
      resource: opts.resource ?? null,
      action: opts.action,
      actor_id: opts.actor_id,
      tenant_slug: opts.tenant_slug,
      table: opts.table ?? null,
      operation: opts.operation ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Event: email.send.requested
// Enqueued by: POST /api/mailketing  (action === "send" only)
// Consumed by: notificationsConsumer.ts
// ---------------------------------------------------------------------------

export const EMAIL_SEND_EVENT = "email.send.requested" as const;
export const EMAIL_SEND_SCHEMA = "1.0" as const;

export interface EmailSendMessage extends QueueMessageEnvelope {
  schema_version: typeof EMAIL_SEND_SCHEMA;
  event_type: typeof EMAIL_SEND_EVENT;
  resource_type: "email_send";
  meta: {
    from_name: string;
    from_email: string;
    recipient: string;
    subject: string;
    content: string;
    attach1?: string;
    attach2?: string;
    attach3?: string;
  };
}

export function buildEmailSendMessage(opts: {
  tenant_id: string;
  trace_id: string;
  from_name: string;
  from_email: string;
  recipient: string;
  subject: string;
  content: string;
  attach1?: string;
  attach2?: string;
  attach3?: string;
}): EmailSendMessage {
  const job_id = crypto.randomUUID();
  return {
    schema_version: EMAIL_SEND_SCHEMA,
    event_type: EMAIL_SEND_EVENT,
    job_id,
    idempotency_key: `email-send:${opts.tenant_id}:${opts.recipient}:${job_id}`,
    tenant_id: opts.tenant_id,
    resource_type: "email_send",
    resource_id: job_id,
    occurred_at: new Date().toISOString(),
    trace_id: opts.trace_id,
    meta: {
      from_name: opts.from_name,
      from_email: opts.from_email,
      recipient: opts.recipient,
      subject: opts.subject,
      content: opts.content,
      attach1: opts.attach1,
      attach2: opts.attach2,
      attach3: opts.attach3,
    },
  };
}

// ---------------------------------------------------------------------------
// Event: whatsapp.send.requested
// Enqueued by: POST /api/notifications  (channel_type === "whatsapp")
// Consumed by: notificationsConsumer.ts
// ---------------------------------------------------------------------------

export const WHATSAPP_SEND_EVENT = "whatsapp.send.requested" as const;
export const WHATSAPP_SEND_SCHEMA = "1.0" as const;

export interface WhatsAppSendMessage extends QueueMessageEnvelope {
  schema_version: typeof WHATSAPP_SEND_SCHEMA;
  event_type: typeof WHATSAPP_SEND_EVENT;
  resource_type: "whatsapp_send";
  meta: {
    /** Recipient phone number in E.164 format, e.g. "+6281234567890" */
    phone: string;
    /** Plain-text or WhatsApp-formatted message body */
    message: string;
    /** StarSender device/sender ID */
    sender_id: string;
    /** dispatch_id in notification_dispatches — updated by consumer */
    dispatch_id: string;
    /** Optional media URL to attach */
    media_url?: string;
  };
}

export function buildWhatsAppSendMessage(opts: {
  tenant_id: string;
  trace_id: string;
  phone: string;
  message: string;
  sender_id: string;
  dispatch_id: string;
  media_url?: string;
}): WhatsAppSendMessage {
  const job_id = crypto.randomUUID();
  return {
    schema_version: WHATSAPP_SEND_SCHEMA,
    event_type: WHATSAPP_SEND_EVENT,
    job_id,
    idempotency_key: `wa-send:${opts.tenant_id}:${opts.dispatch_id}`,
    tenant_id: opts.tenant_id,
    resource_type: "whatsapp_send",
    resource_id: opts.dispatch_id,
    occurred_at: new Date().toISOString(),
    trace_id: opts.trace_id,
    meta: {
      phone: opts.phone,
      message: opts.message,
      sender_id: opts.sender_id,
      dispatch_id: opts.dispatch_id,
      media_url: opts.media_url,
    },
  };
}

// ---------------------------------------------------------------------------
// Event: telegram.send.requested
// Enqueued by: POST /api/notifications  (channel_type === "telegram")
// Consumed by: notificationsConsumer.ts
// ---------------------------------------------------------------------------

export const TELEGRAM_SEND_EVENT = "telegram.send.requested" as const;
export const TELEGRAM_SEND_SCHEMA = "1.0" as const;

export interface TelegramSendMessage extends QueueMessageEnvelope {
  schema_version: typeof TELEGRAM_SEND_SCHEMA;
  event_type: typeof TELEGRAM_SEND_EVENT;
  resource_type: "telegram_send";
  meta: {
    /** Telegram chat_id (numeric string or @username) */
    chat_id: string;
    /** Message text — supports MarkdownV2 if parse_mode is set */
    text: string;
    /** Optional Telegram parse_mode: "MarkdownV2" | "HTML" | undefined */
    parse_mode?: "MarkdownV2" | "HTML";
    /** dispatch_id in notification_dispatches — updated by consumer */
    dispatch_id: string;
  };
}

export function buildTelegramSendMessage(opts: {
  tenant_id: string;
  trace_id: string;
  chat_id: string;
  text: string;
  parse_mode?: "MarkdownV2" | "HTML";
  dispatch_id: string;
}): TelegramSendMessage {
  const job_id = crypto.randomUUID();
  return {
    schema_version: TELEGRAM_SEND_SCHEMA,
    event_type: TELEGRAM_SEND_EVENT,
    job_id,
    idempotency_key: `tg-send:${opts.tenant_id}:${opts.dispatch_id}`,
    tenant_id: opts.tenant_id,
    resource_type: "telegram_send",
    resource_id: opts.dispatch_id,
    occurred_at: new Date().toISOString(),
    trace_id: opts.trace_id,
    meta: {
      chat_id: opts.chat_id,
      text: opts.text,
      parse_mode: opts.parse_mode,
      dispatch_id: opts.dispatch_id,
    },
  };
}

// ---------------------------------------------------------------------------
// Union of all message types — extend as new event types are added
// ---------------------------------------------------------------------------

export type AnyQueueMessage =
  | MediaFinalizeMessage
  | SiteRebuildMessage
  | EmailSendMessage
  | WhatsAppSendMessage
  | TelegramSendMessage;

/**
 * Type guard: is the unknown value a valid QueueMessageEnvelope?
 * Used by consumers to reject malformed or unknown-version messages.
 */
export function isValidEnvelope(value: unknown): value is QueueMessageEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["schema_version"] === "string" &&
    typeof v["event_type"] === "string" &&
    typeof v["job_id"] === "string" &&
    typeof v["idempotency_key"] === "string" &&
    typeof v["tenant_id"] === "string" &&
    typeof v["resource_type"] === "string" &&
    typeof v["resource_id"] === "string" &&
    typeof v["occurred_at"] === "string" &&
    typeof v["trace_id"] === "string" &&
    typeof v["meta"] === "object" &&
    v["meta"] !== null
  );
}
