
import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from '@/templates/flowbite-admin/components/Sidebar';
import Footer from '@/templates/flowbite-admin/components/Footer';

const AdminLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="antialiased bg-gray-50 dark:bg-gray-900 min-h-screen">
      <Header toggleSidebar={() => setSidebarOpen(!sidebarOpen)} />

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="p-4 md:ml-64 h-auto pt-20 min-h-screen flex flex-col">
        <div className="flex-1">
          <Outlet />
        </div>
        <Footer />
      </main>
    </div>
  );
};

export default AdminLayout;
