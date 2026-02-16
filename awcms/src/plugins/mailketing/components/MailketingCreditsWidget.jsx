import { useState, useEffect } from 'react';
import { CreditCard, RefreshCw } from 'lucide-react';
import { checkCredits } from '../services/emailService';
import { cn } from '@/lib/utils';

/**
 * Dashboard widget showing Mailketing email credits
 */
function MailketingCreditsWidget({ className = '' }) {
    const [credits, setCredits] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        loadCredits();
    }, []);

    const loadCredits = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await checkCredits();
            if (result.status === 'true') {
                setCredits(parseInt(result.credits) || 0);
            } else {
                setError('Failed to load');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const getCreditsColor = () => {
        if (credits === null) return 'text-slate-400';
        if (credits < 100) return 'text-red-500';
        if (credits < 500) return 'text-amber-500';
        return 'text-green-500';
    };

    return (
        <div className={cn('flex flex-col gap-3', className)}>
            <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="flex items-center gap-2 font-medium">
                    <CreditCard className="w-4 h-4" />
                    Credits Available
                </span>
                <button
                    onClick={loadCredits}
                    className="text-slate-400 hover:text-slate-600 transition-colors"
                    disabled={loading}
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {loading ? (
                <div className="text-2xl font-bold text-slate-300">...</div>
            ) : error ? (
                <div className="text-sm text-red-500">{error}</div>
            ) : (
                <div className={`text-2xl font-bold ${getCreditsColor()}`}>
                    {credits?.toLocaleString()}
                </div>
            )}

            {credits !== null && credits < 100 && (
                <p className="text-xs text-amber-600">
                    Low credits! Consider topping up.
                </p>
            )}
        </div>
    );
}

export default MailketingCreditsWidget;
