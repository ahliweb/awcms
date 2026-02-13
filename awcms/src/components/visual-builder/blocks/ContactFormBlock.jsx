/**
 * Contact Form Block Component
 * Basic contact form with configurable fields
 */

import { useState } from 'react';
import { Send, Loader2, CheckCircle } from 'lucide-react';
import { ColorPickerField } from '../fields/ColorPickerField';

export const ContactFormBlockFields = {
    title: { type: 'text', label: 'Form Title' },
    titleColor: { type: 'custom', label: 'Title Color', render: ColorPickerField },
    subtitle: { type: 'text', label: 'Subtitle' },
    subtitleColor: { type: 'custom', label: 'Subtitle Color', render: ColorPickerField },
    showName: {
        type: 'radio',
        label: 'Show Name Field',
        options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false }
        ]
    },
    showPhone: {
        type: 'radio',
        label: 'Show Phone Field',
        options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false }
        ]
    },
    showSubject: {
        type: 'radio',
        label: 'Show Subject Field',
        options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false }
        ]
    },
    buttonText: { type: 'text', label: 'Submit Button Text' },
    successMessage: { type: 'text', label: 'Success Message' },
    recipientEmail: { type: 'text', label: 'Recipient Email (for reference)' },
    variant: {
        type: 'select',
        label: 'Style',
        options: [
            { label: 'Default', value: 'default' },
            { label: 'Card', value: 'card' },
            { label: 'Minimal', value: 'minimal' }
        ]
    }
};

export const ContactFormBlock = ({
    title,
    titleColor,
    subtitle,
    subtitleColor,
    showName,
    showPhone,
    showSubject,
    buttonText,
    successMessage,
    _recipientEmail,
    variant
}) => {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '',
        subject: '',
        message: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSubmitted, setIsSubmitted] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);

        // Simulate form submission
        await new Promise(resolve => setTimeout(resolve, 1500));

        setIsSubmitting(false);
        setIsSubmitted(true);

        // Reset after showing success
        setTimeout(() => {
            setIsSubmitted(false);
            setFormData({ name: '', email: '', phone: '', subject: '', message: '' });
        }, 3000);
    };

    const handleChange = (e) => {
        setFormData(prev => ({
            ...prev,
            [e.target.name]: e.target.value
        }));
    };

    const containerClasses = {
        default: 'py-8',
        card: 'bg-white rounded-xl shadow-lg p-8 border border-slate-100',
        minimal: 'py-4'
    };

    const inputClasses = "w-full px-4 py-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all";

    if (isSubmitted) {
        return (
            <div className={`${containerClasses[variant]} text-center`}>
                <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-slate-800 mb-2">Thank You!</h3>
                <p className="text-slate-600">{successMessage || 'Your message has been sent successfully.'}</p>
            </div>
        );
    }

    return (
        <div className={containerClasses[variant]}>
            {(title || subtitle) && (
                <div className="text-center mb-8">
                    {title && <h2 className="text-2xl font-bold mb-2" style={{ color: titleColor || '#1e293b' }}>{title}</h2>}
                    {subtitle && <p style={{ color: subtitleColor || '#64748b' }}>{subtitle}</p>}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 max-w-xl mx-auto">
                {showName && (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                        <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            className={inputClasses}
                            placeholder="Your name"
                            required
                        />
                    </div>
                )}

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                    <input
                        type="email"
                        name="email"
                        value={formData.email}
                        onChange={handleChange}
                        className={inputClasses}
                        placeholder="your@email.com"
                        required
                    />
                </div>

                {showPhone && (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                        <input
                            type="tel"
                            name="phone"
                            value={formData.phone}
                            onChange={handleChange}
                            className={inputClasses}
                            placeholder="Your phone number"
                        />
                    </div>
                )}

                {showSubject && (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Subject</label>
                        <input
                            type="text"
                            name="subject"
                            value={formData.subject}
                            onChange={handleChange}
                            className={inputClasses}
                            placeholder="What is this about?"
                        />
                    </div>
                )}

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Message</label>
                    <textarea
                        name="message"
                        value={formData.message}
                        onChange={handleChange}
                        className={`${inputClasses} min-h-[120px] resize-y`}
                        placeholder="Your message..."
                        required
                    />
                </div>

                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                    {isSubmitting ? (
                        <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Sending...
                        </>
                    ) : (
                        <>
                            <Send className="w-5 h-5" />
                            {buttonText || 'Send Message'}
                        </>
                    )}
                </button>
            </form>
        </div>
    );
};

export default ContactFormBlock;
