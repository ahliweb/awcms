/**
 * Preferred EmDash admin export surface.
 *
 * This module owns the concrete shared admin shell implementation.
 */

export { default as AdminPageLayout } from './layouts/AdminPageLayout';
export { default as PageHeader } from './components/PageHeader';
export { default as Sidebar } from './components/Sidebar';
export { default as Footer } from './components/Footer';
export { PageTabs, TabsList, TabsTrigger, TabsContent } from './components/PageTabs';

export const TEMPLATE_VERSION = '2.0.0';
export const TEMPLATE_NAME = 'emdash-admin-react';
