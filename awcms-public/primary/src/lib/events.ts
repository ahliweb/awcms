export interface PublicEventRecord {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  location: string | null;
  start_at: string;
  end_at: string | null;
  published_at: string | null;
  status: string;
}

const getPublicEdgeUrl = () =>
  import.meta.env.PUBLIC_EDGE_URL || import.meta.env.VITE_EDGE_URL || "";

export async function getPublicEvents(
  tenantId: string,
  options: { limit?: number } = {},
): Promise<PublicEventRecord[]> {
  const edgeUrl = getPublicEdgeUrl();
  if (!edgeUrl || !tenantId) {
    return [];
  }

  const limit = options.limit || 12;
  const url = new URL(`${edgeUrl}/functions/v1/extensions/events/public`);
  url.searchParams.set("tenantId", tenantId);
  url.searchParams.set("limit", String(limit));

  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    return Array.isArray(payload?.events) ? payload.events : [];
  } catch {
    return [];
  }
}

export async function getPublicEventBySlug(
  tenantId: string,
  slug: string,
): Promise<PublicEventRecord | null> {
  const edgeUrl = getPublicEdgeUrl();
  if (!edgeUrl || !tenantId || !slug) {
    return null;
  }

  const url = new URL(`${edgeUrl}/functions/v1/extensions/events/public`);
  url.searchParams.set("tenantId", tenantId);
  url.searchParams.set("slug", slug);

  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    return payload?.event || null;
  } catch {
    return null;
  }
}
