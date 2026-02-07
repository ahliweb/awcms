import type { APIRoute } from "astro";
import { getAllSitemapEntries, generateSitemapXml } from "~/lib/sitemap";
import { createClientFromEnv } from "~/lib/supabase";
import { getPublicTenantId } from "~/lib/publicTenant";

export const GET: APIRoute = async ({ request }) => {
  const supabase = createClientFromEnv(import.meta.env);
  const siteUrl = new URL(request.url).origin;
  const tenantId = getPublicTenantId();

  if (!supabase) {
    return new Response("Database connection failed", { status: 500 });
  }

  const entries = await getAllSitemapEntries(supabase, siteUrl, tenantId);
  const sitemapXml = generateSitemapXml(entries);

  return new Response(sitemapXml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
