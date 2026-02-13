/**
 * Promotion Block Component
 * Displays a selected promotion/ad from the Promotions module
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { motion } from 'framer-motion';
import { SelectField } from '../fields/SelectField';
import { sanitizeHTML } from '@/utils/sanitize';

export const PromotionBlockFields = {
    promotionId: {
        type: 'custom',
        label: 'Select Promotion',
        render: SelectField,
        fetchConfig: {
            table: 'promotions',
            labelField: 'title',
            valueField: 'id',
            filter: { status: 'active' } // Optional: only show active ones
        }
    },
    variant: {
        type: 'select',
        label: 'Style',
        options: [
            { label: 'Banner (Full Width)', value: 'banner' },
            { label: 'Card (Compact)', value: 'card' },
            { label: 'Hero Style', value: 'hero' }
        ]
    },
    showImage: {
        type: 'radio',
        label: 'Show Image',
        options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false }
        ]
    }
};

export const PromotionBlock = ({ promotionId, variant = 'banner', showImage = true }) => {
    const [promotion, setPromotion] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const fetchPromotion = async () => {
            if (!promotionId) return;
            setLoading(true);
            setError(null);
            try {
                const { data, error } = await supabase
                    .from('promotions')
                    .select('*')
                    .eq('id', promotionId)
                    .maybeSingle();

                if (error) throw error;
                if (!data) throw new Error('Promotion not found');

                // Check status
                if (data.status !== 'active') {
                    // We might still show it in editor but warn? 
                    // For now, let's show it with a warning opacity
                }

                setPromotion(data);
            } catch (err) {
                console.error('Error fetching promotion:', err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchPromotion();
    }, [promotionId]);

    if (!promotionId) {
        return (
            <div className="p-4 border border-dashed border-slate-300 rounded bg-slate-50 text-slate-500 text-center text-sm">
                Please enter a Promotion ID to display an ad.
            </div>
        );
    }

    if (loading) {
        return (
            <div className="p-8 flex justify-center items-center bg-slate-50 rounded">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
        );
    }

    if (error || !promotion) {
        return (
            <div className="p-4 border border-red-200 bg-red-50 text-red-600 rounded flex items-center gap-2 text-sm">
                <AlertCircle className="w-4 h-4" />
                {error || 'Promotion not found'}
            </div>
        );
    }

    // Render based on variant
    const isInactive = promotion.status !== 'active';

    const Container = ({ children, className = "" }) => (
        <div className={`relative ${className} ${isInactive ? 'opacity-60 grayscale' : ''}`}>
            {isInactive && (
                <div className="absolute top-2 right-2 bg-amber-500 text-white text-xs px-2 py-0.5 rounded shadow z-10">
                    Inactive
                </div>
            )}
            {children}
        </div>
    );

    const CTA = () => (
        promotion.link ? (
            <Button asChild size={variant === 'card' ? 'sm' : 'default'} className="mt-4 bg-blue-600 hover:bg-blue-700">
                <a href={promotion.link} target={promotion.target || '_self'} rel="noopener noreferrer">
                    {promotion.cta_text || 'Learn More'}
                    {promotion.target === '_blank' && <ExternalLink className="w-3 h-3 ml-2" />}
                </a>
            </Button>
        ) : null
    );


    if (variant === 'popup') {
        // For popup, we show a button to trigger it? Or does it auto-trigger in preview?
        // In editor, it should probably just show a placeholder or a "Show Popup" button.
        // In real view, it might auto-trigger.
        // Let's make it a "Modal" mode where it renders the content inside a Dialog.
        // Effectively, if you place this block, it acts as a popup provider.
        // But for Puck editor visualization, we might want to just show "Popup Active: [Title]"

        // Let's implement a "preview" mode for the editor

        // Auto-open in preview mode or real site? 
        // For now, let's just show a button "Open [Title]" in the block flow

        return (
            <div className="p-4 border border-blue-200 bg-blue-50 rounded text-center">
                <p className="text-sm text-blue-800 font-medium mb-2">Popup Promotion Active: {promotion.title}</p>
                <Button variant="outline" size="sm" onClick={() => setIsOpen(true)}>Preview Popup</Button>

                <Dialog open={isOpen} onOpenChange={setIsOpen}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>{promotion.title}</DialogTitle>
                            {/* DialogDescription is required for accessibility if we have title */}
                            <DialogDescription>
                                Special offer details below.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="flex flex-col items-center">
                            {showImage && promotion.featured_image && (
                                <img
                                    src={promotion.featured_image}
                                    alt={promotion.title}
                                    className="w-full h-48 object-cover rounded-md mb-4"
                                />
                            )}
                            <div className="text-center mb-4 prose prose-sm" dangerouslySetInnerHTML={sanitizeHTML(promotion.description || '')} />
                            <CTA />
                            {promotion.code && (
                                <div className="mt-4 bg-slate-100 px-3 py-1 rounded text-sm text-slate-700">
                                    Code: <span className="font-mono font-bold">{promotion.code}</span>
                                </div>
                            )}
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        );
    }

    if (variant === 'card') {
        return (
            <motion.div
                whileHover={{ y: -5, transition: { duration: 0.2 } }}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
            >
                <Container className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm hover:shadow-xl transition-shadow duration-300 h-full flex flex-col">
                    {showImage && promotion.featured_image && (
                        <img
                            src={promotion.featured_image}
                            alt={promotion.title}
                            className="w-full h-48 object-cover"
                        />
                    )}
                    <div className="p-5">
                        <h3 className="font-bold text-lg text-slate-900 mb-2">{promotion.title}</h3>
                        <div className="text-sm text-slate-600 line-clamp-3 prose prose-sm mb-4" dangerouslySetInnerHTML={sanitizeHTML(promotion.description || '')} />
                        <CTA />
                        {promotion.code && (
                            <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-center text-xs">
                                <span className="text-slate-500">Promo Code:</span>
                                <code className="bg-slate-100 px-2 py-1 rounded text-slate-700 font-mono font-bold select-all">{promotion.code}</code>
                            </div>
                        )}
                    </div>
                </Container>
            </motion.div>
        );
    }

    if (variant === 'hero') {
        return (
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
            >
                <Container className="relative rounded-2xl overflow-hidden bg-slate-900 text-white min-h-[400px] flex items-center shadow-2xl">
                    {showImage && promotion.featured_image && (
                        <div className="absolute inset-0 z-0">
                            <img
                                src={promotion.featured_image}
                                alt={promotion.title}
                                className="w-full h-full object-cover opacity-60"
                            />
                            <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent"></div>
                        </div>
                    )}
                    <div className="relative z-10 p-8 md:p-12 max-w-2xl">
                        {promotion.discount_percentage > 0 && (
                            <span className="inline-block bg-white/20 backdrop-blur text-white px-3 py-1 rounded-full text-sm font-medium mb-4">
                                Save {promotion.discount_percentage}%
                            </span>
                        )}
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">{promotion.title}</h2>
                        <div className="text-lg text-slate-200 mb-6 max-w-lg" dangerouslySetInnerHTML={sanitizeHTML(promotion.description || '')} />
                        <div className="flex gap-4 items-center">
                            <CTA />
                            {promotion.code && (
                                <div className="flex flex-col bg-white/10 backdrop-blur px-4 py-1.5 rounded-lg border border-white/20">
                                    <span className="text-[10px] text-white/70 uppercase tracking-widest">Code</span>
                                    <span className="font-mono font-bold text-lg tracking-wide">{promotion.code}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </Container>
            </motion.div>
        );
    }

    // Default Banner
    return (
        <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
        >
            <Container className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-xl p-8 text-white flex flex-col md:flex-row items-center gap-8 shadow-lg hover:shadow-2xl transition-all duration-300">
                {showImage && promotion.featured_image && (
                    <div className="w-full md:w-1/3 shrink-0">
                        <img
                            src={promotion.featured_image}
                            alt={promotion.title}
                            className="w-full h-48 object-cover rounded-lg shadow-lg"
                        />
                    </div>
                )}
                <div className="flex-1 text-center md:text-left">
                    <h3 className="text-2xl font-bold mb-2">{promotion.title}</h3>
                    <div className="text-blue-100 mb-4 prose-invert" dangerouslySetInnerHTML={sanitizeHTML(promotion.description || '')} />
                    <div className="flex flex-col md:flex-row items-center gap-4">
                        <CTA />
                        {promotion.code && (
                            <div className="text-sm">
                                Use Code: <span className="bg-white/20 px-2 py-1 rounded font-mono font-bold ml-1">{promotion.code}</span>
                            </div>
                        )}
                    </div>
                </div>
            </Container>
        </motion.div>
    );
};

export default PromotionBlock;
