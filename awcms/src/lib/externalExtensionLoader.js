/**
 * External Extension Loader
 * 
 * Handles dynamic loading of external extensions from awcms-ext-* folders.
 * External extensions are loaded via dynamic import for lazy loading.
 */

import React from 'react';
import { isManifestCompatible, validateExtensionManifest } from '@/lib/extensionManifest';

// Cache for loaded external extensions
const loadedExtensions = new Map();

/**
 * Validate external extension manifest
 * @param {Object} manifest - Extension manifest
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export const validateManifest = (manifest) => {
    return validateExtensionManifest(manifest, { allowLegacy: true });
};

/**
 * Get the base path for external extensions
 * @returns {string} Base path
 */
export const getExternalExtensionBasePath = () => {
    // In development, extensions might be in parent folder
    // In production, they could be served from a CDN or static path
    return import.meta.env.VITE_EXTERNAL_EXTENSIONS_PATH || '/ext';
};

/**
 * Build the full path to an external extension
 * @param {Object} manifest - Extension manifest
 * @returns {string} Full path to extension entry
 */
export const getExtensionPath = (manifest) => {
    const basePath = getExternalExtensionBasePath();
    const folderName = `awcms-ext-${manifest.vendor}-${manifest.slug}`;
    const entryPath = manifest.resources?.admin?.entry || manifest.entry || 'dist/index.js';
    return `${basePath}/${folderName}/${entryPath}`;
};

/**
 * Load an external extension dynamically
 * @param {Object} manifest - Extension manifest from database
 * @param {string} tenantId - Tenant ID for multi-tenant context
 * @returns {Promise<Object>} Loaded extension module
 */
export const loadExternalExtension = async (manifest, tenantId = null) => {
    const cacheKey = `${manifest.vendor}-${manifest.slug}`;

    // Return cached if available
    if (loadedExtensions.has(cacheKey)) {
        return loadedExtensions.get(cacheKey);
    }

    try {
        // Validate manifest first
        const validation = validateManifest(manifest);
        if (!validation.valid) {
            throw new Error(`Invalid manifest: ${validation.errors.join(', ')}`);
        }

        const normalizedManifest = validation.manifest;

        if (!isManifestCompatible(normalizedManifest)) {
            throw new Error(`Extension ${normalizedManifest.name} is not compatible with this AWCMS version`);
        }

        // Build path
        const extensionPath = manifest.external_path || getExtensionPath(normalizedManifest);

        // Dynamic import
        // Note: Vite requires @vite-ignore for dynamic imports with variables
        const module = await import(/* @vite-ignore */ extensionPath);

        // Validate module exports
        if (!module.default && !module.register) {
            throw new Error('Extension must export a default component or register function');
        }

        // Cache the loaded module with tenant context
        const extensionModule = {
            ...module,
            manifest: normalizedManifest,
            tenantId,
            loaded: true,
            loadedAt: new Date().toISOString()
        };

        loadedExtensions.set(cacheKey, extensionModule);
            console.log(`[External Extension] Loaded: ${normalizedManifest.name} v${normalizedManifest.version}`);

        return extensionModule;
    } catch (error) {
            console.error(`[External Extension] Failed to load ${manifest?.name || 'unknown extension'}:`, error);

        // Return error placeholder
        return {
            default: () => React.createElement('div', {
                className: 'p-4 border border-red-300 bg-red-50 rounded-lg text-red-700'
            }, [
                React.createElement('h3', { key: 'title', className: 'font-semibold' },
                    `Failed to load extension: ${manifest?.name || 'Unknown extension'}`
                ),
                React.createElement('p', { key: 'error', className: 'text-sm mt-1' },
                    error.message
                )
            ]),
            manifest,
            loaded: false,
            error: error.message
        };
    }
};

/**
 * Unload an external extension from cache
 * @param {string} vendor - Extension vendor
 * @param {string} slug - Extension slug
 */
