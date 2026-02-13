
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import Turnstile from '@/components/ui/Turnstile';
import AuthShell from '@/components/auth/AuthShell';
import { Eye, EyeOff, Loader2, ShieldCheck, AlertCircle, LayoutGrid, Sparkles, Mail, Lock } from 'lucide-react';
import * as OTPAuth from 'otpauth';


const LoginPage = () => {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Turnstile State
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileError, setTurnstileError] = useState(false);
  const [turnstileReady, setTurnstileReady] = useState(false);

  // 2FA State
  const [requires2FA, setRequires2FA] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [pendingUserId, setPendingUserId] = useState(null);
  const [verificationError, setVerificationError] = useState('');

  const { user, signOut, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [sessionCheck, setSessionCheck] = useState(false);

  const sideItems = [
    {
      icon: ShieldCheck,
      title: t('login_page.security_title', 'Secure sign-in'),
      description: t('login_page.security_desc', 'Turnstile validation and optional 2FA keep access protected.'),
    },
    {
      icon: LayoutGrid,
      title: t('login_page.control_title', 'Centralized control'),
      description: t('login_page.control_desc', 'Manage tenants, content, and users from one workspace.'),
    },
    {
      icon: Sparkles,
      title: t('login_page.insight_title', 'Operational insights'),
      description: t('login_page.insight_desc', 'Track performance, audits, and approvals in real time.'),
    },
  ];

  const shellProps = {
    sideItems,
    sideTitle: t('login_page.shell_title', 'Admin Control Center'),
    sideSubtitle: t('login_page.shell_subtitle', 'Securely manage tenants, content, and operations with audit-ready oversight.'),
  };


  // Guard: If user is already logged in on mount
  useEffect(() => {
    let mounted = true;

    const checkUserStatus = async () => {
      if (user && !requires2FA && !isLoading) {
        if (mounted) setSessionCheck(true);
        try {
          const { data: twoFactorData } = await supabase
            .from('two_factor_auth')
            .select('enabled')
            .eq('user_id', user.id)
            .maybeSingle();

          // Check if user is active (soft deletion check)
          const { data: userData } = await supabase
            .from('users')
            .select('deleted_at, roles(name, is_public, is_guest)')
            .eq('id', user.id)
            .maybeSingle();

          if (mounted) {
            // Hard block: if user is "deleted"
            if (userData?.deleted_at) {
              toast({
                variant: "destructive",
                title: t('login_page.account_disabled_title'),
                description: t('login_page.account_disabled_desc')
              });
              await signOut();
              return;
            }

            // Hard block: if user has no role or is 'public' (guest) only
            // NOTE: Adjust logic based on your requirement. Here we block if role is purely 'guest' or null.
            if (!userData?.roles || userData.roles.is_public || userData.roles.is_guest) {
              // For now we allow 'guest' if you want them to see dashboard, but usually we restrict.
              // Assuming 'public' role is for frontend users who shouldn't access CMS.
              // toast({ variant: "destructive", title: "Access Denied", description: "You do not have permission to access the CMS." });
              // await signOut();
              // return;
            }

            if (twoFactorData?.enabled) {
              console.warn("User has 2FA enabled but no verification context. Forcing logout.");
              await signOut();
            } else {
              navigate('/cmspanel', { replace: true });
            }
          }
        } catch (e) {
          console.error("Status check failed", e);
        } finally {
          if (mounted) setSessionCheck(false);
        }
      } else if (mounted) {
        setSessionCheck(false);
      }
    };

    checkUserStatus();

    return () => { mounted = false; };
  }, [user, requires2FA, isLoading, navigate, signOut, toast, t]);

  if (authLoading || sessionCheck) {
    return (
      <AuthShell
        title={t('login_page.restoring_title', 'Restoring your session')}
        subtitle={t('login_page.restoring_subtitle', 'Checking your secure access credentials…')}
        badge={t('login_page.restoring_badge', 'Authenticating')}
        {...shellProps}
      >
        <div className="flex flex-col items-center gap-5 text-center">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {t('login_page.restoring_status', 'Validating access token')}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('login_page.restoring_hint', 'We’ll redirect you automatically once ready.')}
            </p>
          </div>
          <div className="h-2 w-full max-w-[240px] overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-800/70">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-indigo-500 via-blue-500 to-sky-400" />
          </div>
        </div>
      </AuthShell>
    );
  }


  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setVerificationError('');

    try {
      // 1. Validate Turnstile Token presence
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

      // Ensure we have a token before attempting login (unless strictly dev mode bypassing it, but Supabase will likely reject if protection is on)
      if (!turnstileToken && !isLocalhost) {
        if (turnstileError) {
          throw new Error(t('login_page.security_check_failed'));
        }
        throw new Error(t('login_page.complete_captcha'));
      }

      // 1.5 Verify Turnstile token via Edge Function (server-side verification)
      if (turnstileToken) {
        const verifyResponse = await supabase.functions.invoke('verify-turnstile', {
          body: { token: turnstileToken },
        });

        if (verifyResponse.error || !verifyResponse.data?.success) {
          // Reset Turnstile on verification failure
          setTurnstileToken('');
          if (window.turnstileReset) {
            window.turnstileReset();
          }
          throw new Error(t('login_page.verification_failed'));
        }
      }

      // 2. Authenticate with Supabase Auth (without passing token again)
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        // Reset Turnstile on login error
        setTurnstileToken('');
        if (window.turnstileReset) {
          window.turnstileReset();
        }
        throw error;
      }

      const userId = data.user.id;

      // 1.5 Check if user is active/deleted in public.users
      const { data: userProfile } = await supabase
        .from('users')
        .select('deleted_at, tenant_id')
        .eq('id', userId)
        .single();

      if (userProfile?.deleted_at) {
        // Force logout if soft-deleted
        await supabase.auth.signOut();
        throw new Error("Account is inactive.");
      }

      const userTenantId = userProfile?.tenant_id;

      // 2. Check if user has 2FA enabled
      const { data: twoFactorData } = await supabase
        .from('two_factor_auth')
        .select('enabled')
        .eq('user_id', userId)
        .maybeSingle();

      if (twoFactorData?.enabled) {
        setRequires2FA(true);
        setPendingUserId(userId);
        setIsLoading(false);
        return;
      }

      // No 2FA -> Proceed to dashboard
      // Log successful login (get IP via edge function)
      let clientIP = null;
      try {
        const ipResponse = await supabase.functions.invoke('get-client-ip');
        console.log('[Login] IP response:', ipResponse);
        if (!ipResponse.error && ipResponse.data?.ip) {
          clientIP = ipResponse.data.ip;
          console.log('[Login] Got IP:', clientIP);
        } else if (ipResponse.error) {
          console.warn('[Login] IP error:', ipResponse.error);
        }
      } catch (e) {
        console.warn('[Login] IP fetch exception:', e);
      }

      await supabase.from('audit_logs').insert({
        tenant_id: userTenantId,
        user_id: userId,
        action: 'user.login',
        resource: 'auth',
        channel: 'web',
        ip_address: clientIP,
        details: { user_agent: navigator.userAgent, status: 'success' },
      });

      // Cleanup old login audit logs (keep only 100 per tenant)
      await supabase.rpc('cleanup_old_login_audit_logs');

      toast({
        title: t('login_page.welcome_back_title'),
        description: t('login_page.login_success'),
      });
      navigate('/cmspanel', { replace: true });

    } catch (error) {
      console.error('Login error:', error);

      // Log failed login attempt
      try {
        await supabase.from('audit_logs').insert({
          tenant_id: null,
          user_id: null,
          action: 'user.login',
          resource: 'auth',
          channel: 'web',
          details: {
            status: 'failed',
            error: error.message || 'Unknown error',
            user_agent: navigator.userAgent,
            attempted_email: email
          },
        });
      } catch (logErr) {
        console.warn('Failed to log login failure:', logErr);
      }

      toast({
        variant: "destructive",
        title: t('login_page.login_failed'),
        description: error.message || t('login_page.check_credentials'),
      });
      setIsLoading(false);
    }
  };

  const verify2FA = async (e) => {
    e.preventDefault();
    if (!twoFactorCode) return;

    setIsLoading(true);
    setVerificationError('');

    try {
      const { data, error } = await supabase
        .from('two_factor_auth')
        .select('secret, backup_codes')
        .eq('user_id', pendingUserId)
        .maybeSingle();

      if (error || !data) {
        console.error("2FA Fetch Error:", error);
        throw new Error(t('two_factor.fetch_error'));
      }

      let isValid = false;
      let isBackup = false;
      const cleanCode = twoFactorCode.trim().replace(/[\s-]/g, '');

      if (data.backup_codes && data.backup_codes.some(code => code.replace(/-/g, '') === cleanCode)) {
        isValid = true;
        isBackup = true;
      } else {
        const totp = new OTPAuth.TOTP({
          algorithm: 'SHA1',
          digits: 6,
          period: 30,
          secret: OTPAuth.Secret.fromBase32(data.secret)
        });
        const delta = totp.validate({ token: cleanCode, window: 1 });
        isValid = (delta !== null);
      }

      if (isValid) {
        if (isBackup) {
          const exactCodeMatch = data.backup_codes.find(c => c.replace(/-/g, '') === cleanCode);
          const newCodes = data.backup_codes.filter(c => c !== exactCodeMatch);
          await supabase.from('two_factor_auth').update({ backup_codes: newCodes }).eq('user_id', pendingUserId);
          await supabase.from('two_factor_audit_logs').insert({ user_id: pendingUserId, event_type: 'backup_code_used' });

          sessionStorage.setItem('awcms_2fa_verified', 'true');
          sessionStorage.setItem('awcms_2fa_timestamp', Date.now().toString());
          toast({ title: t('two_factor.backup_used_title'), description: t('two_factor.backup_used_desc') });
        } else {
          await supabase.from('two_factor_audit_logs').insert({ user_id: pendingUserId, event_type: 'verified' });
          sessionStorage.setItem('awcms_2fa_verified', 'true');
          sessionStorage.setItem('awcms_2fa_timestamp', Date.now().toString());
          toast({ title: t('two_factor.verified'), description: t('two_factor.auth_success') });
        }

        // Log successful 2FA login
        const { data: userProfile2FA } = await supabase
          .from('users')
          .select('tenant_id')
          .eq('id', pendingUserId)
          .single();

        let clientIP2FA = null;
        try {
          const { data: ipData, error: ipError } = await supabase.functions.invoke('get-client-ip');
          if (!ipError && ipData?.ip) {
            clientIP2FA = ipData.ip;
            console.log('[Login 2FA] Got IP:', clientIP2FA);
          }
        } catch (e) {
          console.warn('[Login 2FA] IP fetch failed:', e);
        }

        await supabase.from('audit_logs').insert({
          tenant_id: userProfile2FA?.tenant_id,
          user_id: pendingUserId,
          action: 'user.login',
          resource: 'auth',
          channel: 'web',
          ip_address: clientIP2FA,
          details: { user_agent: navigator.userAgent, twoFactor: true, status: 'success' },
        });

        // Cleanup old login audit logs (keep only 100 per tenant)
        await supabase.rpc('cleanup_old_login_audit_logs');

        navigate('/cmspanel', { replace: true });
      } else {
        throw new Error(t('two_factor.invalid_code'));
      }

    } catch (err) {
      console.error(err);

      // Log failed 2FA attempt
      try {
        await supabase.from('audit_logs').insert({
          tenant_id: null,
          user_id: pendingUserId,
          action: 'user.login',
          resource: 'auth',
          channel: 'web',
          details: {
            status: 'failed',
            error: err.message || '2FA verification failed',
            user_agent: navigator.userAgent,
            twoFactor: true
          },
        });
      } catch (logErr) {
        console.warn('Failed to log 2FA failure:', logErr);
      }

      setVerificationError(err.message);
      setIsLoading(false);
    }
  };

  const handleCancelVerification = async () => {
    setIsLoading(true);
    setVerificationError('');
    try { await supabase.auth.signOut(); } catch { /* Ignore signout errors */ }
    finally {
      setRequires2FA(false);
      setTwoFactorCode('');
      setPendingUserId(null);
      setIsLoading(false);
      toast({ description: t('two_factor.cancelled') });
    }
  };

  if (requires2FA) {
    return (
      <AuthShell
        title={t('two_factor.title')}
        subtitle={t('two_factor.subtitle')}
        badge={t('two_factor.badge', 'Two-Factor Verification')}
        {...shellProps}
      >
        <form onSubmit={verify2FA} className="space-y-6">
          <div className="space-y-4">
            <Label htmlFor="2fa-code" className="sr-only">Code</Label>
            <Input
              id="2fa-code"
              autoComplete="one-time-code"
              placeholder="000000"
              className={`h-16 rounded-2xl border-slate-200/70 bg-slate-50/80 text-center text-3xl font-bold tracking-[0.4em] text-slate-900 shadow-sm transition-all focus:border-indigo-500/60 focus:ring-indigo-500/30 ${verificationError ? 'border-rose-300 bg-rose-50 text-rose-600' : ''}`}
              maxLength={11}
              value={twoFactorCode}
              onChange={(e) => { setTwoFactorCode(e.target.value.toUpperCase()); setVerificationError(''); }}
              autoFocus
            />
            {verificationError && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600"
              >
                <AlertCircle className="w-4 h-4" /> {verificationError}
              </motion.div>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <Button type="submit" className="h-11 w-full bg-indigo-600 text-white hover:bg-indigo-700" disabled={isLoading || twoFactorCode.length < 3}>
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : t('two_factor.verify_identity')}
            </Button>
            <Button type="button" variant="ghost" className="text-xs text-slate-500 hover:text-slate-700" onClick={handleCancelVerification} disabled={isLoading}>
              {t('two_factor.cancel')}
            </Button>
          </div>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t('login_page.welcome_back')}
      subtitle={t('login_page.sign_in_subtitle')}
      badge={t('login_page.badge', 'Administrator Sign-In')}
      footer={(
        <div className="space-y-2">
          <div>
            <span>{t('login_page.no_account')} </span>
            <Link to="/register" className="font-semibold text-slate-900 hover:text-indigo-600 dark:text-white">
              {t('login_page.apply_access')}
            </Link>
          </div>
          <div>
            <Link to="/forgot-password" className="font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white">
              {t('login_page.forgot_password_link')}
            </Link>
          </div>
        </div>
      )}
      {...shellProps}
    >
      <form onSubmit={handleLogin} className="space-y-6">
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
          <div className="space-y-2">
            <Label htmlFor="password" className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('login_page.password_label')}</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                className="h-11 rounded-xl border-slate-200/70 bg-white/90 pl-10 pr-10 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30 dark:border-slate-700/70 dark:bg-slate-950/60"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3 text-slate-400 hover:text-slate-600">
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {turnstileError && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
              <AlertCircle className="h-4 w-4" /> {t('login_page.security_check_failed', 'Security check failed. Please refresh the page.')}
            </div>
          )}

          <div className="rounded-2xl border border-dashed border-slate-200/70 bg-slate-50/70 px-4 py-3">
            <Turnstile
              siteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY}
              onVerify={(token) => {
                console.log('[Login] Turnstile token received');
                setTurnstileToken(token);
                setTurnstileError(false);
                setTurnstileReady(true);
              }}
              onError={() => {
                console.error('[Login] Turnstile error');
                setTurnstileError(true);
                setTurnstileReady(true);
              }}
              onExpire={() => {
                console.log('[Login] Turnstile token expired');
                setTurnstileToken('');
                setTurnstileReady(false);
              }}
              theme="light"
            />
            {!turnstileReady && !turnstileError && (
              <p className="mt-2 text-center text-xs text-slate-400">{t('login_page.verifying_security')}</p>
            )}
          </div>
        </div>
        <Button
          type="submit"
          className="h-11 w-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 disabled:opacity-50"
          disabled={isLoading || (!turnstileReady && !turnstileError)}
        >
          {isLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : (!turnstileReady && !turnstileError) ? t('login_page.waiting_security') : t('login_page.sign_in_button')}
        </Button>
      </form>
    </AuthShell>
  );
};

export default LoginPage;
