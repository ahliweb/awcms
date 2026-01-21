
import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import TenantGuard from '@/components/auth/TenantGuard';
import LoginPage from '@/pages/cmspanel/LoginPage';
import ForgotPasswordPage from '@/pages/cmspanel/ForgotPasswordPage';
import UpdatePasswordPage from '@/pages/cmspanel/UpdatePasswordPage';

// Plugin Dynamic Routes
import { usePluginRoutes } from '@/components/routing/PluginRoutes';
import ExtensionErrorBoundary from '@/components/ui/ExtensionErrorBoundary';

import PublicRegisterPage from '@/pages/public/PublicRegisterPage';
// Public Pages (Removed - Moved to awcms-public)
// import PublicPageResolver from '@/components/public/PublicPageResolver'; 
// import PublicLayout from '@/components/public/PublicLayout';


// Admin Layout
const AdminLayout = lazy(() => import('@/components/dashboard/AdminLayout'));

// Admin Pages (Lazy Loaded)
const DashboardHome = lazy(() => import('@/components/dashboard/DashboardHome'));
const BlogsManager = lazy(() => import('@/components/dashboard/BlogsManager'));
const BlogEditor = lazy(() => import('@/components/dashboard/BlogEditor'));
const PagesManager = lazy(() => import('@/components/dashboard/PagesManager'));
const VisualPagesManager = lazy(() => import('@/components/dashboard/VisualPagesManager'));
const VisualPageBuilder = lazy(() => import('@/components/visual-builder/VisualPageBuilder'));
const PageEditor = lazy(() => import('@/components/dashboard/PageEditor'));
const CategoriesManager = lazy(() => import('@/components/dashboard/CategoriesManager'));
const TagsManager = lazy(() => import('@/components/dashboard/TagsManager'));
const FilesManager = lazy(() => import('@/components/dashboard/FilesManager'));
const UsersManager = lazy(() => import('@/components/dashboard/UsersManager'));
const UserProfile = lazy(() => import('@/components/dashboard/UserProfile'));
const RolesManager = lazy(() => import('@/components/dashboard/RolesManager'));
const RoleEditor = lazy(() => import('@/components/dashboard/RoleEditor'));
const PermissionsManager = lazy(() => import('@/components/dashboard/PermissionsManager'));
const PolicyManager = lazy(() => import('@/components/dashboard/PolicyManager'));
const MenusManager = lazy(() => import('@/components/dashboard/MenusManager'));
const ProductsManager = lazy(() => import('@/components/dashboard/ProductsManager'));
const OrdersManager = lazy(() => import('@/components/dashboard/OrdersManager'));
const ProductTypesManager = lazy(() => import('@/components/dashboard/ProductTypesManager'));
const PromotionsManager = lazy(() => import('@/components/dashboard/PromotionsManager'));
const PortfolioManager = lazy(() => import('@/components/dashboard/PortfolioManager'));
const ServicesManager = lazy(() => import('@/components/dashboard/ServicesManager'));
const TeamManager = lazy(() => import('@/components/dashboard/TeamManager'));
const PartnersManager = lazy(() => import('@/components/dashboard/PartnersManager'));
const FunFactsManager = lazy(() => import('@/components/dashboard/FunFactsManager'));
const TestimonyManager = lazy(() => import('@/components/dashboard/TestimonyManager'));
const PhotoGalleryManager = lazy(() => import('@/components/dashboard/PhotoGalleryManager'));
const VideoGalleryManager = lazy(() => import('@/components/dashboard/VideoGalleryManager'));
const AnnouncementsManager = lazy(() => import('@/components/dashboard/AnnouncementsManager'));
const ContactMessagesManager = lazy(() => import('@/components/dashboard/ContactMessagesManager'));
const ContactsManager = lazy(() => import('@/components/dashboard/ContactsManager'));
const ThemesManager = lazy(() => import('@/components/dashboard/ThemesManager'));
const TemplatesManager = lazy(() => import('@/components/dashboard/TemplatesManager'));
const TemplateEditor = lazy(() => import('@/components/dashboard/templates/TemplateEditor'));
const TemplatePartEditor = lazy(() => import('@/components/dashboard/templates/TemplatePartEditor'));
const WidgetsManager = lazy(() => import('@/components/dashboard/widgets/WidgetsManager'));
const ThemeEditor = lazy(() => import('@/components/dashboard/ThemeEditor'));
const SeoManager = lazy(() => import('@/components/dashboard/SeoManager'));
const ExtensionsManager = lazy(() => import('@/components/dashboard/ExtensionsManager'));
const ExtensionMarketplace = lazy(() => import('@/components/dashboard/ExtensionMarketplace'));
const ExtensionSettings = lazy(() => import('@/components/dashboard/ExtensionSettings'));
const LanguageSettings = lazy(() => import('@/components/dashboard/LanguageSettings'));
const NotificationsManager = lazy(() => import('@/components/dashboard/notifications/NotificationsManager'));
const NotificationDetail = lazy(() => import('@/components/dashboard/notifications/NotificationDetail'));
const SSOManager = lazy(() => import('@/components/dashboard/SSOManager'));
const ExtensionLogs = lazy(() => import('@/components/dashboard/ExtensionLogs'));
const SidebarMenuManager = lazy(() => import('@/components/dashboard/SidebarMenuManager'));
const ModulesManager = lazy(() => import('@/pages/cmspanel/ModulesManager'));

