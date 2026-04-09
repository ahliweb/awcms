import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Eye, EyeOff, Loader2, Lock } from 'lucide-react';
import { Helmet } from 'react-helmet-async';
import AuthShell from '@/components/auth/AuthShell';

const UpdatePasswordPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const accessToken = searchParams.get('access_token');
    const refreshToken = searchParams.get('refresh_token');

    if (!accessToken || !refreshToken) {
      toast({
        variant: 'destructive',
        title: t('update_password.toast_invalid_link_title'),
        description: t('update_password.toast_invalid_link_desc'),
      });
      navigate('/cmspanel/login');
      return;
    }

    // Set session from URL parameters
    supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    }).then(({ error }) => {
      if (error) {
        toast({
          variant: 'destructive',
          title: t('update_password.toast_invalid_link_title'),
          description: error.message || t('update_password.toast_invalid_link_desc'),
        });
        navigate('/cmspanel/login');
      }
    });

  }, [navigate, toast, searchParams, t]);

  const handleUpdatePassword = async (e) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast({
        variant: 'destructive',
        title: t('update_password.toast_mismatch_title'),
        description: t('update_password.toast_mismatch_desc'),
      });
      return;
    }

    if (password.length < 6) {
      toast({
        variant: "destructive",
        title: t('update_password.toast_password_short_title'),
        description: t('update_password.toast_password_short_desc'),
      });
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: password
      });

      if (error) throw error;

      toast({
        title: t('update_password.toast_success_title'),
        description: t('update_password.toast_success_desc'),
      });

      // Navigate to login after successful update
      navigate('/cmspanel/login');

    } catch (error) {
      console.error('Update password error:', error);
      toast({
        variant: "destructive",
        title: t('update_password.toast_failed_title'),
        description: error.message || t('update_password.toast_failed_desc')
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell
      title={t('update_password.title')}
      subtitle={t('update_password.subtitle')}
      badge={t('update_password.badge', 'Credential Reset')}
      sideTitle={t('update_password.shell_title', 'Credential Recovery')}
      sideSubtitle={t('update_password.shell_subtitle', 'Finalize your secure password reset and return to the EmDash admin workspace.')}
    >
      <Helmet>
        <title>{t('update_password.title')} - {t('login.app_name')}</title>
      </Helmet>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full"
      >
        <div className="space-y-8">
          <form onSubmit={handleUpdatePassword} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('update_password.new_password_label')}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    className="h-11 rounded-2xl border-slate-200/70 bg-white/92 pl-10 pr-10 shadow-sm focus:border-sky-500/50 focus:ring-sky-500/20 dark:border-slate-700/70 dark:bg-slate-950/60"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <Lock className="absolute left-3 top-3.5 w-4 h-4 text-slate-400" />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 transition-colors dark:hover:text-slate-200"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-sm font-medium text-slate-600 dark:text-slate-300">Confirm Password</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    className="h-11 rounded-2xl border-slate-200/70 bg-white/92 pl-10 pr-10 shadow-sm focus:border-sky-500/50 focus:ring-sky-500/20 dark:border-slate-700/70 dark:bg-slate-950/60"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                  <Lock className="absolute left-3 top-3.5 w-4 h-4 text-slate-400" />
                </div>
              </div>
            </div>

            <Button
              type="submit"
              className="h-11 w-full rounded-2xl bg-slate-950 text-white font-medium hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin mx-auto" />
              ) : (
                'Update Password'
              )}
            </Button>
          </form>
        </div>
      </motion.div>
    </AuthShell>
  );
};

export default UpdatePasswordPage;
