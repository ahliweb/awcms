/**
 * Notification Service
 *
 * Enqueues outbound notification messages via the Cloudflare Edge Worker
 * (`awcms-edge/functions/v1/notifications-enqueue`).
 *
 * The Worker pushes the payload onto the `awcms-notifications` Cloudflare Queue
 * which is consumed by `notificationsConsumer.ts`.
 *
 * If the edge endpoint is unavailable the call throws — callers should handle
 * errors and surface them via toast notifications.
 *
 * Supported channel types:  'email' | 'whatsapp' | 'telegram'
 *
 * Usage:
 *   import { sendNotification } from '@/lib/notificationService';
 *   await sendNotification({
 *     tenantId,
 *     channelType: 'whatsapp',
 *     recipient: '+6281234567890',
 *     message: 'Hello from AWCMS',
 *   });
 */

import { supabase } from '@/lib/customSupabaseClient';

const EDGE_URL = import.meta.env.VITE_EDGE_URL ?? '';
const ENQUEUE_ENDPOINT = `${EDGE_URL}/api/notifications/enqueue`;

/**
 * Enqueue an outbound notification message.
 *
 * @param {object} params
 * @param {string}  params.tenantId    – current tenant UUID
 * @param {string}  params.channelType – 'email' | 'whatsapp' | 'telegram'
 * @param {string}  params.recipient   – destination address / phone / chat_id
 * @param {string}  params.message     – plain-text or HTML message body
 * @param {string}  [params.subject]   – subject line (email only)
 * @param {string}  [params.templateSlug] – notification_templates.slug (optional)
 * @param {object}  [params.templateVars] – variables for template interpolation
 * @param {string}  [params.dispatchId]   – pre-generated UUID for idempotency
 * @returns {Promise<{ queued: boolean, dispatch_id: string }>}
 */
export async function sendNotification({
  tenantId,
  channelType,
  recipient,
  message,
  subject,
  templateSlug,
  templateVars,
  dispatchId,
}) {
  if (!tenantId) throw new Error('sendNotification: tenantId is required');
  if (!channelType) throw new Error('sendNotification: channelType is required');
  if (!recipient) throw new Error('sendNotification: recipient is required');
  if (!message && !templateSlug) throw new Error('sendNotification: message or templateSlug is required');

  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token ?? '';

  const payload = {
    tenant_id: tenantId,
    channel_type: channelType,
    recipient,
    message: message ?? null,
    subject: subject ?? null,
    template_slug: templateSlug ?? null,
    template_vars: templateVars ?? null,
    dispatch_id: dispatchId ?? crypto.randomUUID(),
  };

  const response = await fetch(ENQUEUE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'x-tenant-id': tenantId,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const errBody = await response.json();
      detail = errBody?.error ?? errBody?.message ?? detail;
    } catch {
      // ignore
    }
    throw new Error(`Notification enqueue failed [${response.status}]: ${detail}`);
  }

  return response.json();
}

/**
 * Send a test message on the given channel to verify credentials are working.
 * Sends to the `recipient` address/number provided by the caller.
 *
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.channelType
 * @param {string} params.recipient
 * @returns {Promise<{ queued: boolean, dispatch_id: string }>}
 */
export async function sendTestNotification({ tenantId, channelType, recipient }) {
  const channelLabels = {
    email:    'Email',
    whatsapp: 'WhatsApp',
    telegram: 'Telegram',
  };
  const label = channelLabels[channelType] ?? channelType;

  return sendNotification({
    tenantId,
    channelType,
    recipient,
    subject: `AWCMS ${label} Test`,
    message: `This is a test message from AWCMS to verify your ${label} channel is working correctly.\n\nSent at: ${new Date().toISOString()}`,
  });
}

const notificationService = {
  sendNotification,
  sendTestNotification,
};

export default notificationService;
