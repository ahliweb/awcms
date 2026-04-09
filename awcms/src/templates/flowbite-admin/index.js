/**
 * Legacy compatibility export surface.
 *
 * The concrete shared admin shell implementation still lives under this path,
 * while the preferred consumer import path is `@/templates/emdash-admin`.
 * Keep this module stable for backward compatibility until the implementation
 * files are physically moved to avoid circular re-export chains.
 * @module flowbite-admin
 */

// Layout Components (New)
export { default as AdminPageLayout } from './layouts/AdminPageLayout';
export { default as PageHeader } from './components/PageHeader';
// export { default as Navbar } from './components/Navbar'; // Removed

export { default as Sidebar } from './components/Sidebar';
export { default as Footer } from './components/Footer';

// Data Display Components (Legacy/Shared)
// Restored PageTabs - still actively used by BlogsManager, PagesManager, UsersManager, TemplatesManager
export { PageTabs, TabsList, TabsTrigger, TabsContent } from './components/PageTabs';
// The following legacy components were removed (not used anywhere):
// DataTable, EmptyState, LoadingSkeleton, TenantBadge, FormWrapper, NotAuthorized

// Form Components (Legacy/Shared) - REMOVED
// export { default as FormWrapper } from './components/legacy/FormWrapper';

// Access Control Components (Legacy/Shared) - REMOVED
// export { default as NotAuthorized } from './components/legacy/NotAuthorized';

export const TEMPLATE_VERSION = '2.0.0';
export const TEMPLATE_NAME = 'emdash-admin-react';
