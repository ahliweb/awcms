import { useCallback, useEffect, useState } from 'react';
import { Shield, KeyRound, Activity } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useTranslation } from 'react-i18next';
import { AdminPageLayout, PageHeader, PageTabs } from '@/templates/emdash-admin';
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
  const [activeTab, setActiveTab] = useState('overview');
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
        description: t('sso.errors.load_failed'),
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
        breadcrumbs={[{ label: t('sso.title'), icon: Shield }]}
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

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Providers</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{securityInfo.authProviders.length}</p>
          <p className="text-xs text-muted-foreground">Configured authentication providers in view</p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Recent logins</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{totalCount}</p>
          <p className="text-xs text-muted-foreground">Audit-backed sign-in records available for paging</p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Security</p>
          <p className="mt-1 text-sm font-semibold text-foreground">Turnstile + email verification</p>
          <p className="text-xs text-muted-foreground">Core protections surfaced in the overview tab</p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Scope</p>
          <p className="mt-1 text-sm font-semibold text-foreground">Tenant SSO visibility</p>
          <p className="text-xs text-muted-foreground">Read access remains permission-gated</p>
        </div>
      </div>

      <div className="mb-6 overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm backdrop-blur-sm">
        <div className="bg-gradient-to-r from-primary/12 via-background/40 to-emerald-500/12 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="inline-flex items-center rounded-full border border-border/70 bg-background/80 px-3 py-1.5"><KeyRound className="mr-1.5 h-3.5 w-3.5 text-primary" />Supabase provider configuration</span>
            <span className="inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-emerald-700 dark:text-emerald-300"><Activity className="mr-1.5 h-3.5 w-3.5" />Audit activity review</span>
          </div>
        </div>
      </div>

      <PageTabs
        value={activeTab}
        onValueChange={setActiveTab}
        tabs={[
          { value: 'overview', label: t('sso.tabs.overview') },
          { value: 'providers', label: t('sso.tabs.providers') },
          { value: 'activity', label: t('sso.tabs.activity') },
        ]}
      >

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
      </PageTabs>
    </AdminPageLayout>
  );
}

export default SSOManager;
