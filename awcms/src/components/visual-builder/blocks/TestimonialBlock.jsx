/**
 * Testimonial Block Component
 * Customer testimonial with quote, name, and avatar
 */

import { Quote } from 'lucide-react';
import { ColorPickerField } from '../fields/ColorPickerField';

export const TestimonialBlockFields = {
    quote: { type: 'textarea', label: 'Testimonial Quote' },
    quoteColor: { type: 'custom', label: 'Quote Color', render: ColorPickerField },
    name: { type: 'text', label: 'Customer Name' },
    nameColor: { type: 'custom', label: 'Name Color', render: ColorPickerField },
    role: { type: 'text', label: 'Role/Company' },
    roleColor: { type: 'custom', label: 'Role Color', render: ColorPickerField },
    avatar: { type: 'text', label: 'Avatar Image URL' },
    rating: {
        type: 'select',
        label: 'Rating',
        options: [
            { label: '5 Stars', value: 5 },
            { label: '4 Stars', value: 4 },
            { label: '3 Stars', value: 3 },
            { label: '2 Stars', value: 2 },
            { label: '1 Star', value: 1 }
        ]
    },
    variant: {
        type: 'select',
        label: 'Style',
        options: [
            { label: 'Card', value: 'card' },
            { label: 'Simple', value: 'simple' },
            { label: 'Centered', value: 'centered' }
        ]
    }
};

export const TestimonialBlock = ({ quote, quoteColor: _quoteColor, name, nameColor: _nameColor, role, roleColor: _roleColor, avatar, rating, variant }) => {
    const renderStars = () => {
        return (
            <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                    <svg
                        key={star}
                        className={`w-5 h-5 ${star <= rating ? 'text-yellow-400' : 'text-slate-200'}`}
                        fill="currentColor"
                        viewBox="0 0 20 20"
                    >
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                ))}
            </div>
        );
    };

    if (variant === 'centered') {
        return (
            <div className="text-center py-12 px-6">
                <Quote className="w-12 h-12 text-blue-200 mx-auto mb-6" />
                <blockquote className="text-2xl text-slate-700 italic mb-6 max-w-3xl mx-auto">
                    &quot;{quote}&quot;
                </blockquote>
                <div className="flex items-center justify-center gap-4">
                    {avatar && (
                        <img src={avatar} alt={name} className="w-16 h-16 rounded-full object-cover" />
                    )}
                    <div>
                        <p className="font-bold text-slate-800">{name}</p>
                        <p className="text-slate-500 text-sm">{role}</p>
                        {rating && <div className="mt-1">{renderStars()}</div>}
                    </div>
                </div>
            </div>
        );
    }

    if (variant === 'simple') {
        return (
            <div className="py-6 border-l-4 border-blue-500 pl-6">
                <blockquote className="text-lg text-slate-700 italic mb-4">
                    &quot;{quote}&quot;
                </blockquote>
                <div className="flex items-center gap-3">
                    {avatar && (
                        <img src={avatar} alt={name} className="w-10 h-10 rounded-full object-cover" />
                    )}
                    <div>
                        <p className="font-semibold text-slate-800">{name}</p>
                        <p className="text-slate-500 text-sm">{role}</p>
                    </div>
                    {rating && <div className="ml-auto">{renderStars()}</div>}
                </div>
            </div>
        );
    }

    // Card variant (default)
    return (
        <div className="bg-white rounded-xl shadow-lg p-6 border border-slate-100">
            <div className="flex items-start gap-4 mb-4">
                {avatar ? (
                    <img src={avatar} alt={name} className="w-14 h-14 rounded-full object-cover" />
                ) : (
                    <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center">
                        <span className="text-xl font-bold text-blue-600">{name?.charAt(0)}</span>
                    </div>
                )}
                <div className="flex-1">
                    <p className="font-bold text-slate-800">{name}</p>
                    <p className="text-slate-500 text-sm">{role}</p>
                    {rating && <div className="mt-1">{renderStars()}</div>}
                </div>
                <Quote className="w-8 h-8 text-blue-100 flex-shrink-0" />
            </div>
            <blockquote className="text-slate-600 italic">&quot;{quote}&quot;</blockquote>
        </div>
    );
};

export default TestimonialBlock;
