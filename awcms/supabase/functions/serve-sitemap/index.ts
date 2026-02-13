// Supabase Edge Function: serve-sitemap
// Deploy with: supabase functions deploy serve-sitemap
// Usage: /functions/v1/serve-sitemap?domain=example.com OR ?tenant_id=uuid

/// <reference path="../_shared/types.d.ts" />

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface SitemapItem {
    slug: string;
    updated_at: string;
}

console.log('Sitemap Function Initialized')

export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SECRET_KEY') ?? '' // Use service role for full access
        )

        // Get tenant from query params or hostname
        const url = new URL(req.url)
        const domainParam = url.searchParams.get('domain')
        const tenantIdParam = url.searchParams.get('tenant_id')

        let tenantId: string | null = null
        let baseUrl = 'https://awcms.ahliweb.com'

        // 1. Resolve Tenant
        if (tenantIdParam) {
            tenantId = tenantIdParam
            // Fetch tenant details
            const { data: tenant } = await supabase
                .from('tenants')
                .select('domain, config')
                .eq('id', tenantId)
                .single()
            if (tenant?.domain) {
                baseUrl = `https://${tenant.domain}`
            }
        } else if (domainParam) {
            // Lookup tenant by domain
            const { data: tenant } = await supabase
                .rpc('get_tenant_by_domain', { lookup_domain: domainParam })
            if (tenant) {
                tenantId = tenant.id
                baseUrl = `https://${domainParam}`
            }
        }

        if (!tenantId) {
            return new Response(
                '<?xml version="1.0" encoding="UTF-8"?><error>Tenant not found</error>',
                {
                    headers: { ...corsHeaders, 'Content-Type': 'application/xml' },
                    status: 404
                }
            )
        }

        // 2. Fetch Published Articles (tenant-scoped)
        const { data: articles } = await supabase
            .from('articles')
            .select('slug, updated_at')
            .eq('tenant_id', tenantId)
            .eq('status', 'published')
            .is('deleted_at', null)
            .order('updated_at', { ascending: false })

        // 3. Fetch Published Pages (tenant-scoped)
        const { data: pages } = await supabase
            .from('pages')
            .select('slug, updated_at')
            .eq('tenant_id', tenantId)
            .eq('status', 'published')
            .eq('is_public', true)
            .is('deleted_at', null)
            .order('updated_at', { ascending: false })

        // 4. Fetch Active Products (tenant-scoped)
        const { data: products } = await supabase
            .from('products')
            .select('slug, updated_at')
            .eq('tenant_id', tenantId)
            .eq('status', 'active')
            .is('deleted_at', null)
            .order('updated_at', { ascending: false })

        // 5. Build XML Sitemap
        let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <!-- Homepage -->
  <url>
    <loc>${baseUrl}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>`

        // Add Articles
        if (articles && articles.length > 0) {
            xml += `
  <!-- Articles (${articles.length}) -->`
            articles.forEach((item: SitemapItem) => {
                xml += `
  <url>
    <loc>${baseUrl}/articles/${item.slug}</loc>
    <lastmod>${new Date(item.updated_at).toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`
            })
        }

        // Add Pages
        if (pages && pages.length > 0) {
            xml += `
  <!-- Pages (${pages.length}) -->`
            pages.forEach((item: SitemapItem) => {
                // Skip if slug matches homepage
                if (item.slug === 'home' || item.slug === '/') return
                xml += `
  <url>
    <loc>${baseUrl}/${item.slug}</loc>
    <lastmod>${new Date(item.updated_at).toISOString()}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`
            })
        }

        // Add Products
        if (products && products.length > 0) {
            xml += `
  <!-- Products (${products.length}) -->`
            products.forEach((item: SitemapItem) => {
                xml += `
  <url>
    <loc>${baseUrl}/products/${item.slug}</loc>
    <lastmod>${new Date(item.updated_at).toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>`
            })
        }

        xml += `
</urlset>`

        return new Response(xml, {
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/xml; charset=utf-8',
                'Cache-Control': 'public, max-age=3600, s-maxage=86400'
            },
        })

    } catch (error: unknown) {
        const err = error as Error
        console.error('Sitemap Error:', err)
        return new Response(
            `<?xml version="1.0" encoding="UTF-8"?><error>${err?.message || 'Unknown error'}</error>`,
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/xml' },
                status: 500,
            }
        )
    }
})

