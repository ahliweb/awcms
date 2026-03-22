// Widget Registry matching WidgetRenderer.astro types
import {
    Type, Image, List, Share2, Megaphone, Mail, MapPin,
    Phone, Newspaper, Tag, Hash, Code
} from 'lucide-react';

export const CORE_WIDGETS = [
    {
        type: 'text',
        name: 'Text Block',
        icon: Type,
        defaultConfig: { content: '', isHtml: false }
    },
    {
        type: 'html',
        name: 'Raw HTML',
        icon: Code,
        defaultConfig: { content: '' }
    },
    {
        type: 'image',
        name: 'Image',
        icon: Image,
        defaultConfig: { src: '', alt: '', caption: '' }
    },
    {
        type: 'links',
        name: 'Link List',
        icon: List,
        defaultConfig: { items: [{ title: 'Example Link', url: '#' }] }
    },
    {
        type: 'social',
        name: 'Social Links',
        icon: Share2,
        defaultConfig: { links: [{ platform: 'twitter', url: '#' }] }
    },
    {
        type: 'cta',
        name: 'Call to Action',
        icon: Megaphone,
        defaultConfig: { description: 'Join us today!', button_text: 'Click Here', button_url: '#' }
    },
    {
        type: 'newsletter',
        name: 'Newsletter Signup',
        icon: Mail,
        defaultConfig: { description: 'Subscribe to our updates.' }
    },
    {
        type: 'map',
        name: 'Map Embed',
        icon: MapPin,
        defaultConfig: { embed_url: '' }
    },
    {
        type: 'contact',
        name: 'Contact Info',
        icon: Phone,
        defaultConfig: { address: '', phone: '', email: '' }
    },
    {
        type: 'recent_posts',
        name: 'Recent Posts',
        icon: Newspaper,
        defaultConfig: { count: 5 }
    },
    {
        type: 'categories',
        name: 'Categories',
        icon: Tag,
        defaultConfig: {}
    },
    {
        type: 'tags',
        name: 'Tags',
        icon: Hash,
        defaultConfig: {}
    }
];

// Global registry (in-memory)
const registry = [...CORE_WIDGETS];

export const getWidgets = () => registry;

export const registerWidget = (widgetDef) => {
    // Check for duplicate
    if (registry.find(w => w.type === widgetDef.type)) {
        console.warn(`Widget ${widgetDef.type} already registered.`);
        return;
    }
    registry.push(widgetDef);
};
