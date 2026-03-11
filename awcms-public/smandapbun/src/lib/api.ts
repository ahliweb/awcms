import { type SupabaseClient } from '@supabase/supabase-js';
import { supabase, createScopedClient } from './supabase';
import { defaultLocale, type Locale } from '../utils/i18n';
import contactDefault from '../data/pages/contact.json';
import profileDefault from '../data/pages/profile.json';
import organizationDefault from '../data/pages/organization.json';
import servicesDefault from '../data/pages/services.json';
import financeDefault from '../data/blogs/finance.json';
import achievementsDefault from '../data/pages/achievements.json';
import alumniDefault from '../data/pages/alumni.json';
import staffDefault from '../data/pages/staff.json';
import imagesDefault from '../data/images.json';
import blogsDefault from '../data/blogs/blogs.json';
import siteDefault from '../data/site.json';


const DEFAULT_TENANT_SLUG = 'smandapbun';
const TENANT_SLUG = String(
    import.meta.env.PUBLIC_TENANT_SLUG ||
    import.meta.env.VITE_PUBLIC_TENANT_SLUG ||
    DEFAULT_TENANT_SLUG,
).trim();
const TENANT_ID_FROM_ENV = String(
    import.meta.env.PUBLIC_TENANT_ID ||
    import.meta.env.VITE_PUBLIC_TENANT_ID ||
    import.meta.env.VITE_TENANT_ID ||
    '',
).trim() || null;
const RESERVED_PAGE_SLUGS = new Set([
    '404',
    'alumni',
    'blogs',
    'en',
    'keuangan',
    'kontak',
    'layanan',
    'p',
    'prestasi',
    'profil',
]);

const getTenantClient = (tenantId?: string | null): SupabaseClient => {
    if (!tenantId) return supabase as SupabaseClient;
    const scopedClient = createScopedClient(
        { 'x-tenant-id': tenantId },
        import.meta.env,
    );
    return (scopedClient || supabase) as SupabaseClient;
};

export interface LocalizedString {
    id: string;
    en: string;
}

export interface LocalizedStringArray {
    id: string[];
    en: string[];
}

export interface ContactData {
    contactPage: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        description: LocalizedString;
    };
    contactInfo: {
        address: LocalizedString;
        phone: string;
        fax: string;
        email: string;
        website: string;
        operationalHours: LocalizedString;
    };
    socialMedia: Array<{ platform: string; url: string; icon: string }>;
    mapEmbed: string;
}

export interface ServicesData {
    extracurricular: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        description: LocalizedString;
        activities: {
            name: string;
            category: string;
            schedule: string;
            coach: string;
        }[];
    };
    laboratory: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        labs: {
            name: LocalizedString;
            description: LocalizedString;
            capacity: number;
        }[];
    };
    serviceClasses: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        description: LocalizedString;
    };
    osn: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        content: LocalizedString;
        schedule: string;
    };
    research: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        content: LocalizedString;
    };
    library: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        content: LocalizedString;
    };
    serviceSurvey: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        content: LocalizedString;
        surveyLink: string;
    };
    studentAffairs: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        services: LocalizedString[];
    };
    mentoringForm: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        content: LocalizedString;
        formLink: string;
    };
}

export interface CompetencyAlignmentData {
    id: string;
    slug: string;
    category: string;
    title: LocalizedString;
    subtitle?: LocalizedString;
    nationalGoal: {
        title: LocalizedString;
        reference: LocalizedString;
        description: LocalizedString;
    };
    graduateStandards: {
        title: LocalizedString;
        reference: LocalizedString;
        items: LocalizedStringArray;
    };
    learningFramework: {
        title: LocalizedString;
        items: LocalizedStringArray;
    };
    implementation: {
        title: LocalizedString;
        subtitle?: LocalizedString;
        progressLabel: LocalizedString;
        items: Array<{
            category: LocalizedString;
            progress: LocalizedString;
            activities: LocalizedStringArray;
        }>;
    };
    signatory: {
        placeDate: LocalizedString;
        title: LocalizedString;
        name: string;
        idNumber: string;
    };
}

