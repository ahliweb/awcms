
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import Sidebar from '@/components/dashboard/Sidebar';
import Header from '@/components/dashboard/Header';
import DashboardHome from '@/components/dashboard/DashboardHome';
import BlogsManager from '@/components/dashboard/BlogsManager';
import PagesManager from '@/components/dashboard/PagesManager';
import ProductsManager from '@/components/dashboard/ProductsManager';
import PortfolioManager from '@/components/dashboard/PortfolioManager';
import AnnouncementsManager from '@/components/dashboard/AnnouncementsManager';
import PromotionsManager from '@/components/dashboard/PromotionsManager';
import PhotoGalleryManager from '@/components/dashboard/PhotoGalleryManager';
import VideoGalleryManager from '@/components/dashboard/VideoGalleryManager';
import UsersManager from '@/components/dashboard/UsersManager';
import RolesManager from '@/components/dashboard/RolesManager';
import AuditLogsERP from '@/components/dashboard/AuditLogsERP';
import PolicyManager from '@/components/dashboard/PolicyManager';
import UserProfile from '@/components/dashboard/UserProfile';
import { Helmet } from 'react-helmet-async';

function Dashboard() {
  const { t } = useTranslation();
  const [currentPage, setCurrentPage] = useState('home');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const renderContent = () => {
    switch (currentPage) {
      case 'home':
        return <DashboardHome />;
      case 'blogs':
        return <BlogsManager />;
      case 'pages':
        return <PagesManager />;
      case 'products':
        return <ProductsManager />;
      case 'portfolio':
        return <PortfolioManager />;
      case 'announcements':
        return <AnnouncementsManager />;
      case 'promotions':
        return <PromotionsManager />;
      case 'photo-gallery':
        return <PhotoGalleryManager />;
      case 'video-gallery':
        return <VideoGalleryManager />;
      case 'users':
        return <UsersManager />;
      case 'roles':
        return <RolesManager />;
      case 'audit-logs':
        return <AuditLogsERP />;
      case 'policies':
        return <PolicyManager />;
      case 'profile':
        return <UserProfile />;
      default:
        return <DashboardHome />;
    }
  };

  return (
    <>
      <Helmet>
        <title>{t('dashboard_page.title')}</title>
        <meta name="description" content={t('dashboard_page.meta_description')} />
      </Helmet>
      {/* Force text-slate-900 to ensure high contrast on the light background */}
      <div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden">
        <Sidebar
          currentPage={currentPage}
          setCurrentPage={setCurrentPage}
          isOpen={sidebarOpen}
          setIsOpen={setSidebarOpen}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          <Header
            toggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            onNavigate={(page) => setCurrentPage(page)}
          />

          <main className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
            <motion.div
              key={currentPage}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
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
