
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LogIn, UserPlus, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Helmet } from 'react-helmet-async';
import AuthShell from '@/components/auth/AuthShell';

function LoginPage() {
  const { t } = useTranslation();
  const { signIn, signUp } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const [loginData, setLoginData] = useState({ email: '', password: '' });
  const [signupData, setSignupData] = useState({ email: '', password: '', fullName: '' });

  const sideItems = [
    {
      icon: ShieldCheck,
      title: t('login_page.security_title', 'Secure sign-in'),
      description: t('login_page.security_desc', 'Turnstile and audit logging keep access protected.'),
    },
    {
      icon: Sparkles,
      title: t('login_page.experience_title', 'Refined experience'),
      description: t('login_page.experience_desc', 'Switch between login and signup without leaving the page.'),
    },
  ];

  const shellProps = {
    sideItems,
    sideTitle: t('login_page.shell_title', 'Account Access'),
    sideSubtitle: t('login_page.shell_subtitle', 'Sign in or create your account to continue.'),
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    await signIn(loginData.email, loginData.password);
    setIsLoading(false);
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    await signUp(signupData.email, signupData.password, {
      data: { full_name: signupData.fullName }
    });
    setIsLoading(false);
  };

  return (
    <>
      <Helmet>
        <title>{t('login_page.title')}</title>
        <meta name="description" content={t('login_page.meta_description')} />
      </Helmet>
      <AuthShell
        title={t('login_page.heading')}
        subtitle={t('login_page.subheading')}
        badge={t('login_page.badge', 'Account Access')}
        {...shellProps}
      >
        <Tabs defaultValue="login" className="w-full">
          <TabsList className="grid w-full grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm text-slate-500">
            <TabsTrigger value="login" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-slate-900">
              {t('login_page.tab_login')}
            </TabsTrigger>
            <TabsTrigger value="signup" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-slate-900">
              {t('login_page.tab_signup')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="login" className="mt-6">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email" className="text-sm font-medium text-slate-600">{t('login_page.email_label')}</Label>
                <Input
                  id="login-email"
                  type="email"
                  placeholder={t('login_page.email_placeholder')}
                  value={loginData.email}
                  onChange={(e) => setLoginData({ ...loginData, email: e.target.value })}
                  className="h-11 rounded-xl border-slate-200/70 bg-white/90 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password" className="text-sm font-medium text-slate-600">{t('login_page.password_label')}</Label>
                <Input
                  id="login-password"
                  type="password"
                  placeholder={t('login_page.password_placeholder')}
                  value={loginData.password}
                  onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                  className="h-11 rounded-xl border-slate-200/70 bg-white/90 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30"
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                disabled={isLoading}
              >
                <LogIn className="w-4 h-4 mr-2" />
                {isLoading ? t('login_page.button_logging_in') : t('login_page.button_login')}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="signup" className="mt-6">
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="signup-name" className="text-sm font-medium text-slate-600">{t('login_page.fullname_label')}</Label>
                <Input
                  id="signup-name"
                  type="text"
                  placeholder={t('login_page.fullname_placeholder')}
                  value={signupData.fullName}
                  onChange={(e) => setSignupData({ ...signupData, fullName: e.target.value })}
                  className="h-11 rounded-xl border-slate-200/70 bg-white/90 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-email" className="text-sm font-medium text-slate-600">{t('login_page.email_label')}</Label>
                <Input
                  id="signup-email"
                  type="email"
                  placeholder={t('login_page.email_placeholder')}
                  value={signupData.email}
                  onChange={(e) => setSignupData({ ...signupData, email: e.target.value })}
                  className="h-11 rounded-xl border-slate-200/70 bg-white/90 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-password" className="text-sm font-medium text-slate-600">{t('login_page.password_label')}</Label>
                <Input
                  id="signup-password"
                  type="password"
                  placeholder={t('login_page.password_placeholder')}
                  value={signupData.password}
                  onChange={(e) => setSignupData({ ...signupData, password: e.target.value })}
                  className="h-11 rounded-xl border-slate-200/70 bg-white/90 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30"
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={isLoading}
              >
                <UserPlus className="w-4 h-4 mr-2" />
                {isLoading ? t('login_page.button_creating_account') : t('login_page.button_signup')}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </AuthShell>
    </>
  );
}

export default LoginPage;
