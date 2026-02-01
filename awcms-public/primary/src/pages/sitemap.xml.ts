import type { APIRoute } from "astro";
import { getAllSitemapEntries, generateSitemapXml } from "~/lib/sitemap";
import { createClientFromEnv } from "~/lib/supabase";

export const GET: APIRoute = async ({ request, locals }) => {
  const supabase = createClientFromEnv(import.meta.env);
  const siteUrl = new URL(request.url).origin;
  const { tenant_id } = locals;

  if (!supabase) {
    return new Response("Database connection failed", { status: 500 });
  }

  const entries = await getAllSitemapEntries(supabase, siteUrl, tenant_id);
  const sitemapXml = generateSitemapXml(entries);

  return new Response(sitemapXml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
