/**
 * Notifications Queue Consumer
 *
 * Handles messages from the `awcms-notifications` queue:
 *   - site.rebuild.requested  → outbound HTTP to deploy hook or GitHub dispatch
 *   - email.send.requested    → outbound HTTP to Mailketing send API
 *
 * Authority: docs/architecture/queue-topology.md
 *
 * Consumer contract:
 *   - Permanent failures  → msg.ack()  (no DLQ loop: missing config, invalid payload)
 *   - Transient failures  → msg.retry() (network error, 5xx from remote)
 *   - Idempotency: messages may be delivered more than once; keep side-effects idempotent
 *     (deploy hooks and email sends are inherently non-idempotent — log duplicates, don't crash)
 */

import {
  AnyQueueMessage,
  EMAIL_SEND_EVENT,
  EMAIL_SEND_SCHEMA,
  EmailSendMessage,
  isValidEnvelope,
  SITE_REBUILD_EVENT,
  SITE_REBUILD_SCHEMA,
  SiteRebuildMessage,
  WHATSAPP_SEND_EVENT,
  WHATSAPP_SEND_SCHEMA,
  WhatsAppSendMessage,
  TELEGRAM_SEND_EVENT,
  TELEGRAM_SEND_SCHEMA,
  TelegramSendMessage,
} from "./contracts";
import { logAck, logPermanent, logRetry } from "./observability";

// ---------------------------------------------------------------------------
// Environment subset needed by this consumer (no dependency on index.ts)
// ---------------------------------------------------------------------------

export interface NotificationsConsumerEnv {
  MAILKETING_API_TOKEN: string;
  GITHUB_REBUILD_TOKEN?: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
}

// ---------------------------------------------------------------------------
// site.rebuild.requested handler
// ---------------------------------------------------------------------------

