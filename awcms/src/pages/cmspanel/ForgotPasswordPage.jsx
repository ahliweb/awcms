
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import Turnstile from '@/components/ui/Turnstile';
import { Loader2, ArrowLeft, Mail, CheckCircle2 } from 'lucide-react';

const ForgotPasswordPage = () => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Turnstile State
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileError, setTurnstileError] = useState(false);

  const { resetPassword } = useAuth();
  const { toast } = useToast();

  const handleReset = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // 0. Verify Turnstile token first (skip for localhost or if widget has error)
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const shouldSkipTurnstile = isLocalhost || turnstileError;

      if (!shouldSkipTurnstile) {
        if (!turnstileToken) {
          throw new Error('Please complete the security verification.');
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
          throw new Error(verifyData?.error || 'Security verification failed. Please try again.');
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
        title: "Reset Failed",
        description: error.message || "Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden border border-slate-200"
      >
        <div className="p-8 md:p-10 space-y-8">
          <div className="space-y-2 text-center">
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Reset Password</h1>
            <p className="text-slate-500">
              {isSuccess
                ? "Check your email for the reset link"
                : "Enter your email to receive a reset link"
              }
            </p>
          </div>

          {isSuccess ? (
            <div className="space-y-6">
              <div className="flex flex-col items-center justify-center py-6 space-y-4">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-green-600" />
                </div>
                <p className="text-center text-slate-600">
                  We have sent a password reset link to <span className="font-semibold text-slate-900">{email}</span>.
                </p>
              </div>

              <Button asChild className="w-full h-11 bg-slate-900 hover:bg-slate-800">
                <Link to="/login">Back to Login</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleReset} className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <div className="relative">
                    <Input
                      id="email"
                      type="email"
                      placeholder="admin@example.com"
                      className="h-11 pl-10"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                    <Mail className="absolute left-3 top-3.5 w-4 h-4 text-slate-400" />
                  </div>
                </div>

                {/* Turnstile CAPTCHA - Invisible Mode (configured in Cloudflare) */}
                <div>
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
                className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white font-medium"
                disabled={isLoading || (!turnstileToken && !turnstileError)}
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                ) : (
                  'Send Reset Link'
                )}
              </Button>

              <div className="text-center">
                <Link to="/login" className="text-sm text-slate-500 hover:text-slate-900 flex items-center justify-center gap-2">
                  <ArrowLeft className="w-4 h-4" /> Back to Login
                </Link>
              </div>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default ForgotPasswordPage;
