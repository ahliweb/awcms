
import React, { useState, useEffect, useCallback } from 'react';
import { Shield, Key, Lock, Activity, RefreshCw, CheckCircle, XCircle, AlertTriangle, Users, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

function SSOManager() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const PAGE_SIZE = 20;
  const MAX_RECORDS = 1000;
  const [securityInfo, setSecurityInfo] = useState({
    authProviders: [],
    recentLogins: [],
    securityFeatures: {
      turnstile: true,
      emailVerification: true,
      passwordMinLength: 8,
    }
  });

  const fetchSecurityData = useCallback(async (page = 0) => {
    setLoading(true);
    try {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      // Get total count first (capped at MAX_RECORDS)
      const { count: rawCount } = await supabase
        .from('audit_logs')
        .select('id', { count: 'exact', head: true })
        .eq('action', 'user.login');

      const totalRecords = Math.min(rawCount || 0, MAX_RECORDS);
      setTotalCount(totalRecords);

      // Fetch recent login activity from audit_logs with user email
      const { data: auditData, error: auditError } = await supabase
        .from('audit_logs')
        .select('*, user:users!user_id(email)')
        .eq('action', 'user.login')
        .order('created_at', { ascending: false })
        .range(from, to);

      if (auditError) {
        console.error('Audit logs fetch error:', auditError);
      }

      // Get configured OAuth providers from database
      const { data: dbProviders, error: providersError } = await supabase
        .from('sso_providers')
        .select('*')
        .order('provider_id');

      if (providersError) {
        console.error('SSO providers fetch error:', providersError);
      }

      // Icon mapping
      const iconMap = {
        email: '📧',
        google: '🔵',
        github: '⚫',
        azure: '🔷'
      };

      const authProviders = dbProviders?.map(p => ({
        name: p.name,
        provider_id: p.provider_id,
        enabled: p.is_active,
        icon: iconMap[p.provider_id] || '🔒'
      })) || [];

      // Fallback if no providers found in DB (e.g. fresh tenant), show defaults or keep empty
      // Ideally the backend seeds this, which we did.

      setSecurityInfo({
        authProviders,
        recentLogins: auditData || [],
        securityFeatures: {
          turnstile: true,
          emailVerification: true,
          passwordMinLength: 8,
        }
      });

    } catch (error) {
      console.error('Security data fetch error:', error);
      toast({ variant: "destructive", title: t('common.error'), description: "Failed to load security data" });
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    fetchSecurityData(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const SecurityFeatureCard = ({ title, description, enabled, icon: Icon }) => (
    <div className="flex items-start gap-4 p-4 bg-card rounded-lg border">
      <div className={`p-2 rounded-lg ${enabled ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h4 className="font-medium text-foreground">{title}</h4>
          {enabled ? (
            <CheckCircle className="w-4 h-4 text-green-500" />
          ) : (
            <XCircle className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );

  return (
    <AdminPageLayout requiredPermission="tenant.sso.read">
      <PageHeader
        title={t('sso.title')}
        description={t('sso.subtitle')}
        icon={Shield}
        breadcrumbs={[{ label: 'SSO & Security', icon: Shield }]}
        actions={(
          <Button onClick={() => { setCurrentPage(0); fetchSecurityData(0); }} variant="outline" className="gap-2" disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </Button>
        )}
      />

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-3 mb-6">
          <TabsTrigger value="overview">Security Overview</TabsTrigger>
          <TabsTrigger value="providers">Auth Providers</TabsTrigger>
          <TabsTrigger value="activity">Login Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-blue-600" />
                  <CardTitle>Security Features</CardTitle>
                </div>
                <CardDescription>Active security measures protecting your platform</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <SecurityFeatureCard
                  title="Turnstile CAPTCHA"
                  description="Cloudflare Turnstile protection on login"
                  enabled={securityInfo.securityFeatures.turnstile}
                  icon={Shield}
                />
                <SecurityFeatureCard
                  title="Email Verification"
                  description="Users must verify email before access"
                  enabled={securityInfo.securityFeatures.emailVerification}
                  icon={Key}
                />
                <SecurityFeatureCard
                  title="Password Policy"
                  description={`Minimum ${securityInfo.securityFeatures.passwordMinLength} characters required`}
                  enabled={true}
                  icon={Lock}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Lock className="w-5 h-5 text-green-600" />
                  <CardTitle>Platform Security</CardTitle>
                </div>
                <CardDescription>Core security infrastructure</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <SecurityFeatureCard
                  title="Row Level Security (RLS)"
                  description="Database-level access control enabled"
                  enabled={true}
                  icon={Shield}
                />
                <SecurityFeatureCard
                  title="JWT Authentication"
                  description="Secure token-based authentication"
                  enabled={true}
                  icon={Key}
                />
                <SecurityFeatureCard
                  title="HTTPS Enforced"
                  description="All connections encrypted in transit"
                  enabled={true}
                  icon={Lock}
                />
              </CardContent>
            </Card>
          </div>

          <Card className="bg-blue-50 border-blue-100 dark:bg-blue-900/10 dark:border-blue-800">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                <CardTitle className="text-blue-900 dark:text-blue-200">OAuth Provider Configuration</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-blue-800 dark:text-blue-300 space-y-2">
              <p>OAuth providers (Google, GitHub, Azure AD, etc.) are configured directly in <strong>Supabase Dashboard</strong>.</p>
              <p className="flex items-center gap-2">
                <span>→</span>
                <a href="https://supabase.com/dashboard/project/_/auth/providers" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-600 dark:hover:text-blue-400">
                  Configure OAuth in Supabase Dashboard
                </a>
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="providers" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Authentication Providers</CardTitle>
              <CardDescription>Identity providers configured for this platform</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="p-3 text-left font-medium text-muted-foreground">Provider</th>
                      <th className="p-3 text-left font-medium text-muted-foreground">Provider ID</th>
                      <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {securityInfo.authProviders.map(provider => (
                      <tr key={provider.provider_id}>
                        <td className="p-3 flex items-center gap-2">
                          <span className="text-lg">{provider.icon}</span>
                          <span className="font-medium">{provider.name}</span>
                        </td>
                        <td className="p-3 font-mono text-xs text-muted-foreground">{provider.provider_id}</td>
                        <td className="p-3">
                          {provider.enabled ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full text-xs font-medium">
                              <CheckCircle className="w-3 h-3" /> Enabled
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-secondary text-muted-foreground rounded-full text-xs font-medium">
                              <XCircle className="w-3 h-3" /> Disabled
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 dark:bg-amber-900/10 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-300">
                <strong>Note:</strong> To enable/disable OAuth providers, configure them in the{' '}
                <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer" className="underline">
                  Supabase Dashboard → Authentication → Providers
                </a>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-muted-foreground" />
                <CardTitle>Recent Login Activity</CardTitle>
              </div>
              <CardDescription>Login events from audit logs (page {currentPage + 1} of {Math.ceil(totalCount / PAGE_SIZE) || 1})</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : securityInfo.recentLogins.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p>No login activity recorded yet.</p>
                  <p className="text-sm">Login events will appear here once users start signing in.</p>
                </div>
              ) : (
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b">
                      <tr>
                        <th className="p-3 text-left font-medium text-muted-foreground">Time</th>
                        <th className="p-3 text-left font-medium text-muted-foreground">Email</th>
                        <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
                        <th className="p-3 text-left font-medium text-muted-foreground">Channel</th>
                        <th className="p-3 text-left font-medium text-muted-foreground">IP Address</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {securityInfo.recentLogins.map((log, idx) => {
                        const status = log.details?.status || 'success';
                        const errorMsg = log.details?.error;
                        return (
                          <tr key={log.id || idx}>
                            <td className="p-3 text-muted-foreground">
                              <div className="flex items-center gap-2">
                                <Clock className="w-4 h-4 text-muted-foreground" />
                                {log.created_at ? format(new Date(log.created_at), 'dd MMM yyyy HH:mm:ss') : '-'}
                              </div>
                            </td>
                            <td className="p-3">{log.user?.email || log.details?.attempted_email || log.user_id || '-'}</td>
                            <td className="p-3">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${status === 'success'
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                }`} title={errorMsg || ''}>
                                {status === 'success' ? '✓ Success' : `✗ ${errorMsg || 'Failed'}`}
                              </span>
                            </td>
                            <td className="p-3">
                              <span className="px-2 py-1 bg-secondary rounded text-xs font-medium">
                                {log.channel || 'web'}
                              </span>
                            </td>
                            <td className="p-3 font-mono text-xs text-muted-foreground">
                              {log.ip_address || '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {/* Pagination Controls */}
                  <div className="flex items-center justify-between p-3 border-t bg-muted/20">
                    <div className="text-sm text-muted-foreground">
                      Showing {currentPage * PAGE_SIZE + 1} - {Math.min((currentPage + 1) * PAGE_SIZE, totalCount)} of {totalCount}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setCurrentPage(p => p - 1); fetchSecurityData(currentPage - 1); }}
                        disabled={currentPage === 0}
                      >
                        <ChevronLeft className="w-4 h-4 mr-1" /> Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setCurrentPage(p => p + 1); fetchSecurityData(currentPage + 1); }}
                        disabled={(currentPage + 1) * PAGE_SIZE >= totalCount}
                      >
                        Next <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AdminPageLayout>
  );
}

export default SSOManager;
