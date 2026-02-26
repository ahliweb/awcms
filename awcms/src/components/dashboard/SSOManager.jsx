import { useCallback, useEffect, useState } from 'react';
import { Shield } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from 'react-i18next';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import SSOHeaderActions from '@/components/dashboard/sso/SSOHeaderActions';
import SSOOverviewTab from '@/components/dashboard/sso/SSOOverviewTab';
import SSOProvidersTab from '@/components/dashboard/sso/SSOProvidersTab';
import SSOActivityTab from '@/components/dashboard/sso/SSOActivityTab';

const PAGE_SIZE = 20;
const MAX_RECORDS = 1000;

function SSOManager() {
  const { toast } = useToast();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [securityInfo, setSecurityInfo] = useState({
    authProviders: [],
    recentLogins: [],
    securityFeatures: {
      turnstile: true,
      emailVerification: true,
      passwordMinLength: 8,
    },
  });

  const fetchSecurityData = useCallback(async (page = 0) => {
    setLoading(true);
    try {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { count: rawCount } = await supabase
        .from('audit_logs')
        .select('id', { count: 'exact', head: true })
        .eq('action', 'user.login');

      const totalRecords = Math.min(rawCount || 0, MAX_RECORDS);
      setTotalCount(totalRecords);

      const { data: auditData, error: auditError } = await supabase
        .from('audit_logs')
        .select('*, user:users!user_id(email)')
        .eq('action', 'user.login')
        .order('created_at', { ascending: false })
        .range(from, to);

      if (auditError) {
        console.error('Audit logs fetch error:', auditError);
      }

      const { data: dbProviders, error: providersError } = await supabase
        .from('sso_providers')
        .select('*')
        .order('provider_id');

      if (providersError) {
        console.error('SSO providers fetch error:', providersError);
      }

      const iconMap = {
        email: '📧',
        google: '🔵',
        github: '⚫',
        azure: '🔷',
      };

      const authProviders = dbProviders?.map((provider) => ({
        name: provider.name,
        provider_id: provider.provider_id,
        enabled: provider.is_active,
        icon: iconMap[provider.provider_id] || '🔒',
      })) || [];

      setSecurityInfo({
        authProviders,
        recentLogins: auditData || [],
        securityFeatures: {
          turnstile: true,
          emailVerification: true,
          passwordMinLength: 8,
        },
      });
    } catch (error) {
      console.error('Security data fetch error:', error);
      toast({
        variant: 'destructive',
        title: t('common.error'),
        description: 'Failed to load security data',
      });
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    fetchSecurityData(0);
  }, [fetchSecurityData]);

  return (
    <AdminPageLayout requiredPermission="tenant.sso.read">
      <PageHeader
        title={t('sso.title')}
        description={t('sso.subtitle')}
        icon={Shield}
        breadcrumbs={[{ label: 'SSO & Security', icon: Shield }]}
        actions={(
          <SSOHeaderActions
            loading={loading}
            onRefresh={() => {
              setCurrentPage(0);
              fetchSecurityData(0);
            }}
            t={t}
          />
        )}
      />

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-6 grid w-full grid-cols-3">
          <TabsTrigger value="overview">Security Overview</TabsTrigger>
          <TabsTrigger value="providers">Auth Providers</TabsTrigger>
          <TabsTrigger value="activity">Login Activity</TabsTrigger>
        </TabsList>

        <SSOOverviewTab securityInfo={securityInfo} />
        <SSOProvidersTab securityInfo={securityInfo} />
        <SSOActivityTab
          loading={loading}
          securityInfo={securityInfo}
          currentPage={currentPage}
          totalCount={totalCount}
          pageSize={PAGE_SIZE}
          onPrevious={() => {
            const nextPage = Math.max(0, currentPage - 1);
            setCurrentPage(nextPage);
            fetchSecurityData(nextPage);
          }}
          onNext={() => {
            const nextPage = currentPage + 1;
            setCurrentPage(nextPage);
            fetchSecurityData(nextPage);
          }}
        />
      </Tabs>
    </AdminPageLayout>
  );
}

export default SSOManager;