export interface ProfileData {
    principalMessage: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        content: LocalizedString;
        author: string;
        position: string;
        image: string;
    };
    history: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        content: LocalizedString;
        milestones: Array<{ year: string; event: LocalizedString }>;
    };
    visionMission: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        subtitle?: LocalizedString;
        vision: LocalizedString;
        visionIndicators?: Array<{
            title: LocalizedString;
            description: LocalizedString;
        }>;
        mission: LocalizedStringArray;
        goals?: LocalizedStringArray;
        programs?: {
            studentAffairs: {
                title: LocalizedString;
                items: LocalizedStringArray;
            };
            curriculum: {
                title: LocalizedString;
                items: LocalizedStringArray;
            };
            publicRelations: {
                title: LocalizedString;
                academic: {
                    title: LocalizedString;
                    items: LocalizedStringArray;
                };
                nonAcademic: {
                    title: LocalizedString;
                    items: LocalizedStringArray;
                };
            };
        };
        motto: LocalizedString;
    };
    schoolCondition: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        content: LocalizedString;
        statistics: { landArea: string; buildingArea: string; greenArea: string; parkingArea: string };
    };
    facilities: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        items: Array<{
            name: LocalizedString;
            count: number;
            condition: string;
            description: LocalizedString;
        }>;
    };
    adiwiyata: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        content: LocalizedString;
        awards: Array<{ year: string; title: LocalizedString }>;
    };
    competencyAlignment?: CompetencyAlignmentData;
}

export interface SiteData {
    site: {
        name: string | LocalizedString;
        shortName?: string;
        tagline: string | LocalizedString;
        description: string | LocalizedString;
        logo?: string;
        favicon?: string;
        address?: string | LocalizedString;
        phone?: string;
        email?: string;
        website?: string;
        socialMedia?: {
            instagram?: string;
            instagramOsis?: string;
            youtube?: string;
        };
    };
    contact: {
        address?: string;
        phone?: string;
        email?: string;
        messages?: string; // Add messages property to fix error 
    };
    stats: {
        students: number;
        teachers: number;
        staff: number;
        extracurriculars: number;
        alumni?: number;
        achievements?: number;
    };
    accreditation: string;
    established: string;
}

export async function getTenantId(overrideTenantId?: string | null) {
    if (overrideTenantId) return overrideTenantId;
    if (TENANT_ID_FROM_ENV) return TENANT_ID_FROM_ENV;

    if (!supabase) {
        return null;
    }

    const { data, error } = await supabase.rpc('get_tenant_by_slug', {
        lookup_slug: TENANT_SLUG
    }).maybeSingle();

    if (error) {
        console.error('Error fetching tenant:', error);
        return null;
    }

    // Cast data to expected type
    const tenant = data as { id: string; slug: string } | null;
    return tenant ? tenant.id : null;
}

export async function getAnalyticsConsent(overrideTenantId?: string | null) {
    const tenantId = await getTenantId(overrideTenantId);
    if (!tenantId) return null;

    const client = getTenantClient(tenantId);
    const { data } = await client
        .from('settings')
        .select('value')
        .eq('tenant_id', tenantId)
        .eq('key', 'analytics_consent')
        .maybeSingle();

    if (!data?.value) return null;

    try {
        return typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    } catch (e) {
        console.error('Error parsing analytics consent settings:', e);
        return null;
    }
}

type ContentTranslationType = 'page' | 'article' | 'blog';

interface ContentTranslationRow {
    content_id: string;
    locale: string;
    title?: string | null;
    slug?: string | null;
    content?: string | null;
    excerpt?: string | null;
    meta_description?: string | null;
}