const SettingsManager = lazy(() => import('@/components/dashboard/SettingsManager'));
const AuditLogsManager = lazy(() => import('@/components/dashboard/AuditLogsManager'));
const TenantsManager = lazy(() => import('@/components/dashboard/TenantsManager'));
const TenantSettings = lazy(() => import('@/components/dashboard/TenantSettings'));

// ESP32 IoT (Lazy Loaded)
const DevicesManager = lazy(() => import('@/pages/cmspanel/DevicesManager'));
const DeviceDetail = lazy(() => import('@/pages/cmspanel/DeviceDetail'));

// Mobile Admin (Lazy Loaded)
const MobileUsersManager = lazy(() => import('@/pages/cmspanel/MobileUsersManager'));
const PushNotificationsManager = lazy(() => import('@/pages/cmspanel/PushNotificationsManager'));
const MobileAppConfig = lazy(() => import('@/pages/cmspanel/MobileAppConfig'));


// Loading Screen
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[calc(100vh-200px)]">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
  </div>
);

const ProtectedRoute = ({ children }) => {
  const { session, loading, twoFactorEnabled } = useAuth();
  // We need to check sessionStorage strictly here inside the component body
  // because hooks/utils might cache values, but reading directly is safe in render for this.
  const is2FAVerified = sessionStorage.getItem('awcms_2fa_verified') === 'true';

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!session) {
    // Redirect to the unified login route
    return <Navigate to="/login" replace />;
  }

  // Security Check: If 2FA is enabled but not verified, force back to login
  if (twoFactorEnabled && !is2FAVerified) {
    // We can redirect to login. The LoginPage will see the session, check 2FA again, and show the prompt.
    // This effectively "loops" them back to the 2FA prompt if they try to bypass it.
    return <Navigate to="/login" replace />;
  }

  return children;
};


