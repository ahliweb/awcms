
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from '@/templates/flowbite-admin/components/Sidebar';
import Footer from '@/templates/flowbite-admin/components/Footer';

const AdminLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div
      className="relative min-h-screen overflow-x-clip bg-background text-foreground antialiased"
      style={{ '--header-h': '4rem' }}
    >
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(1200px_500px_at_15%_-15%,rgba(59,130,246,0.14),transparent_55%),radial-gradient(900px_500px_at_85%_-5%,rgba(14,165,233,0.12),transparent_55%)] dark:bg-[radial-gradient(1200px_520px_at_10%_-20%,rgba(37,99,235,0.2),transparent_55%),radial-gradient(920px_520px_at_90%_-10%,rgba(14,116,144,0.18),transparent_55%)]" />
        <div className="absolute inset-0 opacity-[0.03] [background-image:linear-gradient(to_right,var(--foreground)_1px,transparent_1px),linear-gradient(to_bottom,var(--foreground)_1px,transparent_1px)] [background-size:26px_26px] dark:opacity-[0.05]" />
      </div>

      <Header toggleSidebar={() => setSidebarOpen(!sidebarOpen)} />

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="relative pb-8 pt-[var(--header-h)] md:ml-64">
        <div className="mx-auto flex min-h-[calc(100vh-var(--header-h))] w-full max-w-[1720px] flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex-1">
            <Outlet />
          </div>
          <Footer />
        </div>
      </main>
    </div>
  );
};

export default AdminLayout;
