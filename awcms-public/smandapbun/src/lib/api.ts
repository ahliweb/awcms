import { supabase } from './supabase';
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


const TENANT_SLUG = 'smandapbun';

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
        name: string;
        tagline: string;
        description: string;
        logo?: string;
        favicon?: string;
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

export async function getTenantId() {
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

export async function getSiteData(): Promise<SiteData> {
    const tenantId = await getTenantId();

    // Default fallback data
    const defaultData: SiteData = {
        site: {
            name: 'SMAN 2 Pangkalan Bun',
            tagline: 'Beriman, Cerdas, Berprestasi (BERDASI)',
            description: 'Sekolah Menengah Atas Negeri 2 Pangkalan Bun',
            favicon: '/favicon.png',
        },
        contact: {
            address: 'Jl. Pasanah No. 15, RT 24, Sidorejo, Arut Selatan, Kotawaringin Barat, Kalimantan Tengah, 74111',
            phone: '(0532) 123456',
            email: 'info@sman2pbun.sch.id',
        },
        stats: {
            students: 1200,
            teachers: 75,
            staff: 25,
            extracurriculars: 18,
            alumni: 8500,
            achievements: 100,
        },
        accreditation: 'A',
        established: '1984',
    };

    if (!tenantId) return defaultData;

    // Fetch SEO/Global Settings
    const { data: settings } = await supabase
        .from('settings')
        .select('key, value')
        .eq('tenant_id', tenantId)
        .in('key', ['seo_global', 'site_info', 'contact_info']);

    if (settings) {
        const seo = settings.find(s => s.key === 'seo_global')?.value;
        // const siteInfo = settings.find(s => s.key === 'site_info')?.value; // Potential future use

        if (seo) {
            // Parse if it's a JSON string, or use directly if it's already an object (Supabase client handles JSONB)
            const parsedSeo = typeof seo === 'string' ? JSON.parse(seo) : seo;
            if (parsedSeo.meta_title) defaultData.site.name = parsedSeo.meta_title;
            if (parsedSeo.meta_description) defaultData.site.description = parsedSeo.meta_description;
        }
    }

    return defaultData;
}

export async function getContactPageData(): Promise<ContactData> {
    const tenantId = await getTenantId();
    if (!tenantId) return contactDefault as ContactData;

    const { data } = await supabase
        .from('settings')
        .select('value')
        .eq('tenant_id', tenantId)
        .eq('key', 'page_contact')
        .maybeSingle();

    if (data?.value) {
        try {
            const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
            // Merge with default to ensure all fields exist
            return { ...contactDefault, ...parsed } as ContactData;
        } catch (e) {
            console.error('Error parsing contact page data:', e);
        }
    }

    return contactDefault as ContactData;
}

export async function getProfilePageData(): Promise<ProfileData> {
    const tenantId = await getTenantId();
    if (!tenantId) return profileDefault as unknown as ProfileData;

    const { data } = await supabase
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

    const { data } = await supabase
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

    const { data } = await supabase
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

    const { data } = await supabase
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

    const { data } = await supabase
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

    const { data } = await supabase
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

    const { data } = await supabase
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

    const { data } = await supabase
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
    const tenantId = await getTenantId();
    if (!tenantId) return blogsDefault as unknown as AgendaData;

    const { data } = await supabase
        .from('settings')
        .select('value')
        .eq('tenant_id', tenantId)
        .eq('key', 'page_agenda')
        .maybeSingle();

    if (data?.value) {
        try {
            const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
            return { ...blogsDefault, ...parsed } as unknown as AgendaData;
        } catch (e) {
            console.error('Error parsing agenda data:', e);
        }
    }
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
    const tenantId = await getTenantId();
    if (!tenantId) return blogsDefault as unknown as GalleryData;

    const { data } = await supabase
        .from('settings')
        .select('value')
        .eq('tenant_id', tenantId)
        .eq('key', 'page_gallery')
        .maybeSingle();

    if (data?.value) {
        try {
            const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
            return { ...blogsDefault, ...parsed } as unknown as GalleryData;
        } catch (e) {
            console.error('Error parsing gallery data:', e);
        }
    }
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

    const { data } = await supabase
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

export async function getPosts(limit = 6): Promise<Post[]> {
    const tenantId = await getTenantId();
    if (!tenantId) return [];

    const { data, error } = await supabase
        .from('blogs')
        .select('*, categories(name)') // Join categories
        .eq('tenant_id', tenantId)
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('Error fetching posts:', error);
        return [];
    }

    return data.map(post => ({
        id: post.id,
        title: { id: post.title, en: post.title },
        excerpt: { id: post.excerpt || '', en: post.excerpt || '' },
        content: { id: post.content || '', en: post.content || '' },
        slug: post.slug,
        published_at: post.published_at,
        featured: post.is_featured,
        image: post.featured_image,
        category: post.categories?.name || 'Umum', // Handle join result
        author: 'Admin', // Placeholder for now
        tag: Array.isArray(post.tags) ? post.tags.join(', ') : (post.tags || ''),
    }));
}