const MainRouter = () => {
  const { routes: pluginRoutes } = usePluginRoutes();

  return (
    <BrowserRouter>
      <Routes>
        {/* Auth Routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<PublicRegisterPage />} />
        {/* Alias for cmspanel login to avoid confusion if user manually types it */}
        <Route path="/cmspanel/login" element={<Navigate to="/login" replace />} />

        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/cmspanel/update-password" element={<UpdatePasswordPage />} />

        {/* Public Routes */}
        {/* Public Routes - DEPRECATED/REMOVED */}
        {/* All public traffic is handled by awcms-public (Astro) */}
        {/* Redirect root to login */}
        <Route path="/" element={<Navigate to="/login" replace />} />


        {/* CMS Panel Routes */}
        <Route
          path="/cmspanel"
          element={
            <ProtectedRoute>
              <TenantGuard>
                <Suspense fallback={<PageLoader />}>
                  <AdminLayout />
                </Suspense>
              </TenantGuard>
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardHome />} />
          <Route path="blogs" element={<BlogsManager />} />
          <Route path="blogs/new" element={<BlogEditor />} />
          <Route path="blogs/edit/:id" element={<BlogEditor />} />

          <Route path="pages" element={<PagesManager />} />
          <Route path="pages/new" element={<PageEditor />} />
          <Route path="pages/edit/:id" element={<PageEditor />} />
          <Route path="visual-pages" element={<VisualPagesManager />} />

          <Route path="categories" element={<CategoriesManager />} />
          <Route path="tags" element={<TagsManager />} />
          <Route path="media" element={<FilesManager />} />
          <Route path="files" element={<FilesManager />} />

          <Route path="users" element={<UsersManager />} />
          <Route path="profile" element={<UserProfile />} />

          <Route path="roles" element={<RolesManager />} />
          <Route path="roles/new" element={<RoleEditor />} />
          <Route path="roles/edit/:id" element={<RoleEditor />} />
          <Route path="roles/edit/:id" element={<RoleEditor />} />
          <Route path="permissions" element={<PermissionsManager />} />
          <Route path="policies" element={<PolicyManager />} />

          <Route path="menus" element={<MenusManager />} />
          <Route path="products" element={<ProductsManager />} />
          <Route path="product-types" element={<ProductTypesManager />} />
          <Route path="orders" element={<OrdersManager />} />

          <Route path="promotions" element={<PromotionsManager />} />
          <Route path="portfolio" element={<PortfolioManager />} />
          <Route path="services" element={<ServicesManager />} />
          <Route path="team" element={<TeamManager />} />
          <Route path="partners" element={<PartnersManager />} />
          <Route path="funfacts" element={<FunFactsManager />} />
          <Route path="testimonies" element={<TestimonyManager />} />

          <Route path="gallery/photos" element={<PhotoGalleryManager />} />
          <Route path="gallery/videos" element={<VideoGalleryManager />} />
          <Route path="photo-gallery" element={<PhotoGalleryManager />} />
          <Route path="video-gallery" element={<VideoGalleryManager />} />

          <Route path="announcements" element={<AnnouncementsManager />} />

          <Route path="contacts" element={<ContactsManager />} />
          <Route path="messages" element={<ContactMessagesManager />} />
          <Route path="inbox" element={<ContactMessagesManager />} />
          <Route path="contact-messages" element={<ContactMessagesManager />} />

          <Route path="themes" element={<ThemesManager />} />
          <Route path="templates" element={<TemplatesManager />} />
          <Route path="templates/edit/:id" element={<TemplateEditor />} />
          <Route path="templates/parts/edit/:id" element={<TemplatePartEditor />} />
          <Route path="widgets" element={<WidgetsManager />} />
          <Route path="themes/edit/:id" element={<ThemeEditor />} />

          <Route path="seo" element={<SeoManager />} />
          <Route path="seo-manager" element={<SeoManager />} />

          <Route path="extensions" element={<ExtensionsManager />} />
          <Route path="extensions/marketplace" element={<ExtensionMarketplace />} />
          <Route path="extensions/settings/:id" element={<ExtensionSettings />} />
          <Route path="extensions/logs" element={<ExtensionLogs />} />

          <Route path="settings/general" element={<SettingsManager />} />
          <Route path="settings/branding" element={<TenantSettings />} />
          <Route path="logs" element={<AuditLogsManager />} />
          <Route path="audit-logs" element={<AuditLogsManager />} />
          <Route path="settings/language" element={<LanguageSettings />} />
          <Route path="settings/sso" element={<SSOManager />} />
          <Route path="languages" element={<LanguageSettings />} />
          <Route path="language-settings" element={<LanguageSettings />} />
          <Route path="sso" element={<SSOManager />} />


          <Route path="admin-navigation" element={<SidebarMenuManager />} />
          <Route path="modules" element={<ModulesManager />} />
          <Route path="tenants" element={<TenantsManager />} />

          <Route path="notifications" element={<NotificationsManager />} />
          <Route path="notifications/:id" element={<NotificationDetail />} />


          <Route path="visual-editor" element={<VisualPageBuilder />} />


          {/* Email/Mailketing Plugin */}
          {/* Plugin Routes */}
          {pluginRoutes.map((route) => {
            const Element = route.element;
            return (
              <Route
                key={route.path}
                path={route.path}
                element={
                  <ExtensionErrorBoundary extensionName={`Route: ${route.path}`}>
                    {route.lazy ? (
                      <Suspense fallback={<PageLoader />}>
                        <Element />
                      </Suspense>
                    ) : (
                      <Element />
                    )}
                  </ExtensionErrorBoundary>
                }
              />
            );
          })}

          {/* ESP32 IoT Devices */}
          <Route path="devices" element={<DevicesManager />} />
          <Route path="devices/:id" element={<DeviceDetail />} />

          {/* Mobile Admin */}
          <Route path="mobile/users" element={<MobileUsersManager />} />
          <Route path="mobile/push" element={<PushNotificationsManager />} />
          <Route path="mobile/config" element={<MobileAppConfig />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default MainRouter;
