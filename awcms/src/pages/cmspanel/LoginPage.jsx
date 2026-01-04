
import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import Turnstile from '@/components/ui/Turnstile';
import { Eye, EyeOff, Loader2, ShieldCheck, AlertCircle } from 'lucide-react';
import * as OTPAuth from 'otpauth';

const LoginPage = () => {
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

  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Guard: If user is already logged in on mount
  useEffect(() => {
    let mounted = true;

    const checkUserStatus = async () => {
      if (user && !requires2FA && !isLoading) {
        try {
          const { data: twoFactorData } = await supabase
            .from('two_factor_auth')
            .select('enabled')
            .eq('user_id', user.id)
            .maybeSingle();

          // Check if user is active (soft deletion check)
          const { data: userData } = await supabase
            .from('users')
            .select('deleted_at, roles(name)')
            .eq('id', user.id)
            .maybeSingle();

          if (mounted) {
            // Hard block: if user is "deleted"
            if (userData?.deleted_at) {
              toast({
                variant: "destructive",
                title: "Account Disabled",
                description: "Your account has been deactivated."
              });
              await signOut();
              return;
            }

            // Hard block: if user has no role or is 'public' (guest) only
            // NOTE: Adjust logic based on your requirement. Here we block if role is purely 'guest' or null.
            if (!userData?.roles || userData.roles.name === 'public' || userData.roles.name === 'guest') {
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
        }
      }
    };

    checkUserStatus();

    return () => { mounted = false; };
  }, [user, requires2FA, isLoading, navigate, signOut, toast]);


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
          throw new Error('Security check failed to load. Please refresh the page.');
        }
        throw new Error('Please complete the security check (CAPTCHA).');
      }

      // 1. Authenticate with Supabase Auth
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: {
          captchaToken: turnstileToken,
        },
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
        .select('deleted_at')
        .eq('id', userId)
        .single();

      if (userProfile?.deleted_at) {
        // Force logout if soft-deleted
        await supabase.auth.signOut();
        throw new Error("Account is inactive.");
      }

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
      toast({
        title: "Welcome back!",
        description: "Successfully logged in.",
      });
      navigate('/cmspanel', { replace: true });

    } catch (error) {
      console.error('Login error:', error);
      toast({
        variant: "destructive",
        title: "Login Failed",
        description: error.message || "Please check your credentials.",
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
        throw new Error("Could not verify 2FA settings. Please try signing in again.");
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

          toast({ title: "Backup Code Used", description: "We recommend generating new codes soon." });
        } else {
          await supabase.from('two_factor_audit_logs').insert({ user_id: pendingUserId, event_type: 'verified' });

          sessionStorage.setItem('awcms_2fa_verified', 'true');
          sessionStorage.setItem('awcms_2fa_timestamp', Date.now().toString());

          toast({ title: "Verified", description: "Authentication successful." });
        }
        navigate('/cmspanel', { replace: true });
      } else {
        throw new Error("Invalid code. Please try again.");
      }

    } catch (err) {
      console.error(err);
      setVerificationError(err.message);
      setIsLoading(false);
    }
  };

  const handleCancelVerification = async () => {
    setIsLoading(true);
    setVerificationError('');
    try { await supabase.auth.signOut(); } catch (e) { }
    finally {
      setRequires2FA(false);
      setTwoFactorCode('');
      setPendingUserId(null);
      setIsLoading(false);
      toast({ description: "Verification cancelled." });
    }
  };

  if (requires2FA) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden border border-slate-200"
        >
          <div className="p-8 space-y-6">
            <div className="text-center space-y-2">
              <div className="bg-blue-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-blue-100">
                <ShieldCheck className="w-8 h-8 text-blue-600" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900">Two-Factor Authentication</h1>
              <p className="text-slate-500">Enter the 6-digit code from your authenticator app.</p>
            </div>
            <form onSubmit={verify2FA} className="space-y-6">
              <div className="space-y-4">
                <Label htmlFor="2fa-code" className="sr-only">Code</Label>
                <Input
                  id="2fa-code"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  className={`text-center text-3xl tracking-[0.5em] h-16 font-mono font-bold transition-all ${verificationError ? 'border-red-300 bg-red-50 text-red-600' : ''}`}
                  maxLength={11}
                  value={twoFactorCode}
                  onChange={(e) => { setTwoFactorCode(e.target.value.toUpperCase()); setVerificationError(''); }}
                  autoFocus
                />
                {verificationError && (
                  <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-center gap-2 text-red-500 text-sm font-medium bg-red-50 p-2 rounded-md">
                    <AlertCircle className="w-4 h-4" /> {verificationError}
                  </motion.div>
                )}
              </div>
              <div className="flex flex-col gap-3">
                <Button type="submit" className="w-full h-11 bg-blue-600 hover:bg-blue-700" disabled={isLoading || twoFactorCode.length < 3}>
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Verify Identity'}
                </Button>
                <Button type="button" variant="ghost" className="text-slate-500 text-xs" onClick={handleCancelVerification} disabled={isLoading}>
                  Cancel verification
                </Button>
              </div>
            </form>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden border border-slate-200"
      >
        <div className="p-8 md:p-10 space-y-8">
          <div className="space-y-2 text-center">
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Welcome Back</h1>
            <p className="text-slate-500">Sign in to access your CMS dashboard</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input id="email" type="email" placeholder="admin@example.com" className="h-11" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input id="password" type={showPassword ? 'text' : 'password'} placeholder="••••••••" className="h-11 pr-10" value={password} onChange={(e) => setPassword(e.target.value)} required />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3 text-slate-400 hover:text-slate-600">
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {/* Turnstile CAPTCHA - Invisible Mode (configured in Cloudflare) */}
              <div className="min-h-[20px]">
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
                    setTurnstileReady(true); // Allow login attempt even on error
                  }}
                  onExpire={() => {
                    console.log('[Login] Turnstile token expired');
                    setTurnstileToken('');
                    setTurnstileReady(false);
                  }}
                  appearance="interaction-only"
                />
                {!turnstileReady && !turnstileError && (
                  <p className="text-xs text-slate-400 text-center mt-1">Verifying security...</p>
                )}
              </div>
            </div>
            <Button type="submit" className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed" disabled={isLoading || (!turnstileReady && !turnstileError)}>
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : (!turnstileReady && !turnstileError) ? 'Waiting for security check...' : 'Sign In'}
            </Button>
            <div className="text-center mt-4 space-y-2">
              <div>
                <span className="text-slate-500 text-sm">Don't have an account? </span>
                <Link to="/register" className="text-slate-900 font-medium text-sm hover:underline">
                  Apply for access
                </Link>
              </div>
              <div>
                <Link to="/forgot-password" className="text-slate-500 text-sm hover:text-slate-900 hover:underline">
                  Forgot your password?
                </Link>
              </div>
            </div>
          </form>
        </div>
      </motion.div>
    </div>
  );
};

export default LoginPage;
