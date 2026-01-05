
import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { TEMPLATE_NAME, TEMPLATE_VERSION } from '@/templates/awadmintemplate01';

const AdminLayout = () => {
  // Default to true for desktop (window width > 1024px), false for mobile
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Adjust initial state based on screen size
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
      }
    };

    // Set initial
    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar - Handles its own rendering based on props */}
      <Sidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />

      {/* Main Content Wrapper */}
      <div className="flex-1 flex flex-col overflow-hidden relative w-full transition-all duration-300 ease-in-out">
        {/* Top Header */}
        <Header toggleSidebar={() => setSidebarOpen(!sidebarOpen)} />

        {/* Page Content Scrollable Area */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 lg:p-8 w-full custom-scrollbar scroll-smooth">
          <div className="mx-auto max-w-7xl w-full min-h-full">
            <Outlet />
          </div>

          {/* Footer with Template Version */}
          <footer className="mt-8 py-4 border-t border-slate-200 text-center text-xs text-slate-400">
            <span>{TEMPLATE_NAME} v{TEMPLATE_VERSION}</span>
            <span className="mx-2">•</span>
            <span>AWCMS © {new Date().getFullYear()}</span>
          </footer>
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
