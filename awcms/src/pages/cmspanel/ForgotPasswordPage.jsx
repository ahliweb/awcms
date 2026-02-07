
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import Turnstile from '@/components/ui/Turnstile';
import AuthShell from '@/components/auth/AuthShell';
import { Loader2, ArrowLeft, Mail, CheckCircle2, ShieldCheck, Sparkles } from 'lucide-react';

const ForgotPasswordPage = () => {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Turnstile State
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileError, setTurnstileError] = useState(false);

  const { resetPassword } = useAuth();
  const { toast } = useToast();

  const sideItems = [
    {
      icon: ShieldCheck,
      title: t('forgot_password.security_title', 'Secure recovery'),
      description: t('forgot_password.security_desc', 'Turnstile verification keeps reset requests protected.'),
    },
    {
      icon: Mail,
      title: t('forgot_password.mail_title', 'Instant email links'),
      description: t('forgot_password.mail_desc', 'Receive a secure reset link directly in your inbox.'),
    },
    {
      icon: Sparkles,
      title: t('forgot_password.support_title', 'Admin support'),
      description: t('forgot_password.support_desc', 'Contact support if you need additional help.'),
    },
  ];

  const shellProps = {
    sideItems,
    sideTitle: t('forgot_password.shell_title', 'Account Recovery'),
    sideSubtitle: t('forgot_password.shell_subtitle', 'Keep your admin access secure with verified reset requests.'),
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // 0. Verify Turnstile token first (skip for localhost or if widget has error)
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const shouldSkipTurnstile = isLocalhost || turnstileError;

      if (!shouldSkipTurnstile) {
        if (!turnstileToken) {
          throw new Error(t('forgot_password.verification_needed'));
        }

        const { data: verifyData, error: verifyError } = await supabase.functions.invoke('verify-turnstile', {
          body: { token: turnstileToken }
        });

        if (verifyError || !verifyData?.success) {
          // Reset Turnstile widget on failure
          setTurnstileToken('');
          if (window.turnstileReset) {
            window.turnstileReset();
          }
          throw new Error(verifyData?.error || t('forgot_password.verification_failed_msg') || 'Security verification failed. Please try again.');
        }
      }

      // Proceed with password reset (without passing token again)
      const { error } = await resetPassword(email);
      if (error) {
        // Reset Turnstile on error
        setTurnstileToken('');
        if (window.turnstileReset) {
          window.turnstileReset();
        }
        throw error;
      }
      setIsSuccess(true);
    } catch (error) {
      console.error('Reset password error:', error);
      toast({
        variant: "destructive",
        title: t('forgot_password.reset_failed'),
        description: error.message || t('forgot_password.try_again'),
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell
      title={t('forgot_password.title')}
      subtitle={isSuccess ? t('forgot_password.check_email') : t('forgot_password.enter_email')}
      badge={t('forgot_password.badge', 'Password Recovery')}
      footer={!isSuccess ? (
        <Link to="/login" className="inline-flex items-center gap-2 font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white">
          <ArrowLeft className="h-4 w-4" /> {t('forgot_password.back_to_login')}
        </Link>
      ) : null}
      {...shellProps}
    >
      {isSuccess ? (
        <div className="space-y-6">
          <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/70 p-6 text-center text-emerald-700">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <p className="text-sm">
              {t('forgot_password.sent_message')} <span className="font-semibold text-emerald-900">{email}</span>.
            </p>
          </div>
          <Button asChild className="h-11 w-full bg-indigo-600 text-white hover:bg-indigo-700">
            <Link to="/login">{t('forgot_password.back_to_login')}</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={handleReset} className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('login_page.email_address_label')}</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@example.com"
                  className="h-11 rounded-xl border-slate-200/70 bg-white/90 pl-10 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30 dark:border-slate-700/70 dark:bg-slate-950/60"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="rounded-2xl border border-dashed border-slate-200/70 bg-slate-50/70 px-4 py-3">
              <Turnstile
                siteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY}
                onVerify={(token) => {
                  setTurnstileToken(token);
                  setTurnstileError(false);
                }}
                onError={() => setTurnstileError(true)}
                onExpire={() => setTurnstileToken('')}
                theme="light"
                appearance="always"
              />
            </div>
          </div>

          <Button
            type="submit"
            className="h-11 w-full bg-indigo-600 text-white hover:bg-indigo-700"
            disabled={isLoading || (!turnstileToken && !turnstileError)}
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin mx-auto" />
            ) : (
              t('forgot_password.send_link')
            )}
          </Button>
        </form>
      )}
    </AuthShell>
  );
};

export default ForgotPasswordPage;
