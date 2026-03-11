import { supabase } from '@/lib/customSupabaseClient';
import { getEdgeBaseUrl } from '@/lib/media';

export async function triggerPublicRebuild({ tenantId, resource, action = 'update' }) {
  if (!tenantId) return { ok: false, skipped: true, reason: 'missing-tenant' };

  const { data } = await supabase.auth.getSession();
  const session = data?.session;
  if (!session?.access_token) {
    return { ok: false, skipped: true, reason: 'missing-session' };
  }

  const response = await fetch(`${getEdgeBaseUrl()}/api/public/rebuild`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'x-tenant-id': tenantId,
    },
    body: JSON.stringify({ resource, action }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = payload?.error || `Failed to trigger public rebuild (${response.status})`;
    throw new Error(message);
  }

  return response.json().catch(() => ({ ok: true }));
}
