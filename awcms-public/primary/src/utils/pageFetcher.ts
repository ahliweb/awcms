import { createClientFromEnv } from '../lib/supabase';
import type { PagePublicDTO } from '../types/PagePublicDTO';

export async function getPageBySlug(slug: string, tenantId: string, env: any = {}, previewToken?: string): Promise<PagePublicDTO | null> {
    const supabase = createClientFromEnv(env);
    if (!supabase) return null;

    // Normalize slug: '/' should be 'home' or handled by router?
    // User req: "Home page as reserved slug '/' or 'home' mapped to '/'"
    // We will assume DB stores 'home' for root, or we query slug = '/'?
    // Let's assume passed slug is validated. if slug is undefined (root), we search for 'home'.

    const searchSlug = slug || 'home';

    let query = supabase
        .from('pages')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('slug', searchSlug);

    // If valid preview token is NOT present, enforce published status
    // Note: RLS should also handle this but we add explicit safety.
    const systemPreviewSecret = env.VITE_PREVIEW_SECRET || import.meta.env.VITE_PREVIEW_SECRET;
    const isValidPreview = previewToken && systemPreviewSecret && previewToken === systemPreviewSecret;

    if (!isValidPreview) {
        query = query.eq('status', 'published').lte('published_at', new Date().toISOString());
    }

    const { data, error } = await query.single();

    if (error || !data) {
        if (error && error.code !== 'PGRST116') { // PGRST116 is no rows
            console.error("Error fetching page:", error);
        }
        return null;
    }

    return data as PagePublicDTO;
}
