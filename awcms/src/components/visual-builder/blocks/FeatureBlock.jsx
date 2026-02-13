/**
 * Feature Block Component
 * Feature item with icon, title, and description
 */

import { Star, Zap, Shield, Heart, Award, Target, Users, Globe, Rocket, Check } from 'lucide-react';
import { ColorPickerField } from '../fields/ColorPickerField';

const iconMap = {
    star: Star,
    zap: Zap,
    shield: Shield,
    heart: Heart,
    award: Award,
    target: Target,
    users: Users,
    globe: Globe,
    rocket: Rocket,
    check: Check
};

export const FeatureBlockFields = {
    icon: {
        type: 'select',
        label: 'Icon',
        options: [
            { label: 'Star', value: 'star' },
            { label: 'Lightning', value: 'zap' },
            { label: 'Shield', value: 'shield' },
            { label: 'Heart', value: 'heart' },
            { label: 'Award', value: 'award' },
            { label: 'Target', value: 'target' },
            { label: 'Users', value: 'users' },
            { label: 'Globe', value: 'globe' },
            { label: 'Rocket', value: 'rocket' },
            { label: 'Check', value: 'check' }
        ]
    },
    title: { type: 'text', label: 'Title' },
    description: { type: 'textarea', label: 'Description' },
    iconColor: { type: 'custom', label: 'Icon Color', render: ColorPickerField }
};

export const FeatureBlock = ({ icon, title, description, iconColor }) => {
    const IconComponent = iconMap[icon] || Star;

    return (
        <div className="flex flex-col items-center text-center p-6">
            <div
                className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
                style={{ backgroundColor: `${iconColor}20` }}
            >
                <IconComponent
                    className="w-8 h-8"
                    style={{ color: iconColor }}
                />
            </div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">{title}</h3>
            <p className="text-slate-600">{description}</p>
        </div>
    );
};

export default FeatureBlock;