async function getContentTranslations(
    client: SupabaseClient,
    tenantId: string,
    contentType: ContentTranslationType | ContentTranslationType[],
    locale?: string,
    contentIds: string[] = [],
) {
    if (!locale || contentIds.length === 0) {
        return new Map<string, ContentTranslationRow>();
    }

    let query = client
        .from('content_translations')
        .select('content_id, locale, title, slug, content, excerpt, meta_description')
        .eq('tenant_id', tenantId)
        .eq('locale', locale)
        .in('content_id', contentIds);

    const contentTypes = Array.isArray(contentType) ? contentType : [contentType];
    query = query.in('content_type', contentTypes);

    const { data, error } = await query;

    if (error) {
        console.warn('[Public] Error fetching content translations:', error.message);
        return new Map<string, ContentTranslationRow>();
    }

    return new Map((data || []).map((row) => [row.content_id, row as ContentTranslationRow]));
}

const mergeLocalizedField = (
    field: LocalizedString,
    value: string | null | undefined,
    locale?: Locale,
): LocalizedString => {
    if (!value || !locale) return field;

    return {
        ...field,
        [locale]: value,
    } as LocalizedString;
};

export interface AdminPage {
    id: string;
    title: string;
    slug: string;
    content: string | null;
    excerpt: string | null;
    featured_image: string | null;
    status: string;
    editor_type: string | null;
    page_type: string | null;
    published_at: string | null;
    updated_at: string | null;
    meta_title: string | null;
    meta_description: string | null;
    meta_keywords: string | null;
    og_image: string | null;
    canonical_url: string | null;
    content_published?: Record<string, unknown> | null;
    puck_layout_jsonb?: Record<string, unknown> | null;
}

async function getPageTranslationBySlug(
    client: SupabaseClient,
    tenantId: string,
    slug: string,
    locale?: Locale,
) {
    if (!locale) return null;

    const { data, error } = await client
        .from('content_translations')
        .select('content_id, locale, title, slug, content, excerpt, meta_description')
        .eq('tenant_id', tenantId)
        .eq('locale', locale)
        .eq('content_type', 'page')
        .eq('slug', slug)
        .maybeSingle();

    if (error) {
        console.warn('[Public] Error fetching page translation by slug:', error.message);
        return null;
    }

    return (data as ContentTranslationRow | null) || null;
}

function mapAdminPage(
    row: any,
    translation?: ContentTranslationRow | null,
): AdminPage {
    return {
        id: row.id,
        title: translation?.title || row.title,
        slug: translation?.slug || row.slug,
        content: translation?.content || row.content || null,
        excerpt: translation?.excerpt || row.excerpt || null,
        featured_image: row.featured_image || null,
        status: row.status,
        editor_type: row.editor_type || null,
        page_type: row.page_type || null,
        published_at: row.published_at || null,
        updated_at: row.updated_at || null,
        meta_title: row.meta_title || null,
        meta_description: translation?.meta_description || row.meta_description || null,
        meta_keywords: row.meta_keywords || null,
        og_image: row.og_image || null,
        canonical_url: row.canonical_url || null,
        content_published: row.content_published || null,
        puck_layout_jsonb: row.puck_layout_jsonb || null,
    };
}

export async function getAdminPageBySlug(
    slug: string,
    locale: Locale = defaultLocale,
    overrideTenantId?: string | null,
) {
    const tenantId = await getTenantId(overrideTenantId);
    if (!tenantId || !slug) return null;

    const client = getTenantClient(tenantId);
    const translationMatch = await getPageTranslationBySlug(client, tenantId, slug, locale);

    let query = client
        .from('pages')
        .select('id, title, slug, content, excerpt, featured_image, status, editor_type, page_type, published_at, updated_at, meta_title, meta_description, meta_keywords, og_image, canonical_url, content_published, puck_layout_jsonb')
        .eq('tenant_id', tenantId)
        .eq('status', 'published')
        .is('deleted_at', null)
        .eq('page_type', 'regular');

    if (translationMatch?.content_id) {
        query = query.eq('id', translationMatch.content_id);
    } else {
        query = query.eq('slug', slug);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
        console.error('[Public] Error fetching admin page:', error.message);
        return null;
    }

    if (!data) return null;

    let translation = translationMatch;
    if (!translation && locale) {
        const translations = await getContentTranslations(client, tenantId, 'page', locale, [data.id]);
        translation = translations.get(data.id) || null;
    }

    return mapAdminPage(data, translation);
}

