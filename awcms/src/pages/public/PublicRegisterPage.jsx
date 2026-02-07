
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import Turnstile from '@/components/ui/Turnstile';
import AuthShell from '@/components/auth/AuthShell';
import { Loader2, ArrowLeft, CheckCircle2, ShieldCheck, Sparkles, Mail } from 'lucide-react';

const PublicRegisterPage = () => {
    const [formData, setFormData] = useState({
        full_name: '',
        email: ''
    });
    const [isLoading, setIsLoading] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [turnstileToken, setTurnstileToken] = useState('');

    const { toast } = useToast();

    const sideItems = [
        {
            icon: ShieldCheck,
            title: 'Verified onboarding',
            description: 'Applications are reviewed to keep the platform secure.',
        },
        {
            icon: Sparkles,
            title: 'Guided setup',
            description: 'We help you configure branding, content, and roles.',
        },
        {
            icon: Mail,
            title: 'Fast turnaround',
            description: 'Approved requests receive a secure invitation by email.',
        },
    ];

    const shellProps = {
        sideItems,
        sideTitle: 'Access Request',
        sideSubtitle: 'Apply for an admin account and receive a secure invitation once approved.',
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            if (!turnstileToken && window.location.hostname !== 'localhost') {
                throw new Error('Please complete the security check.');
            }

            const { data, error } = await supabase.functions.invoke('manage-users', {
                body: {
                    action: 'submit_application',
                    email: formData.email,
                    full_name: formData.full_name,
                    turnstileToken,
                }
            });

            if (error) throw error;
            if (data?.error) throw new Error(data.error);

            setIsSuccess(true);
            toast({
                title: "Application Submitted",
                description: "We have received your request.",
            });

        } catch (error) {
            console.error('Registration error:', error);
            toast({
                variant: "destructive",
                title: "Submission Failed",
                description: error.message || "Please try again.",
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <AuthShell
            title={isSuccess ? 'Application Received' : 'Apply for Account'}
            subtitle={isSuccess
                ? 'We have received your request. You will get an invitation email once approved.'
                : 'Join our platform to access the CMS and public portal tools.'}
            badge={isSuccess ? 'Request Submitted' : 'Access Request'}
            footer={!isSuccess ? (
                <div>
                    By submitting, you agree to our <Link to="/terms" className="font-medium text-slate-700 hover:text-slate-900 dark:text-slate-200">Terms of Service</Link>.
                </div>
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
                            Thank you for applying. Your account request is under review.
                            Once approved, you will receive an invitation email to set your password.
                        </p>
                    </div>
                    <Link to="/login">
                        <Button variant="outline" className="w-full">Return to Login</Button>
                    </Link>
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="full_name" className="text-sm font-medium text-slate-600 dark:text-slate-300">Full Name</Label>
                            <Input
                                id="full_name"
                                placeholder="John Doe"
                                value={formData.full_name}
                                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                                className="h-11 rounded-xl border-slate-200/70 bg-white/90 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30 dark:border-slate-700/70 dark:bg-slate-950/60"
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="email" className="text-sm font-medium text-slate-600 dark:text-slate-300">Email Address</Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="john@example.com"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                className="h-11 rounded-xl border-slate-200/70 bg-white/90 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30 dark:border-slate-700/70 dark:bg-slate-950/60"
                                required
                            />
                        </div>

                        <div className="rounded-2xl border border-dashed border-slate-200/70 bg-slate-50/70 px-4 py-3">
                            <Turnstile
                                siteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY}
                                onVerify={(token) => setTurnstileToken(token)}
                                onError={() => setTurnstileToken('')}
                            />
                        </div>
                    </div>

                    <Button
                        type="submit"
                        className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
                        disabled={isLoading}
                    >
                        {isLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Submit Application'}
                    </Button>

                    <Link to="/login" className="inline-flex items-center justify-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-700">
                        <ArrowLeft className="w-4 h-4" /> Back to Login
                    </Link>
                </form>
            )}
        </AuthShell>
    );
};

export default PublicRegisterPage;
