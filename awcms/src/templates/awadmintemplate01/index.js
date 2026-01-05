/**
 * awadmintemplate01 - Unified Admin UI Template for AWCMS
 * 
 * This template provides standardized layout components for all admin modules,
 * ensuring consistent UX, ABAC integration, and tenant-aware displays.
 * 
 * @module awadmintemplate01
 */

// Layout Components
export { default as AdminPageLayout } from './AdminPageLayout';
export { default as PageHeader } from './PageHeader';
export { default as PageTabs, TabsContent } from './PageTabs';

// Data Display Components
export { default as DataTable } from './DataTable';
export { default as EmptyState } from './EmptyState';
export { default as LoadingSkeleton } from './LoadingSkeleton';

// Form Components
export { default as FormWrapper } from './FormWrapper';

// Access Control Components
export { default as NotAuthorized } from './NotAuthorized';

// Tenant Components
export { default as TenantBadge } from './TenantBadge';

// Template Version
export const TEMPLATE_VERSION = '1.0.0';
export const TEMPLATE_NAME = 'awadmintemplate01';