export async function getAdminPageSlugs(
    locale: Locale = defaultLocale,
    overrideTenantId?: string | null,
) {
    const tenantId = await getTenantId(overrideTenantId);
    if (!tenantId) return [] as string[];

    const client = getTenantClient(tenantId);
    const { data, error } = await client
        .from('pages')
        .select('id, slug')
        .eq('tenant_id', tenantId)
        .eq('status', 'published')
        .eq('page_type', 'regular')
        .is('deleted_at', null);

    if (error) {
        console.error('[Public] Error fetching admin page slugs:', error.message);
        return [] as string[];
    }

    const basePages = data || [];
    if (basePages.length === 0) return [] as string[];

    const translations = await getContentTranslations(
        client,
        tenantId,
        'page',
        locale,
        basePages.map((page) => page.id),
    );

    return basePages
        .map((page) => translations.get(page.id)?.slug || page.slug)
        .filter((slugValue): slugValue is string => Boolean(slugValue))
        .filter((slugValue) => !slugValue.includes('/'))
        .filter((slugValue) => !RESERVED_PAGE_SLUGS.has(slugValue));
}

export interface NavigationItem {
    id: string;
    label: string;
    href: string;
    children?: NavigationItem[];
    order?: number;
    is_active?: boolean;
}

const isMissingLocaleColumnError = (message: string): boolean =>
    message.includes('.locale') && message.includes('does not exist');

const buildMenuTree = (rows: any[]): NavigationItem[] => {
    const nodes: Record<string, NavigationItem> = {};
    const roots: NavigationItem[] = [];

    rows.forEach((row) => {
        nodes[row.id] = {
            id: row.id,
            label: row.label,
            href: row.url || '#',
            order: row.order || 0,
            is_active: row.is_active !== false,
            children: [],
        };
    });

    rows.forEach((row) => {
        const node = nodes[row.id];
        if (row.parent_id && nodes[row.parent_id]) {
            nodes[row.parent_id].children?.push(node);
        } else {
            roots.push(node);
        }
    });

    const sortNodes = (items: NavigationItem[]) => {
        items.sort((a, b) => (a.order || 0) - (b.order || 0));
        items.forEach((item) => item.children && sortNodes(item.children));
    };

    sortNodes(roots);
    return roots;
};

export async function getMenuTree(location: string, locale?: string): Promise<NavigationItem[]> {
    const tenantId = await getTenantId();
    if (!tenantId) return [];

    const client = getTenantClient(tenantId);
    const runQuery = async (localeFilter?: string | null) => {
        let query = client
            .from('menus')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .eq('is_public', true)
            .is('deleted_at', null)
            .or(`location.eq.${location},group_label.eq.${location}`)
            .order('order', { ascending: true });

        if (localeFilter) {
            query = query.eq('locale', localeFilter);
        }

        return query;
    };

    let { data, error } = await runQuery(locale || null);

    if (error && locale && isMissingLocaleColumnError(error.message || '')) {
        ({ data, error } = await runQuery(null));
    } else if ((!data || data.length === 0) && locale && locale !== defaultLocale) {
        ({ data, error } = await runQuery(defaultLocale));
    }

    if (error) {
        console.error('Error fetching menus:', error);
        return [];
    }

    return buildMenuTree(data || []);
}

