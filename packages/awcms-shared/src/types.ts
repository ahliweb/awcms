/**
 * Shared type definitions used across all AWCMS public portals.
 */

/** Localized string with Indonesian (id) and English (en) variants */
export interface LocalizedString {
    id: string;
    en: string;
}

/** Localized string array */
export interface LocalizedStringArray {
    id: string[];
    en: string[];
}

/** Navigation menu item from admin panel */
export interface NavigationItem {
    id: string;
    title: LocalizedString;
    url: string;
    icon?: string;
    children?: NavigationItem[];
    sort_order: number;
    is_visible: boolean;
}

/** Tenant configuration stored in tenants.config */
export interface TenantConfig {
    theme?: {
        brandColor?: string;
        fontFamily?: string;
        logoUrl?: string;
    };
    settings?: {
        siteName?: string;
        [key: string]: unknown;
    };
}

/** Portal site entry for multi-portal management */
export interface PortalSite {
    name: string;
    url: string;
}

/**
 * Get the localized value from a LocalizedString or plain string.
 * Falls back to Indonesian if the specified locale is not available.
 */
export function getLocalizedValue(
    value: LocalizedString | string | null | undefined,
    locale: string = 'id',
): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    return value[locale as keyof LocalizedString] || value.id || value.en || '';
}
