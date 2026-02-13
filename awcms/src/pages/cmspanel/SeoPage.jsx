
import Sidebar from '@/components/dashboard/Sidebar';
import Header from '@/components/dashboard/Header';
import SeoManager from '@/components/dashboard/SeoManager';

const SeoPage = () => {
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* We reuse the Sidebar and Header assuming they exist as per file list */}
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 overflow-y-auto">
          <SeoManager />
        </main>
      </div>
    </div>
  );
};

export default SeoPage;