export async function getSiteData(): Promise<SiteData> {
    const tenantId = await getTenantId();

    const defaultData: SiteData = JSON.parse(JSON.stringify(siteDefault)) as SiteData;

    if (!tenantId) return defaultData;

    // Fetch SEO/Global Settings
    const client = getTenantClient(tenantId);
    const { data: settings } = await client
        .from('settings')
        .select('key, value')
        .eq('tenant_id', tenantId)
        .in('key', ['seo_global', 'site_info', 'contact_info']);

    if (settings) {
        const seo = settings.find(s => s.key === 'seo_global')?.value;
        const siteInfo = settings.find(s => s.key === 'site_info')?.value;
        const contactInfo = settings.find(s => s.key === 'contact_info')?.value;

        const parseSetting = (value: unknown) => {
            if (!value) return null;
            if (typeof value === 'string') {
                try {
                    return JSON.parse(value);
                } catch (e) {
                    console.error('Error parsing settings JSON:', e);
                    return null;
                }
            }
            return value;
        };

        const parsedSeo = parseSetting(seo) as Record<string, any> | null;
        if (parsedSeo) {
            if (parsedSeo.meta_title) defaultData.site.name = parsedSeo.meta_title;
            if (parsedSeo.meta_description) defaultData.site.description = parsedSeo.meta_description;
        }

        const parsedSiteInfo = parseSetting(siteInfo) as Record<string, any> | null;
        if (parsedSiteInfo) {
            if (parsedSiteInfo.site) {
                defaultData.site = { ...defaultData.site, ...parsedSiteInfo.site };
            }
            if (parsedSiteInfo.stats) {
                defaultData.stats = { ...defaultData.stats, ...parsedSiteInfo.stats };
            }
            if (parsedSiteInfo.accreditation) defaultData.accreditation = parsedSiteInfo.accreditation;
            if (parsedSiteInfo.established) defaultData.established = parsedSiteInfo.established;
        }

        const parsedContactInfo = parseSetting(contactInfo) as Record<string, any> | null;
        if (parsedContactInfo) {
            defaultData.contact = { ...defaultData.contact, ...parsedContactInfo };
            defaultData.site = {
                ...defaultData.site,
                address: defaultData.site.address || parsedContactInfo.address,
                phone: defaultData.site.phone || parsedContactInfo.phone,
                email: defaultData.site.email || parsedContactInfo.email,
            };
        }
    }

    return defaultData;
}

export async function getContactPageData(): Promise<ContactData> {
    const tenantId = await getTenantId();
    if (!tenantId) return contactDefault as ContactData;

    const siteData = await getSiteData();
    const defaultData = structuredClone(contactDefault) as ContactData;
    const contact = siteData.contact || {};
    const site = siteData.site || {};
    const socialMedia = site.socialMedia || {};

    defaultData.contactInfo.address = toLocalizedField(contact.address, defaultData.contactInfo.address.id);
    defaultData.contactInfo.phone = contact.phone || defaultData.contactInfo.phone;
    defaultData.contactInfo.email = contact.email || defaultData.contactInfo.email;
    defaultData.contactInfo.website = site.website || defaultData.contactInfo.website;

    defaultData.socialMedia = [
        {
            platform: 'Instagram (Sekolah)',
            url: socialMedia.instagram || 'https://www.instagram.com/sman2_pangkalanbun',
            icon: 'tabler:brand-instagram',
        },
        {
            platform: 'Instagram (OSIS)',
            url: socialMedia.instagramOsis || 'https://www.instagram.com/osis_smandapbun',
            icon: 'tabler:brand-instagram',
        },
        {
            platform: 'YouTube',
            url: socialMedia.youtube || 'https://www.youtube.com/@smandapbun',
            icon: 'tabler:brand-youtube',
        },
    ];

    return defaultData;
}

export async function getProfilePageData(): Promise<ProfileData> {
    const tenantId = await getTenantId();
    if (!tenantId) return profileDefault as unknown as ProfileData;

    const client = getTenantClient(tenantId);
    const { data } = await client
        .from('settings')
        .select('value')
        .eq('tenant_id', tenantId)
        .eq('key', 'page_profile')
        .maybeSingle();

    if (data?.value) {
        try {
            const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
            return { ...profileDefault, ...parsed } as unknown as ProfileData;
        } catch (e) {
            console.error('Error parsing profile page data:', e);
        }
    }

    return profileDefault as unknown as ProfileData;
}

export interface OrganizationPosition {
    position: LocalizedString;
    name: string;
    photo?: string;
    class?: string;
}

export interface OrganizationData {
    schoolOrganization: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        positions: OrganizationPosition[];
    };
    committeeOrganization: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        period: string;
        positions: OrganizationPosition[];
    };
    osisOrganization: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        period: string;
        positions: OrganizationPosition[];
        divisions: LocalizedString[];
    };
    mpkOrganization: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        period: string;
        positions: OrganizationPosition[];
        description: LocalizedString;
    };
}

