/**
 * Legacy compatibility export surface.
 *
 * The concrete shared admin shell implementation still lives under this path,
 * while the preferred consumer import path is `@/templates/emdash-admin`.
 * Keep this module stable for backward compatibility until the implementation
 * files are physically moved to avoid circular re-export chains.
 * @module flowbite-admin
 */

export * from '@/templates/emdash-admin';
