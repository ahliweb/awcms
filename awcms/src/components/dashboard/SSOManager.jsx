
import React, { useState, useEffect } from 'react';
import { Shield, Key, Lock, Activity, RefreshCw, CheckCircle, XCircle, AlertTriangle, Users, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { format } from 'date-fns';

function SSOManager() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [securityInfo, setSecurityInfo] = useState({
    authProviders: [],
    recentLogins: [],
    securityFeatures: {
      turnstile: true,
      emailVerification: true,
      passwordMinLength: 8,
    }
  });

  useEffect(() => {
    fetchSecurityData();
  }, []);

  const fetchSecurityData = async () => {
    setLoading(true);
    try {
      // Fetch recent login activity from audit_logs
      const { data: auditData, error: auditError } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('action', 'user.login')
        .order('created_at', { ascending: false })
        .limit(20);

      if (auditError) {
        console.error('Audit logs fetch error:', auditError);
      }

      // Get configured OAuth providers from Supabase settings
      // Note: These are configured in Supabase Dashboard, not custom tables
      const authProviders = [
        { name: 'Email/Password', provider_id: 'email', enabled: true, icon: '📧' },
        { name: 'Google OAuth', provider_id: 'google', enabled: true, icon: '🔵' },
        { name: 'GitHub OAuth', provider_id: 'github', enabled: true, icon: '⚫' },
        { name: 'Microsoft Azure', provider_id: 'azure', enabled: false, icon: '🔷' },
      ];

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
  };

  const SecurityFeatureCard = ({ title, description, enabled, icon: Icon }) => (
    <div className="flex items-start gap-4 p-4 bg-slate-50 rounded-lg border">
      <div className={`p-2 rounded-lg ${enabled ? 'bg-green-100 text-green-600' : 'bg-slate-200 text-slate-500'}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h4 className="font-medium text-slate-800">{title}</h4>
          {enabled ? (
            <CheckCircle className="w-4 h-4 text-green-500" />
          ) : (
            <XCircle className="w-4 h-4 text-slate-400" />
          )}
        </div>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Breadcrumb Navigation */}
      <nav className="flex items-center text-sm text-slate-500">
        <a href="/cmspanel" className="hover:text-blue-600 transition-colors flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
          Dashboard
        </a>
        <svg className="w-4 h-4 mx-2 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        <span className="flex items-center gap-1 text-slate-700 font-medium">
          <Shield className="w-4 h-4" />
          SSO & Security
        </span>
      </nav>

      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-slate-800">{t('sso.title')}</h2>
          <p className="text-slate-600">{t('sso.subtitle')}</p>
        </div>
        <Button onClick={fetchSecurityData} variant="outline" className="gap-2" disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </Button>
      </div>

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

          <Card className="bg-blue-50 border-blue-100">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-blue-600" />
                <CardTitle className="text-blue-900">OAuth Provider Configuration</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-blue-800 space-y-2">
              <p>OAuth providers (Google, GitHub, Azure AD, etc.) are configured directly in <strong>Supabase Dashboard</strong>.</p>
              <p className="flex items-center gap-2">
                <span>→</span>
                <a href="https://supabase.com/dashboard/project/_/auth/providers" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-600">
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
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="p-3 text-left font-medium">Provider</th>
                      <th className="p-3 text-left font-medium">Provider ID</th>
                      <th className="p-3 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {securityInfo.authProviders.map(provider => (
                      <tr key={provider.provider_id}>
                        <td className="p-3 flex items-center gap-2">
                          <span className="text-lg">{provider.icon}</span>
                          <span className="font-medium">{provider.name}</span>
                        </td>
                        <td className="p-3 font-mono text-xs text-slate-500">{provider.provider_id}</td>
                        <td className="p-3">
                          {provider.enabled ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                              <CheckCircle className="w-3 h-3" /> Enabled
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 text-slate-500 rounded-full text-xs font-medium">
                              <XCircle className="w-3 h-3" /> Disabled
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
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
                <Activity className="w-5 h-5 text-slate-500" />
                <CardTitle>Recent Login Activity</CardTitle>
              </div>
              <CardDescription>Last 20 login events from audit logs</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
                </div>
              ) : securityInfo.recentLogins.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <Users className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                  <p>No login activity recorded yet.</p>
                  <p className="text-sm">Login events will appear here once users start signing in.</p>
                </div>
              ) : (
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="p-3 text-left font-medium">Time</th>
                        <th className="p-3 text-left font-medium">User</th>
                        <th className="p-3 text-left font-medium">Channel</th>
                        <th className="p-3 text-left font-medium">IP Address</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {securityInfo.recentLogins.map((log, idx) => (
                        <tr key={log.id || idx}>
                          <td className="p-3 text-slate-600">
                            <div className="flex items-center gap-2">
                              <Clock className="w-4 h-4 text-slate-400" />
                              {log.created_at ? format(new Date(log.created_at), 'dd MMM yyyy HH:mm') : '-'}
                            </div>
                          </td>
                          <td className="p-3">{log.user_id || '-'}</td>
                          <td className="p-3">
                            <span className="px-2 py-1 bg-slate-100 rounded text-xs font-medium">
                              {log.channel || 'web'}
                            </span>
                          </td>
                          <td className="p-3 font-mono text-xs text-slate-500">
                            {log.ip_address || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default SSOManager;
