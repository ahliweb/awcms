
import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';

const AuthContext = createContext(undefined);

export const AuthProvider = ({ children }) => {
  const { toast } = useToast();

  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

  const handleSession = useCallback(async (session) => {
    setSession(session);
    const currentUser = session?.user ?? null;
    setUser(currentUser);

    // Check 2FA status if user exists
    if (currentUser) {
      try {
        const { data, error } = await supabase
          .from('two_factor_auth')
          .select('enabled')
          .eq('user_id', currentUser.id)
          .maybeSingle();

        if (!error && data) {
          setTwoFactorEnabled(data.enabled);
        } else {
          setTwoFactorEnabled(false);
        }
      } catch (e) {
        console.error("Failed to check 2FA status", e);
        setTwoFactorEnabled(false);
      }
    } else {
      setTwoFactorEnabled(false);
    }

    setLoading(false);
  }, []);

  // Helper to clear local storage aggressively
  const clearLocalAuth = useCallback(() => {
    try {
      // console.log("[Auth] Clearing local session data...");
      const keyPattern = /^sb-.*-auth-token$/;

      // 1. Clear Supabase Tokens
      Object.keys(localStorage).forEach(key => {
        if (keyPattern.test(key)) {
          localStorage.removeItem(key);
        }
      });

      // 2. Clear 2FA State
      sessionStorage.removeItem('awcms_2fa_verified');
      sessionStorage.removeItem('awcms_2fa_timestamp');

      // 3. Clear any potential tenant context if stored locally (though usually in-memory)
      // This ensures a fresh start for the next user.
    } catch (e) {
      console.warn("Could not clear local storage", e);
    }
  }, []);

  const logSsoLoginEvent = useCallback(async (session) => {
    const provider = session?.user?.app_metadata?.provider;
    if (!provider || provider === 'email' || provider === 'phone') {
      return;
    }

    let tenantId = session?.user?.app_metadata?.tenant_id || null;
    if (!tenantId && session?.user?.id) {
      const { data: userProfile, error } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('id', session.user.id)
        .maybeSingle();

      if (!error) {
        tenantId = userProfile?.tenant_id || null;
      }
    }

    if (!tenantId) {
      console.warn('[Auth] Skipping SSO login audit log: missing tenant_id.');
      return;
    }

    let clientIP = null;
    try {
      const { data: ipData, error: ipError } = await supabase.functions.invoke('get-client-ip');
      if (!ipError && ipData?.ip) {
        clientIP = ipData.ip;
      }
    } catch (e) {
      console.warn('[Auth] IP lookup failed for SSO login audit log:', e);
    }

    const { error } = await supabase.from('audit_logs').insert({
      tenant_id: tenantId,
      user_id: session.user.id,
      action: 'user.login',
      resource: 'auth',
      channel: 'sso',
      ip_address: clientIP,
      details: { provider, user_agent: navigator.userAgent },
    });

    if (error) {
      console.warn('[Auth] Failed to log SSO login event:', error);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let initialResolved = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;

        if (event === 'SIGNED_OUT') {
          setSession(null);
          setUser(null);
          setLoading(false);
          clearLocalAuth();
          return;
        }

        if (!initialResolved || event === 'INITIAL_SESSION') {
          initialResolved = true;
          await handleSession(session);
          if (event === 'SIGNED_IN') {
            logSsoLoginEvent(session);
          }
          return;
        }

        if (event === 'SIGNED_IN') {
          await handleSession(session);
          logSsoLoginEvent(session);
          return;
        }

        if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED' || event === 'PASSWORD_RECOVERY' || event === 'MFA_CHALLENGE_VERIFIED') {
          await handleSession(session);
          return;
        }

        await handleSession(session);
      },
    );

    const getSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (mounted) {
          initialResolved = true;
          await handleSession(session);
        }
      } catch (error) {
        console.error("Auth initialization error:", error.message);

        // Handle invalid refresh tokens by clearing session
        if (
          error.message?.includes('Invalid Refresh Token') ||
          error.message?.includes('Refresh Token Not Found') ||
          error.code === 'refresh_token_not_found'
        ) {
          console.warn("Detected invalid refresh token. Clearing session.");
          clearLocalAuth();

          // Force sign out to ensure state is clean
          await supabase.auth.signOut().catch(() => { });

          if (mounted) {
            setSession(null);
            setUser(null);
            setLoading(false);
          }
        } else {
          if (mounted) setLoading(false);
        }
      }
    };

    getSession();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [handleSession, clearLocalAuth, logSsoLoginEvent]);

  const signUp = useCallback(async (email, password, options) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options,
      });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Sign up Failed",
        description: error.message || "Something went wrong",
      });
      return { data: null, error };
    }
  }, [toast]);

  const signIn = useCallback(async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Sign in Failed",
        description: error.message || "Something went wrong",
      });
      return { data: null, error };
    }
  }, [toast]);

  const signOut = useCallback(async () => {
    try {
      // Attempt to sign out from Supabase
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      // Check for common session errors that occur when already logged out
      const isSessionError =
        error.message?.includes('session_not_found') ||
        error.code === '403' ||
        error.code === 403 ||
        error.status === 403 ||
        error.message?.includes('JWT');

      if (!isSessionError) {
        console.error("Sign out error:", error);
      }
    } finally {
      // CRITICAL: Force clear local state and storage regardless of server response
      setSession(null);
      setUser(null);
      clearLocalAuth();
    }
  }, [clearLocalAuth]);

  const resetPassword = useCallback(async (email) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/cmspanel/update-password`,
      });
      if (error) throw error;
      return { error: null };
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Reset Password Failed",
        description: error.message || "Something went wrong",
      });
      return { error };
    }
  }, [toast]);

  const value = useMemo(() => ({
    user,
    session,
    loading,
    twoFactorEnabled,
    signUp,
    signIn,
    signOut,
    resetPassword
  }), [user, session, loading, twoFactorEnabled, signUp, signIn, signOut, resetPassword]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
