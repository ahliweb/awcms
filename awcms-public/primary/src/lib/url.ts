/**
 * Tenant-Aware URL Builder
 * 
 * Centralizes all URL generation to ensure tenant prefix is always included.
 * This prevents hardcoded links and ensures consistency across the application.
 */

/**
 * Build a tenant-scoped URL path.
 * 
 * @param tenantSlug - The tenant's slug (e.g., "primary", "tenant-a"). Empty string = host-based URL.
 * @param path - The page path (e.g., "/", "/articles", "/pages/about")
 * @returns Full path with tenant prefix (e.g., "/primary/articles")
 */
export function tenantUrl(tenantSlug: string, path: string = '/'): string {
    // Normalize path
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    // Host-based URLs should not include a tenant prefix
    if (!tenantSlug || tenantSlug.trim() === '') {
        return normalizedPath;
    }

    // Handle root path
    if (normalizedPath === '/') {
        return `/${tenantSlug}/`;
    }

    // Build full path
    return `/${tenantSlug}${normalizedPath}`;
}

/**
 * Build an absolute URL with tenant prefix.
 * 
 * @param baseUrl - The base URL (e.g., "https://example.com")
 * @param tenantSlug - The tenant's slug
 * @param path - The page path
 * @returns Absolute URL with tenant prefix
 */
export function absoluteTenantUrl(baseUrl: string, tenantSlug: string, path: string = '/'): string {
    const relativePath = tenantUrl(tenantSlug, path);
    // Ensure no double slashes
    const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${cleanBase}${relativePath}`;
}

/**
 * Check if a given path already contains a valid tenant prefix.
 * Used to prevent redirect loops.
 * 
 * @param pathname - The URL pathname
 * @param tenantSlug - The tenant slug to check for
 * @returns True if path already starts with /{tenantSlug}/
 */
export function hasValidTenantPrefix(pathname: string, tenantSlug: string): boolean {
    if (!tenantSlug || tenantSlug.trim() === '') {
        return false;
    }
    const pattern = new RegExp(`^/${tenantSlug}(/|$)`);
    return pattern.test(pathname);
}

/**
 * Extract tenant slug from pathname.
 * 
 * @param pathname - The URL pathname (e.g., "/primary/articles")
 * @returns The tenant slug or null if not found
 */
export function extractTenantFromPath(pathname: string): string | null {
    // Remove leading slash and split
    const segments = pathname.replace(/^\//, '').split('/');

    // First segment should be tenant slug (if present and not empty)
    if (segments.length > 0 && segments[0].trim() !== '') {
        return segments[0];
    }

    return null;
}

/**
 * Extract the remaining path after tenant segment.
 * 
 * @param pathname - The URL pathname (e.g., "/primary/articles/my-post")
 * @returns The path without tenant prefix (e.g., "/articles/my-post")
 */
export function extractPathAfterTenant(pathname: string): string {
    const segments = pathname.replace(/^\//, '').split('/');

    // Remove first segment (tenant) and rebuild
    if (segments.length > 1) {
        return '/' + segments.slice(1).join('/');
    }

    return '/';
}
