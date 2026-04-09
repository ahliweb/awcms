
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from '@/templates/emdash-admin/components/Sidebar';
import Footer from '@/templates/emdash-admin/components/Footer';

const AdminLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div
      className="relative min-h-screen overflow-x-clip bg-background text-foreground antialiased"
      style={{ '--header-h': '4rem' }}
    >
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(1000px_520px_at_0%_-10%,rgba(56,189,248,0.18),transparent_52%),radial-gradient(900px_420px_at_100%_0%,rgba(99,102,241,0.16),transparent_48%),linear-gradient(180deg,rgba(248,250,252,0.94),rgba(240,244,248,0.96))] dark:bg-[radial-gradient(1000px_560px_at_0%_-10%,rgba(56,189,248,0.16),transparent_48%),radial-gradient(900px_460px_at_100%_0%,rgba(129,140,248,0.18),transparent_44%),linear-gradient(180deg,rgba(10,15,28,0.98),rgba(17,24,39,0.98))]" />
        <div className="absolute inset-0 opacity-[0.05] [background-image:linear-gradient(to_right,rgba(15,23,42,0.12)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.08)_1px,transparent_1px)] [background-size:36px_36px] dark:opacity-[0.08]" />
        <div className="absolute inset-x-0 top-0 h-40 bg-[linear-gradient(180deg,rgba(15,23,42,0.08),transparent)] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent)]" />
      </div>

      <Header toggleSidebar={() => setSidebarOpen(!sidebarOpen)} />

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="relative pb-10 pt-[calc(var(--header-h)+0.5rem)] md:ml-72">
        <div className="mx-auto flex min-h-[calc(100vh-var(--header-h))] w-full max-w-[1740px] flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8 xl:px-10">
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
