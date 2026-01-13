export interface PagePublicDTO {
    id: string;
    tenant_id: string;
    slug: string;
    title: string;
    content_type: 'visual_builder' | 'richtext' | 'markdown';
    content: any; // JSON for visual, string for text
    layout_key: string;
    seo: {
        meta_title?: string;
        meta_description?: string;
        og_image?: string;
    };
    published_at: string;
    parent_id?: string;
    template_key?: string;
    sort_order?: number;
    nav_visibility?: boolean;
}
