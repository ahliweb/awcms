/**
 * OpenClaw Client
 *
 * Thin wrapper around the OpenClaw AI gateway endpoint.
 * The gateway URL is read from the environment variable VITE_OPENCLAW_URL,
 * with a fallback to the platform_settings table key "openclaw.gateway_url".
 *
 * Usage:
 *   import { openclawRequest } from '@/lib/openclawClient';
 *   const result = await openclawRequest('/v1/chat/completions', { model: '…', messages: [] });
 */

import { supabase } from '@/lib/customSupabaseClient';

// Static env-first URL — injected at build time via VITE_ prefix
const ENV_GATEWAY_URL = import.meta.env.VITE_OPENCLAW_URL ?? null;

/**
 * Resolve the OpenClaw gateway base URL.
 * Prefers VITE_OPENCLAW_URL; falls back to platform_settings DB lookup.
 *
 * @returns {Promise<string|null>}
 */
export async function resolveGatewayUrl() {
  if (ENV_GATEWAY_URL) return ENV_GATEWAY_URL;

  try {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'openclaw.gateway_url')
      .maybeSingle();

    if (error) throw error;
    return data?.value ?? null;
  } catch (err) {
    console.warn('[openclawClient] Could not resolve gateway URL from platform_settings:', err.message);
    return null;
  }
}

/**
 * Make an authenticated request to the OpenClaw gateway.
 *
 * @param {string} path       – e.g. '/v1/chat/completions'
 * @param {object} body       – JSON-serializable request body
 * @param {object} [options]
 * @param {string} [options.method]  – HTTP method, default 'POST'
 * @param {object} [options.headers] – additional headers
 * @returns {Promise<any>}    – parsed JSON response
 */
export async function openclawRequest(path, body = {}, options = {}) {
  const baseUrl = await resolveGatewayUrl();
  if (!baseUrl) {
    throw new Error(
      'OpenClaw gateway URL is not configured. ' +
      'Set VITE_OPENCLAW_URL in your environment or add openclaw.gateway_url to platform_settings.'
    );
  }

  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token ?? '';

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers ?? {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const errBody = await response.json();
      detail = errBody?.error?.message ?? errBody?.message ?? detail;
    } catch {
      // ignore parse failure
    }
    throw new Error(`OpenClaw request failed [${response.status}]: ${detail}`);
  }

  return response.json();
}

export default { resolveGatewayUrl, openclawRequest };