export async function getOrganizationPageData(): Promise<OrganizationData> {
    const tenantId = await getTenantId();
    if (!tenantId) return organizationDefault as OrganizationData;

    const client = getTenantClient(tenantId);
    const { data } = await client
        .from('settings')
        .select('value')
        .eq('tenant_id', tenantId)
        .eq('key', 'page_organization')
        .maybeSingle();

    if (data?.value) {
        try {
            const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
            return { ...organizationDefault, ...parsed } as OrganizationData;
        } catch (e) {
            console.error('Error parsing organization page data:', e);
        }
    }

    return organizationDefault as OrganizationData;
}


export async function getServicesPageData(): Promise<ServicesData> {
    const tenantId = await getTenantId();
    if (!tenantId) return servicesDefault as ServicesData;

    const client = getTenantClient(tenantId);
    const { data } = await client
        .from('settings')
        .select('value')
        .eq('tenant_id', tenantId)
        .eq('key', 'page_services')
        .maybeSingle();

    if (data?.value) {
        try {
            const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
            return { ...servicesDefault, ...parsed } as ServicesData;
        } catch (e) {
            console.error('Error parsing services page data:', e);
        }
    }
    return servicesDefault as ServicesData;
}

export interface FinanceData {
    financePage: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        description: LocalizedString;
    };
    bos: {
        id: string;
        slug: string;
        category: string;
        tag?: string;
        title: LocalizedString;
        content: LocalizedString;
        reports?: {
            period: string;
            file: string;
        }[];
    };
    apbd: {
        id: string;
        slug: string;
        category: string;
        tag?: string;
        title: LocalizedString;
        content: LocalizedString;
    };
    committee: {
        id: string;
        slug: string;
        category: string;
        tag?: string;
        title: LocalizedString;
        content: LocalizedString;
    };
}

export async function getFinancePageData(): Promise<FinanceData> {
    const tenantId = await getTenantId();
    if (!tenantId) return financeDefault as unknown as FinanceData;

    const client = getTenantClient(tenantId);
    const { data } = await client
        .from('settings')
        .select('value')
        .eq('tenant_id', tenantId)
        .eq('key', 'page_finance')
        .maybeSingle();

    if (data?.value) {
        try {
            const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
            return { ...financeDefault, ...parsed } as unknown as FinanceData;
        } catch (e) {
            console.error('Error parsing finance page data:', e);
        }
    }
    return financeDefault as unknown as FinanceData;
}

export interface StaffData {
    staffPage?: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        description?: LocalizedString;
    };
    teachingStaff: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        description?: LocalizedString;
        staff: {
            name: string;
            role?: string;
            subject?: string;
            photo?: string;
        }[];
    };
    administrativeStaff: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        description?: LocalizedString;
        staff: {
            name: string;
            role?: string;
            photo?: string;
        }[];
    };
}

export async function getStaffPageData(): Promise<StaffData> {
    const tenantId = await getTenantId();
    if (!tenantId) return staffDefault as unknown as StaffData;

    const client = getTenantClient(tenantId);
    const { data } = await client
        .from('settings')
        .select('value')
        .eq('tenant_id', tenantId)
        .eq('key', 'page_staff')
        .maybeSingle();

    if (data?.value) {
        try {
            const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
            return { ...staffDefault, ...parsed } as unknown as StaffData;
        } catch (e) {
            console.error('Error parsing staff page data:', e);
        }
    }
    return staffDefault as unknown as StaffData;
}

export interface Achievement {
    id: string;
    title: LocalizedString;
    description: LocalizedString;
    date: string;
    category: string;
    image?: string;
}

export interface AchievementsData {
    achievementsPage: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        description: LocalizedString;
    };
    achievements: Achievement[];
}

export async function getAchievementsPageData(): Promise<AchievementsData> {
    const tenantId = await getTenantId();
    if (!tenantId) return achievementsDefault as unknown as AchievementsData;

    const client = getTenantClient(tenantId);
    const { data } = await client
        .from('settings')
        .select('value')
        .eq('tenant_id', tenantId)
        .eq('key', 'page_achievements')
        .maybeSingle();

    if (data?.value) {
        try {
            const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
            return { ...achievementsDefault, ...parsed } as unknown as AchievementsData;
        } catch (e) {
            console.error('Error parsing achievements page data:', e);
        }
    }
    return achievementsDefault as unknown as AchievementsData;
}

