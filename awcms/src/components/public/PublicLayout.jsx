
import { Outlet } from 'react-router-dom';
import PublicHeader from './PublicHeader';
import PublicFooter from './PublicFooter';

import DynamicTemplate from './DynamicTemplate';

import { usePublicTenant } from '@/hooks/usePublicTenant';

function PublicLayout() {
  const { tenant } = usePublicTenant();

  // Optionally show loader while resolving tenant
  // if (loading) return <div className="h-screen flex items-center justify-center">Loading site...</div>;

  return (
    <div className="flex flex-col min-h-screen bg-white">
      <DynamicTemplate type="header" fallback={PublicHeader} context={{ tenant }} />
      <main className="flex-1">
        <Outlet context={{ tenant }} />
      </main>
      <DynamicTemplate type="footer" fallback={PublicFooter} context={{ tenant }} />
    </div>
  );
}

export default PublicLayout;
