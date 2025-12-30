
import React from 'react';
import { AuthProvider } from '@/contexts/SupabaseAuthContext';
import { PermissionProvider } from '@/contexts/PermissionContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { PluginProvider } from '@/contexts/PluginContext';
import { Toaster } from '@/components/ui/toaster';
import MainRouter from '@/components/MainRouter';
import { Helmet } from 'react-helmet';

import { TenantProvider } from '@/contexts/TenantContext';

import { useTenantTheme } from '@/hooks/useTenantTheme';

// Wrapper to apply tenant theme
const ThemeWrapper = ({ children }) => {
  useTenantTheme();
  return children;
};

import { useOfflineSync } from '@/hooks/useOfflineSync';

function App() {
  const { isSyncing } = useOfflineSync(); // Initialize Sync Engine

  return (
    <TenantProvider>
      <AuthProvider>
        <PermissionProvider>
          <ThemeProvider>
            <PluginProvider>
              <Helmet>
                <title>CMS & Public Portal</title>
                <meta name="description" content="Content Management System and Public Portal" />
              </Helmet>
              <ThemeWrapper>
                <MainRouter />
                <Toaster />
              </ThemeWrapper>
            </PluginProvider>
          </ThemeProvider>
        </PermissionProvider>
      </AuthProvider>
    </TenantProvider>
  );
}

export default App;