export interface AlumniData {
    alumniPage: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        description: LocalizedString;
    };
    featuredAlumni: {
        name: string;
        graduationYear: string;
        currentPosition: LocalizedString;
        achievement: LocalizedString;
        photo: string;
    }[];
    alumniStats: {
        totalRegistered: number;
        universities: number;
        workingSector: {
            government: string;
            private: string;
            entrepreneur: string;
            others: string;
        };
    };
    alumniAssociation: {
        name: LocalizedString;
        chairman: string;
        contact: string;
        activities: LocalizedString[];
    };
}

export async function getAlumniPageData(): Promise<AlumniData> {
    const tenantId = await getTenantId();
    if (!tenantId) return alumniDefault as AlumniData;

    const client = getTenantClient(tenantId);
    const { data } = await client
        .from('settings')
        .select('value')
        .eq('tenant_id', tenantId)
        .eq('key', 'page_alumni')
        .maybeSingle();

    if (data?.value) {
        try {
            const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
            return { ...alumniDefault, ...parsed } as AlumniData;
        } catch (e) {
            console.error('Error parsing alumni page data:', e);
        }
    }
    return alumniDefault as AlumniData;
}

export interface SiteImages {
    hero: { main: string; about: string; };
    classroom: string[];
    laboratory: string[];
    library: string[];
    sports: string[];
    blogs: string[];
    gallery: {
        kbm: string[];
        ekskul: string[];
        upacara: string[];
    };
}

export async function getImagesData(): Promise<SiteImages> {
    const tenantId = await getTenantId();
    if (!tenantId) return (imagesDefault as unknown) as SiteImages;

    const client = getTenantClient(tenantId);
    const { data } = await client
        .from('settings')
        .select('value')
        .eq('tenant_id', tenantId)
        .eq('key', 'site_images')
        .maybeSingle();

    if (data?.value) {
        try {
            const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
            // Map legacy news to blogs
            if (parsed.news && !parsed.blogs) {
                parsed.blogs = parsed.news;
            }
            return { ...imagesDefault, ...parsed } as SiteImages;
        } catch (e) {
            console.error('Error parsing site images data:', e);
        }
    }
    return (imagesDefault as unknown) as SiteImages;
}

export interface AgendaData {
    agenda: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        events: {
            date: string;
            title: LocalizedString;
            description: LocalizedString;
        }[];
    };
}

export async function getAgendaData(): Promise<AgendaData> {
    return blogsDefault as unknown as AgendaData;
}

export interface GalleryData {
    gallery: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        albums: {
            title: LocalizedString;
            images: string[];
        }[];
    };
}

export async function getGalleryData(): Promise<GalleryData> {
    return blogsDefault as unknown as GalleryData;
}

export interface SchoolInfoData {
    schoolInfo: {
        id: string;
        slug: string;
        category: string;
        title: LocalizedString;
        content: LocalizedString;
    };
}

export async function getSchoolInfoData(): Promise<SchoolInfoData> {
    const tenantId = await getTenantId();
    if (!tenantId) return blogsDefault as unknown as SchoolInfoData;

    const client = getTenantClient(tenantId);
    const { data } = await client
        .from('settings')
        .select('value')
        .eq('tenant_id', tenantId)
        .eq('key', 'page_school_info')
        .maybeSingle();

    if (data?.value) {
        try {
            const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
            return { ...blogsDefault, ...parsed } as unknown as SchoolInfoData;
        } catch (e) {
            console.error('Error parsing school info data:', e);
        }
    }
    return blogsDefault as unknown as SchoolInfoData;
}

// Update interface
export interface Post {
    id: string;
    title: { id: string; en: string };
    excerpt: { id: string; en: string };
    content: { id: string; en: string };
    slug: string;
    published_at: string;
    featured: boolean;
    image: string;
    category: string;
    author: string;
    tag: string;
}