export async function handleSiteRebuildMessage(
  msg: SiteRebuildMessage,
  env: NotificationsConsumerEnv,
): Promise<{ permanent: boolean; error?: string }> {
  const { meta, job_id, tenant_id, event_type } = msg;
  const base = { queue: 'awcms-notifications', event_type, job_id, tenant_id };

  if (meta.backend === "webhook") {
    const hookUrl = meta.hook_url;
    if (!hookUrl) {
      logPermanent(base, "missing hook_url");
      return { permanent: true, error: "missing hook_url" };
    }

    let response: Response;
    try {
      response = await fetch(hookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "awcms-edge-notifications-queue",
        },
        body: JSON.stringify({
          tenant_id,
          source: meta.source,
          resource: meta.resource ?? null,
          action: meta.action ?? "update",
          actor_id: meta.actor_id ?? null,
          triggered_at: msg.occurred_at,
          job_id,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err: unknown) {
      const msg_text = err instanceof Error ? err.message : String(err);
      logRetry(base, `webhook fetch threw: ${msg_text}`);
      return { permanent: false, error: msg_text };
    }

    if (!response.ok) {
      const details = await response.text().catch(() => "(unreadable)");
      logRetry(base, `webhook returned ${response.status}: ${details}`);
      return { permanent: false, error: `HTTP ${response.status}` };
    }

    logAck(base, { message: `webhook ok (${response.status})` });
    return { permanent: false };
  }

  if (meta.backend === "github_dispatch") {
    const githubToken = env.GITHUB_REBUILD_TOKEN?.trim();
    const owner = meta.github_owner?.trim();
    const repo = meta.github_repo?.trim();
    const eventType = meta.github_event_type?.trim() || "content-changed";

    if (!githubToken || !owner || !repo) {
      logPermanent(base, "GitHub config missing (GITHUB_REBUILD_TOKEN, owner, or repo)");
      return { permanent: true, error: "github config missing" };
    }

    let response: Response;
    try {
      response = await fetch(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "Content-Type": "application/json",
          "User-Agent": "awcms-edge-notifications-queue",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          event_type: eventType,
          client_payload: {
            source: meta.source,
            tenant_slug: meta.tenant_slug ?? null,
            tenant_id,
            table: meta.table ?? null,
            operation: meta.operation ?? null,
            changed_at: msg.occurred_at,
            job_id,
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err: unknown) {
      const msg_text = err instanceof Error ? err.message : String(err);
      logRetry(base, `github dispatch fetch threw: ${msg_text}`);
      return { permanent: false, error: msg_text };
    }

    // GitHub returns 204 No Content on success
    if (!response.ok) {
      const details = await response.text().catch(() => "(unreadable)");
      logRetry(base, `github returned ${response.status}: ${details}`);
      return { permanent: false, error: `HTTP ${response.status}` };
    }

    logAck(base, { message: `github dispatch ok (${response.status})` });
    return { permanent: false };
  }

  logPermanent(base, `unknown backend: ${meta.backend}`);
  return { permanent: true, error: `unknown backend: ${meta.backend}` };
}

// ---------------------------------------------------------------------------
// email.send.requested handler
// ---------------------------------------------------------------------------

const MAILKETING_API = "https://api.mailketing.co.id/api/v1";

export async function handleEmailSendMessage(
  msg: EmailSendMessage,
  env: NotificationsConsumerEnv,
): Promise<{ permanent: boolean; error?: string }> {
  const { meta, job_id, tenant_id, event_type } = msg;
  const base = { queue: 'awcms-notifications', event_type, job_id, tenant_id };

  const apiToken = env.MAILKETING_API_TOKEN;
  if (!apiToken) {
    logPermanent(base, "MAILKETING_API_TOKEN not configured");
    return { permanent: true, error: "MAILKETING_API_TOKEN not configured" };
  }

  if (!meta.recipient || !meta.subject) {
    logPermanent(base, "missing recipient or subject");
    return { permanent: true, error: "missing recipient or subject" };
  }

  const params = new URLSearchParams({
    api_token: apiToken,
    from_name: meta.from_name,
    from_email: meta.from_email,
    recipient: meta.recipient,
    subject: meta.subject,
    content: meta.content,
  });
  if (meta.attach1) params.append("attach1", meta.attach1);
  if (meta.attach2) params.append("attach2", meta.attach2);
  if (meta.attach3) params.append("attach3", meta.attach3);

  let response: Response;
  try {
    response = await fetch(`${MAILKETING_API}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err: unknown) {
    const msg_text = err instanceof Error ? err.message : String(err);
    logRetry(base, `mailketing fetch threw: ${msg_text}`);
    return { permanent: false, error: msg_text };
  }

  if (!response.ok) {
    const details = await response.text().catch(() => "(unreadable)");
    logRetry(base, `mailketing returned ${response.status}: ${details}`);
    return { permanent: false, error: `HTTP ${response.status}` };
  }

  logAck(base, { message: `email sent ok (${response.status})` });
  return { permanent: false };
}

// ---------------------------------------------------------------------------
// WhatsApp (StarSender) handler
// ---------------------------------------------------------------------------

const STARSENDER_API = "https://api.starsender.online/api";

async function updateDispatchStatus(
  env: NotificationsConsumerEnv,
  dispatch_id: string,
  status: string,
  provider_message_id?: string,
  error_message?: string,
): Promise<void> {
  const supabaseUrl = env.SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey || !dispatch_id) return;

  const update: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (provider_message_id !== undefined) update.provider_message_id = provider_message_id;
  if (error_message !== undefined) update.error_message = error_message;

  try {
    await fetch(`${supabaseUrl}/rest/v1/notification_dispatches?id=eq.${dispatch_id}`, {
      method: "PATCH",
      headers: {
        "apikey": secretKey,
        "Authorization": `Bearer ${secretKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(update),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Non-critical: log update failures but don't affect message ack/retry
  }
}

export async function handleWhatsAppSendMessage(
  msg: WhatsAppSendMessage,
  env: NotificationsConsumerEnv,
): Promise<{ permanent: boolean; error?: string }> {
  const { meta, job_id, tenant_id, event_type } = msg;
  const base = { queue: 'awcms-notifications', event_type, job_id, tenant_id };

  if (!meta.phone || !meta.message || !meta.sender_id) {
    logPermanent(base, "missing phone, message, or sender_id");
    await updateDispatchStatus(env, meta.dispatch_id, 'permanent_failure', undefined, 'missing phone, message, or sender_id');
    return { permanent: true, error: "missing required fields" };
  }

  const payload: Record<string, string> = {
    messageType: "text",
    to: meta.phone,
    body: meta.message,
  };
  if (meta.media_url) {
    payload.mediaUrl = meta.media_url;
    payload.messageType = "media";
  }

  let response: Response;
  try {
    response = await fetch(`${STARSENDER_API}/sendMessage/${meta.sender_id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.MAILKETING_API_TOKEN}`, // StarSender token reuses env key placeholder
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err: unknown) {
    const msg_text = err instanceof Error ? err.message : String(err);
    logRetry(base, `starsender fetch threw: ${msg_text}`);
    await updateDispatchStatus(env, meta.dispatch_id, 'failed', undefined, msg_text);
    return { permanent: false, error: msg_text };
  }

  if (!response.ok) {
    const details = await response.text().catch(() => "(unreadable)");
    logRetry(base, `starsender returned ${response.status}: ${details}`);
    await updateDispatchStatus(env, meta.dispatch_id, 'failed', undefined, `HTTP ${response.status}`);
    return { permanent: false, error: `HTTP ${response.status}` };
  }

  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  const provider_id = (result?.messageId ?? result?.id ?? job_id) as string;
  logAck(base, { message: `whatsapp sent ok (${response.status})` });
  await updateDispatchStatus(env, meta.dispatch_id, 'sent', String(provider_id));
  return { permanent: false };
}

// ---------------------------------------------------------------------------
// Telegram handler
// ---------------------------------------------------------------------------

const TELEGRAM_API = "https://api.telegram.org";

export async function handleTelegramSendMessage(
  msg: TelegramSendMessage,
  env: NotificationsConsumerEnv,
): Promise<{ permanent: boolean; error?: string }> {
  const { meta, job_id, tenant_id, event_type } = msg;
  const base = { queue: 'awcms-notifications', event_type, job_id, tenant_id };

  // Bot token is stored per-channel in credentials, passed in meta is not available here.
  // The enqueue-side (notificationService.js) must embed the bot_token into a Worker secret
  // or pass it as part of a signed payload. For now we read it from a dedicated env var
  // following the pattern: TELEGRAM_BOT_TOKEN (single shared bot) or future per-tenant resolution.
  const botToken = (env as unknown as Record<string, string>)["TELEGRAM_BOT_TOKEN"] ?? "";
  if (!botToken) {
    logPermanent(base, "TELEGRAM_BOT_TOKEN not configured in Worker env");
    await updateDispatchStatus(env, meta.dispatch_id, 'permanent_failure', undefined, 'TELEGRAM_BOT_TOKEN not configured');
    return { permanent: true, error: "TELEGRAM_BOT_TOKEN not configured" };
  }

  if (!meta.chat_id || !meta.text) {
    logPermanent(base, "missing chat_id or text");
    await updateDispatchStatus(env, meta.dispatch_id, 'permanent_failure', undefined, 'missing chat_id or text');
    return { permanent: true, error: "missing chat_id or text" };
  }

  const body: Record<string, unknown> = {
    chat_id: meta.chat_id,
    text: meta.text,
  };
  if (meta.parse_mode) body.parse_mode = meta.parse_mode;

  let response: Response;
  try {
    response = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err: unknown) {
    const msg_text = err instanceof Error ? err.message : String(err);
    logRetry(base, `telegram fetch threw: ${msg_text}`);
    await updateDispatchStatus(env, meta.dispatch_id, 'failed', undefined, msg_text);
    return { permanent: false, error: msg_text };
  }

  if (!response.ok) {
    const details = await response.text().catch(() => "(unreadable)");
    const is4xx = response.status >= 400 && response.status < 500;
    if (is4xx) {
      logPermanent(base, `telegram returned ${response.status}: ${details}`);
      await updateDispatchStatus(env, meta.dispatch_id, 'permanent_failure', undefined, `HTTP ${response.status}: ${details.slice(0, 200)}`);
      return { permanent: true, error: `HTTP ${response.status}` };
    }
    logRetry(base, `telegram returned ${response.status}: ${details}`);
    await updateDispatchStatus(env, meta.dispatch_id, 'failed', undefined, `HTTP ${response.status}`);
    return { permanent: false, error: `HTTP ${response.status}` };
  }

  const result = await response.json().catch(() => ({})) as { result?: { message_id?: number } };
  const provider_id = result?.result?.message_id ?? job_id;
  logAck(base, { message: `telegram sent ok (${response.status})` });
  await updateDispatchStatus(env, meta.dispatch_id, 'sent', String(provider_id));
  return { permanent: false };
}

// ---------------------------------------------------------------------------
// Batch entry point — wired into export default { queue } in index.ts
// ---------------------------------------------------------------------------

export async function notificationsQueueHandler(
  batch: MessageBatch<AnyQueueMessage>,
  env: NotificationsConsumerEnv,
): Promise<void> {
  for (const message of batch.messages) {
    const body = message.body;

    if (!isValidEnvelope(body)) {
      logPermanent(
        { queue: 'awcms-notifications', event_type: 'unknown', job_id: 'unknown', tenant_id: 'unknown' },
        `invalid envelope: ${JSON.stringify(body).slice(0, 200)}`,
      );
      message.ack();
      continue;
    }

    try {
      if (body.event_type === SITE_REBUILD_EVENT) {
        if (body.schema_version !== SITE_REBUILD_SCHEMA) {
          logPermanent(
            { queue: 'awcms-notifications', event_type: body.event_type, job_id: body.job_id, tenant_id: body.tenant_id },
            `unknown schema version ${body.schema_version}`,
          );
          message.ack();
          continue;
        }
        const result = await handleSiteRebuildMessage(body as SiteRebuildMessage, env);
        if (result.permanent || !result.error) {
          message.ack();
        } else {
          message.retry();
        }
        continue;
      }

      if (body.event_type === EMAIL_SEND_EVENT) {
        if (body.schema_version !== EMAIL_SEND_SCHEMA) {
          logPermanent(
            { queue: 'awcms-notifications', event_type: body.event_type, job_id: body.job_id, tenant_id: body.tenant_id },
            `unknown schema version ${body.schema_version}`,
          );
          message.ack();
          continue;
        }
        const result = await handleEmailSendMessage(body as EmailSendMessage, env);
        if (result.permanent || !result.error) {
          message.ack();
        } else {
          message.retry();
        }
        continue;
      }

      if (body.event_type === WHATSAPP_SEND_EVENT) {
        if (body.schema_version !== WHATSAPP_SEND_SCHEMA) {
          logPermanent(
            { queue: 'awcms-notifications', event_type: body.event_type, job_id: body.job_id, tenant_id: body.tenant_id },
            `unknown schema version ${body.schema_version}`,
          );
          message.ack();
          continue;
        }
        const result = await handleWhatsAppSendMessage(body as WhatsAppSendMessage, env);
        if (result.permanent || !result.error) {
          message.ack();
        } else {
          message.retry();
        }
        continue;
      }

      if (body.event_type === TELEGRAM_SEND_EVENT) {
        if (body.schema_version !== TELEGRAM_SEND_SCHEMA) {
          logPermanent(
            { queue: 'awcms-notifications', event_type: body.event_type, job_id: body.job_id, tenant_id: body.tenant_id },
            `unknown schema version ${body.schema_version}`,
          );
          message.ack();
          continue;
        }
        const result = await handleTelegramSendMessage(body as TelegramSendMessage, env);
        if (result.permanent || !result.error) {
          message.ack();
        } else {
          message.retry();
        }
        continue;
      }

      // Unknown event type — ack to avoid infinite DLQ loop
      logPermanent(
        { queue: 'awcms-notifications', event_type: body.event_type, job_id: body.job_id, tenant_id: body.tenant_id },
        `unknown event_type "${body.event_type}"`,
      );
      message.ack();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logRetry(
        {
          queue: 'awcms-notifications',
          event_type: (body as AnyQueueMessage).event_type ?? 'unknown',
          job_id: (body as AnyQueueMessage).job_id ?? '?',
          tenant_id: (body as AnyQueueMessage).tenant_id ?? '',
        },
        `unhandled error: ${errMsg}`,
      );
      message.retry();
    }
  }
}
