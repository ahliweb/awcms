
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { getPluginComponent } from '@/lib/pluginRegistry';
import { Helmet } from 'react-helmet-async';
import { useLocation, useNavigate } from 'react-router-dom';

// Core Components
import Sidebar from '@/components/dashboard/Sidebar';
import Header from '@/components/dashboard/Header';

// Dashboard Modules
import AdminDashboard from '@/components/dashboard/AdminDashboard';
import BlogsManager from '@/components/dashboard/BlogsManager';
import PagesManager from '@/components/dashboard/PagesManager';
import ProductsManager from '@/components/dashboard/ProductsManager';
import ProductTypesManager from '@/components/dashboard/ProductTypesManager';
import PortfolioManager from '@/components/dashboard/PortfolioManager';
import AnnouncementsManager from '@/components/dashboard/AnnouncementsManager';
import PromotionsManager from '@/components/dashboard/PromotionsManager';
import TestimonyManager from '@/components/dashboard/TestimonyManager';
import PhotoGalleryManager from '@/components/dashboard/PhotoGalleryManager';
import VideoGalleryManager from '@/components/dashboard/VideoGalleryManager';
import ContactsManager from '@/components/dashboard/ContactsManager';
import ContactMessagesManager from '@/components/dashboard/ContactMessagesManager';
import UsersManager from '@/components/dashboard/UsersManager';
import RolesManager from '@/components/dashboard/RolesManager';
import PermissionsManager from '@/components/dashboard/PermissionsManager';
import CategoriesManager from '@/components/dashboard/CategoriesManager';
import TagsManager from '@/components/dashboard/TagsManager';
import MenusManager from '@/components/dashboard/MenusManager';
import UserProfile from '@/components/dashboard/UserProfile';
import SeoManager from '@/components/dashboard/SeoManager';
import ExtensionsManager from '@/components/dashboard/ExtensionsManager';
import LanguageSettings from '@/components/dashboard/LanguageSettings';
import SSOManager from '@/components/dashboard/SSOManager';
import ThemesManager from '@/components/dashboard/ThemesManager';
import FilesManager from '@/components/dashboard/FilesManager';
import SidebarMenuManager from '@/components/dashboard/SidebarMenuManager';
import NotificationsManager from '@/components/dashboard/notifications/NotificationsManager';
import NotificationDetail from '@/components/dashboard/notifications/NotificationDetail';

function Dashboard() {
  const { t } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [extensionRoutes, setExtensionRoutes] = useState({});
  const location = useLocation();
  const navigate = useNavigate();

  // Determine current "page" from URL path
  // /cmspanel/notifications -> page = notifications
  // /cmspanel/notifications/123 -> page = notifications, sub = 123 (handled via match logic below)

  const pathParts = location.pathname.split('/');
  // pathParts[0] = ""
  // pathParts[1] = "cmspanel"
  // pathParts[2] = page
  // pathParts[3] = id (optional)
  const currentPage = pathParts[2] || 'home';
  const subParam = pathParts[3];

  // Fetch dynamic routes from extensions
  useEffect(() => {
    const fetchExtensionRoutes = async () => {
      try {
        const { data } = await supabase
          .from('extension_routes_registry')
          .select('path, component_key')
          .eq('is_active', true)
          .is('deleted_at', null);

        if (data) {
          const routes = {};
          data.forEach(route => {
            routes[route.path] = route.component_key;
          });
          setExtensionRoutes(routes);
        }
      } catch (e) {
        console.error("Error fetching extension routes", e);
      }
    };
    fetchExtensionRoutes();
  }, []);

  const renderContent = () => {
    // 1. Check Core Routes
    switch (currentPage) {
      case 'home': return <AdminDashboard />;
      case 'files': return <FilesManager />;
      case 'blogs': return <BlogsManager />;
      case 'pages': return <PagesManager />;
      case 'themes': return <ThemesManager />;
      case 'products': return <ProductsManager />;
      case 'product-types': return <ProductTypesManager />;
      case 'portfolio': return <PortfolioManager />;
      case 'announcements': return <AnnouncementsManager />;
      case 'promotions': return <PromotionsManager />;
      case 'testimonies': return <TestimonyManager />;
      case 'photo-gallery': return <PhotoGalleryManager />;
      case 'video-gallery': return <VideoGalleryManager />;
      case 'contacts': return <ContactsManager />;
      case 'contact-messages': return <ContactMessagesManager />;
      case 'menus': return <MenusManager />;
      case 'categories': return <CategoriesManager />;
      case 'tags': return <TagsManager />;
      case 'users': return <UsersManager />;
      case 'roles': return <RolesManager />;
      case 'permissions': return <PermissionsManager />;
      case 'extensions': return <ExtensionsManager />;
      case 'seo': return <SeoManager />;
      case 'sso': return <SSOManager />;
      case 'language-settings': return <LanguageSettings />;
      case 'profile': return <UserProfile />;
      case 'admin-navigation': return <SidebarMenuManager />;
      case 'notifications':
        if (subParam) return <NotificationDetail id={subParam} />;
        return <NotificationsManager />;

      // 2. Check Plugin Routes
      default:
        if (extensionRoutes[currentPage]) {
          const Component = getPluginComponent(extensionRoutes[currentPage]);
          return <Component />;
        }
        return <AdminDashboard />;
    }
  };

  return (
    <>
      <Helmet>
        <title>{t('dashboard_page.title')}</title>
        <meta name="description" content={t('dashboard_page.meta_description')} />
        <meta http-equiv="X-Content-Type-Options" content="nosniff" />
        <meta http-equiv="X-Frame-Options" content="SAMEORIGIN" />
      </Helmet>
      <div className="flex h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white overflow-hidden font-sans">
        <Sidebar
          isOpen={sidebarOpen}
          setIsOpen={setSidebarOpen}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          <Header
            toggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            onNavigate={(page) => navigate(`/cmspanel/${page}`)}
          />

          <main className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-900">
            <motion.div
              key={location.pathname} // Changed key to full pathname to trigger animation on sub-route changes
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="h-full flex flex-col"
            >
              {renderContent()}
            </motion.div>
          </main>
        </div>
      </div>
    </>
  );
}

export default Dashboard;