const toLocalizedField = (value: unknown, fallback = ''): LocalizedString => {
    const parseValue = (input: unknown): unknown => {
        if (typeof input !== 'string') return input;

        const trimmed = input.trim();
        if (!trimmed.startsWith('{')) return input;

        try {
            return JSON.parse(trimmed);
        } catch {
            return input;
        }
    };

    const parsed = parseValue(value);

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const candidate = parsed as Partial<Record<Locale, unknown>>;
        const id = candidate.id;
        const en = candidate.en;

        if (typeof id === 'string' || typeof en === 'string') {
            return {
                id: typeof id === 'string' ? id : typeof en === 'string' ? en : fallback,
                en: typeof en === 'string' ? en : typeof id === 'string' ? id : fallback,
            };
        }
    }

    const stringValue = typeof parsed === 'string' ? parsed : fallback;
    return { id: stringValue, en: stringValue };
};

const normalizePost = (post: any): Post => ({
    id: post.id,
    title: toLocalizedField(post.title_translations ?? post.title_i18n ?? post.title),
    excerpt: toLocalizedField(post.excerpt_translations ?? post.excerpt_i18n ?? post.excerpt),
    content: toLocalizedField(post.content_translations ?? post.content_i18n ?? post.content),
    slug: post.slug,
    published_at: post.published_at ?? post.publishedAt ?? post.created_at ?? new Date().toISOString(),
    featured: Boolean(post.is_featured ?? post.featured),
    image: post.featured_image ?? post.image ?? '',
    category: typeof (post.categories?.name ?? post.category?.name ?? post.category) === 'string'
        ? (post.categories?.name ?? post.category?.name ?? post.category)
        : toLocalizedField(post.categories?.name ?? post.category?.name ?? post.category, 'Umum').id,
    author: post.author_name ?? post.author ?? 'Admin',
    tag: Array.isArray(post.tags) ? post.tags.join(', ') : (post.tags || post.tag || ''),
});

const applyPostTranslation = (
    post: Post,
    translation: ContentTranslationRow | undefined,
    locale?: Locale,
): Post => {
    if (!translation || !locale) return post;

    return {
        ...post,
        title: mergeLocalizedField(post.title, translation.title, locale),
        excerpt: mergeLocalizedField(post.excerpt, translation.excerpt, locale),
        content: mergeLocalizedField(post.content, translation.content, locale),
        slug: translation.slug || post.slug,
    };
};

const getDefaultPosts = (limit: number): Post[] => {
    const fallbackPosts = (blogsDefault as any).blogs || [];
    return fallbackPosts.slice(0, limit).map(normalizePost);
};

export async function getPosts(limit = 6, locale?: Locale): Promise<Post[]> {
    const tenantId = await getTenantId();
    if (!tenantId) return import.meta.env.DEV ? getDefaultPosts(limit) : [];

    const client = getTenantClient(tenantId);
    const runQuery = async (localeFilter?: string | null) => {
        let query = client
            .from('blogs')
            .select('*, categories(name)')
            .eq('tenant_id', tenantId)
            .eq('status', 'published')
            .is('deleted_at', null)
            .order('published_at', { ascending: false })
            .limit(limit);

        if (localeFilter) {
            query = query.eq('locale', localeFilter);
        }

        return query;
    };

    let { data, error } = await runQuery(locale || null);

    if (locale && ((data && data.length === 0) || (error && isMissingLocaleColumnError(error.message || '')))) {
        ({ data, error } = await runQuery(null));
    }

    if (error) {
        console.error('Error fetching posts:', error);
        return import.meta.env.DEV ? getDefaultPosts(limit) : [];
    }

    if (!data || data.length === 0) {
        return [];
    }

    const normalizedPosts = data.map(normalizePost);
    const translations = await getContentTranslations(
        client,
        tenantId,
        ['article', 'blog'],
        locale,
        normalizedPosts.map((post) => post.id),
    );

    return normalizedPosts.map((post) => applyPostTranslation(post, translations.get(post.id), locale));
}
