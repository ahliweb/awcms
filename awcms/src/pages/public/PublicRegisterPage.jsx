
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import Turnstile from '@/components/ui/Turnstile';
import { Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react';

const PublicRegisterPage = () => {
    const [formData, setFormData] = useState({
        full_name: '',
        email: ''
    });
    const [isLoading, setIsLoading] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [turnstileToken, setTurnstileToken] = useState('');

    const { toast } = useToast();

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
                    // turnstileToken // Ideally verifying turnstile in backend too, but keeping simple for now
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

    if (isSuccess) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden border border-slate-200 p-8 text-center space-y-6"
                >
                    <div className="bg-green-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto border-4 border-green-100">
                        <CheckCircle2 className="w-8 h-8 text-green-600" />
                    </div>
                    <div className="space-y-2">
                        <h2 className="text-2xl font-bold text-slate-900">Application Received</h2>
                        <p className="text-slate-500">
                            Thank you for applying. Your account request is under review.
                            Once approved, you will receive an invitation email to set your password and sign in.
                        </p>
                    </div>
                    <Link to="/login">
                        <Button variant="outline" className="w-full">Return to Login</Button>
                    </Link>
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
                    <div className="space-y-2">
                        <Link to="/login" className="inline-flex items-center text-sm text-slate-500 hover:text-slate-900 mb-4 transition-colors">
                            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Login
                        </Link>
                        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Apply for Account</h1>
                        <p className="text-slate-500">Join our platform to access exclusive content.</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="full_name">Full Name</Label>
                                <Input
                                    id="full_name"
                                    placeholder="John Doe"
                                    value={formData.full_name}
                                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="email">Email Address</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="john@example.com"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    required
                                />
                            </div>

                            <div className="pt-2">
                                <Turnstile
                                    siteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY}
                                />
                            </div>
                        </div>

                        <Button
                            type="submit"
                            className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white font-medium"
                            disabled={isLoading}
                        >
                            {isLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Submit Application'}
                        </Button>
                    </form>

                    <div className="text-center text-sm text-slate-500">
                        By submitting, you agree to our <Link to="/terms" className="underline hover:text-slate-900">Terms of Service</Link>.
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

export default PublicRegisterPage;
