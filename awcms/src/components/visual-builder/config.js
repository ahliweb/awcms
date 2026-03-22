/**
 * Puck Editor Configuration
 * Defines all available components/blocks for the visual page builder
 */

import { HeroBlock } from './blocks/HeroBlock';
import { TextBlock, TextBlockFields } from './blocks/TextBlock';
import { RawHTMLBlock, RawHTMLBlockFields } from './blocks/RawHTMLBlock';
import { ImageBlock } from './blocks/ImageBlock';
import { ButtonBlock, ButtonBlockFields } from './blocks/ButtonBlock';
import { SpacerBlock, SpacerBlockFields } from './blocks/SpacerBlock';
import { GridBlock, GridBlockFields } from './blocks/GridBlock';
import { CardBlock } from './blocks/CardBlock';
import { FeatureBlock, FeatureBlockFields } from './blocks/FeatureBlock';
import { TestimonialBlock } from './blocks/TestimonialBlock';
import { GalleryBlock } from './blocks/GalleryBlock';
import { ContactFormBlock, ContactFormBlockFields } from './blocks/ContactFormBlock';
import { NavigationBlock, NavigationBlockFields } from './blocks/NavigationBlock';
import { PromotionBlock, PromotionBlockFields } from './blocks/PromotionBlock';
import { SectionBlock, SectionBlockFields } from './blocks/SectionBlock';
import { ContainerBlock, ContainerBlockFields } from './blocks/ContainerBlock';
import { DividerBlock, DividerBlockFields } from './blocks/DividerBlock';
import { advancedStyleFields, withAdvancedStyles } from './utils/styleHelpers';
import { YouTubeBlock, YouTubeBlockFields } from './blocks/YouTubeBlock';
import { StatsBlock, StatsBlockFields } from './blocks/StatsBlock';
import { PricingBlock, PricingBlockFields } from './blocks/PricingBlock';
import { AccordionBlock, AccordionBlockFields } from './blocks/AccordionBlock';
import { FeaturesListBlock, FeaturesListBlockFields } from './blocks/FeaturesListBlock';
import { StepsBlock, StepsBlockFields } from './blocks/StepsBlock';
import { LatestBlogsBlock, LatestBlogsBlockFields, resolveLatestBlogsData } from './blocks/LatestBlogsBlock';
import { ServicesListBlock, ServicesListBlockFields, resolveServicesData } from './blocks/ServicesListBlock';
import { TeamListBlock, TeamListBlockFields, resolveTeamData } from './blocks/TeamListBlock';
import { PartnersListBlock, PartnersListBlockFields, resolvePartnersData } from './blocks/PartnersListBlock';
import { TestimonialsListBlock, TestimonialsListBlockFields, resolveTestimonialsData } from './blocks/TestimonialsListBlock';
import { PageLinkField } from './fields/PageLinkField';
import { ImageField, MultiImageField } from './fields/ImageField';
import {
    ContentTitleBlock,
    ContentExcerptBlock,
    ContentFeaturedImageBlock,
    ContentBodyBlock,
    ContentMetaBlock,
    ContentTitleBlockFields,
    ContentExcerptBlockFields,
    ContentFeaturedImageBlockFields,
    ContentBodyBlockFields,
    ContentMetaBlockFields,
} from './blocks/ContentReferenceBlocks';

import { WidgetAreaBlock, WidgetAreaBlockFields } from './blocks/WidgetAreaBlock';

// Puck configuration object
export const puckConfig = {
    categories: {
        layout: {
            title: 'Layout & Structure',
            components: ['Container', 'Section', 'Grid', 'Divider', 'Spacer', 'WidgetArea']
        },
        content: {
            title: 'Basic Content',
            components: ['Text', 'Image', 'Button', 'YouTube']
        },
        marketing: {
            title: 'Marketing Components',
            components: ['Hero', 'Feature', 'FeaturesList', 'Steps', 'Card', 'Stats', 'Pricing', 'Testimonial', 'Accordion']
        },
        dynamic: {
            title: 'Dynamic & Interactive',
            components: ['LatestBlogs', 'ServicesList', 'TeamList', 'PartnersList', 'TestimonialsList', 'Promotion', 'Gallery', 'ContactForm', 'Navigation']
        },
        contentReferences: {
            title: 'Content References',
            components: ['ContentTitle', 'ContentExcerpt', 'ContentFeaturedImage', 'ContentBody', 'ContentMeta']
        }
    },
    components: {
        // --- Structural Blocks ---
        Container: {
            label: 'Container',
            fields: ContainerBlockFields,
            defaultProps: {
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                paddingTop: '2rem',
                paddingBottom: '2rem',
                paddingLeft: '1rem',
                paddingRight: '1rem'
            },
            render: ContainerBlock
        },
        Section: {
            label: 'Section Container',
            fields: SectionBlockFields,
            defaultProps: {
                backgroundColor: '#ffffff',
                paddingTop: '64px',
                paddingBottom: '64px',
                containerWidth: '1200px'
            },
            render: SectionBlock
        },
        Grid: {
            label: 'Grid Layout',
            fields: GridBlockFields,
            defaultProps: {
                columns: 2,
                gap: 24
            },
            render: GridBlock
        },
        Divider: {
            label: 'Divider',
            fields: DividerBlockFields,
            defaultProps: {
                color: '#e2e8f0',
                height: '1px',
                width: '100%',
                style: 'solid'
            },
            render: DividerBlock
        },
        Spacer: {
            label: 'Spacer',
            fields: SpacerBlockFields,
            defaultProps: {
                height: 40
            },
            render: SpacerBlock
        },
        WidgetArea: {
            label: 'Widget Area',
            fields: WidgetAreaBlockFields,
            defaultProps: {
                areaSlug: 'default-sidebar',
                title: 'Sidebar'
            },
            render: WidgetAreaBlock
        },

        // --- Basic Content ---
        Hero: {
            label: 'Hero Section',
            fields: {
                title: { type: 'text', label: 'Title' },
                subtitle: { type: 'textarea', label: 'Subtitle' },
                backgroundImage: {
                    type: 'custom',
                    label: 'Background Image',
                    render: ImageField
                },
                buttonText: { type: 'text', label: 'Button Text' },
                buttonLink: {
                    type: 'custom',
                    label: 'Button Link',
                    render: PageLinkField
                },
                alignment: {
                    type: 'select',
                    label: 'Text Alignment',
                    options: [
                        { label: 'Left', value: 'left' },
                        { label: 'Center', value: 'center' },
                        { label: 'Right', value: 'right' }
                    ]
                },
                overlayStyle: {
                    type: 'select',
                    label: 'Overlay Style',
                    options: [
                        { label: 'None', value: 'none' },
                        { label: 'Dark (Standard)', value: 'dark' },
                        { label: 'Gradient (Bottom)', value: 'gradient-bottom' },
                        { label: 'Gradient (Center)', value: 'gradient-center' },
                        { label: 'Blur (Glass)', value: 'blur' }
                    ]
                },
                scrollIndicator: {
                    type: 'radio',
                    label: 'Show Scroll Indicator',
                    options: [
                        { label: 'Yes', value: true },
                        { label: 'No', value: false }
                    ]
                },
                height: {
                    type: 'select',
                    label: 'Height',
                    options: [
                        { label: 'Small (300px)', value: 'small' },
                        { label: 'Medium (450px)', value: 'medium' },
                        { label: 'Large (600px)', value: 'large' },
                        { label: 'Full Screen', value: 'full' }
                    ]
                }
            },
            defaultProps: {
                title: 'Welcome to Our Site',
                subtitle: 'Discover amazing content and services',
                backgroundImage: '',
                buttonText: 'Learn More',
                buttonLink: '#',
                alignment: 'center',
                overlayStyle: 'dark',
                scrollIndicator: false,
                height: 'large'
            },
            render: HeroBlock
        },
        Text: {
            label: 'Text Content',
            fields: {
                ...TextBlockFields,
                ...advancedStyleFields
            },
            defaultProps: {
                content: '<p>Enter your text content here...</p>',
                alignment: 'left',
                textColor: '#000000'
            },
            render: withAdvancedStyles(TextBlock)
        },
        RawHTML: {
            label: 'Raw HTML (Fallback)',
            fields: RawHTMLBlockFields,
            defaultProps: {
                html: '<p>Imported HTML fallback content.</p>'
            },
            render: RawHTMLBlock
        },
        ContentTitle: {
            label: 'Content Title',
            fields: ContentTitleBlockFields,
            defaultProps: {
                source: 'page',
                headingLevel: 'h1',
                alignment: 'left',
                fallbackText: 'Untitled content',
            },
            render: ContentTitleBlock,
        },
        ContentExcerpt: {
            label: 'Content Excerpt',
            fields: ContentExcerptBlockFields,
            defaultProps: {
                source: 'page',
                alignment: 'left',
                fallbackText: 'Add a short summary for this content.',
            },
            render: ContentExcerptBlock,
        },
        ContentFeaturedImage: {
            label: 'Content Featured Image',
            fields: ContentFeaturedImageBlockFields,
            defaultProps: {
                source: 'page',
                aspectRatio: 'video',
                rounded: 'xl',
                showCaption: false,
            },
            render: ContentFeaturedImageBlock,
        },
        ContentBody: {
            label: 'Content Body',
            fields: ContentBodyBlockFields,
            defaultProps: {
                source: 'page',
                emptyState: 'This content source does not expose rich text body content yet.',
            },
            render: ContentBodyBlock,
        },
        ContentMeta: {
            label: 'Content Meta',
            fields: ContentMetaBlockFields,
            defaultProps: {
                source: 'page',
                alignment: 'left',
                showDate: true,
                showAuthor: true,
                showCategory: true,
                showTags: true,
            },
            render: ContentMetaBlock,
        },
        Image: {
            label: 'Image',
            fields: {
                src: {
                    type: 'custom',
                    label: 'Image',
                    render: ImageField
                },
                alt: { type: 'text', label: 'Alt Text' },
                caption: { type: 'text', label: 'Caption' },
                width: {
                    type: 'select',
                    label: 'Width',
                    options: [
                        { label: 'Full Width', value: 'full' },
                        { label: 'Large (75%)', value: 'large' },
                        { label: 'Medium (50%)', value: 'medium' },
                        { label: 'Small (25%)', value: 'small' }
                    ]
                },
                ...advancedStyleFields
            },
            defaultProps: {
                src: '',
                alt: '',
                caption: '',
                width: 'full',
                borderRadius: 'none'
            },
            render: withAdvancedStyles(ImageBlock)
        },
        Button: {
            label: 'Button',
            fields: {
                ...ButtonBlockFields,
                link: {
                    type: 'custom',
                    label: 'Link URL',
                    render: PageLinkField
                },
                variant: {
                    type: 'select',
                    label: 'Style',
                    options: [
                        { label: 'Primary (Blue)', value: 'primary' },
                        { label: 'Secondary (Gray)', value: 'secondary' },
                        { label: 'Outline', value: 'outline' },
                        { label: 'Ghost', value: 'ghost' },
                        { label: 'Gradient (Brand)', value: 'gradient' },
                        { label: 'Glass (Blur)', value: 'glass' }
                    ]
                },
                animation: {
                    type: 'select',
                    label: 'Hover Animation',
                    options: [
                        { label: 'None', value: 'none' },
                        { label: 'Scale Up', value: 'scale' },
                        { label: 'Lift', value: 'lift' },
                        { label: 'Glow', value: 'glow' }
                    ]
                },
                ...advancedStyleFields
            },
            defaultProps: {
                text: 'Click Me',
                link: '#',
                variant: 'primary',
                size: 'medium',
                alignment: 'left'
            },
            render: withAdvancedStyles(ButtonBlock)
        },
        YouTube: {
            label: 'YouTube Video',
            fields: YouTubeBlockFields,
            defaultProps: {
                url: '',
                aspectRatio: '16/9',
                autoplay: false
            },
            render: YouTubeBlock
        },

        // --- Marketing Blocks ---
        Feature: {
            label: 'Feature Item',
            fields: FeatureBlockFields,
            defaultProps: {
                icon: 'star',
                title: 'Feature Title',
                description: 'Describe this feature',
                iconColor: '#3b82f6'
            },
            render: FeatureBlock
        },
        Card: {
            label: 'Card',
            fields: {
                title: { type: 'text', label: 'Title' },
                description: { type: 'textarea', label: 'Description' },
                image: {
                    type: 'custom',
                    label: 'Card Image',
                    render: ImageField
                },
                link: {
                    type: 'custom',
                    label: 'Link URL',
                    render: PageLinkField
                },
                variant: {
                    type: 'select',
                    label: 'Style',
                    options: [
                        { label: 'Default', value: 'default' },
                        { label: 'Bordered', value: 'bordered' },
                        { label: 'Shadow', value: 'shadow' },
                        { label: 'Glass', value: 'glass' }
                    ]
                },
                aspectRatio: {
                    type: 'select',
                    label: 'Image Ratio',
                    options: [
                        { label: 'Video (16:9)', value: 'video' },
                        { label: 'Standard (4:3)', value: 'standard' },
                        { label: 'Square (1:1)', value: 'square' }
                    ]
                },
                hoverEffect: {
                    type: 'select',
                    label: 'Hover Effect',
                    options: [
                        { label: 'None', value: 'none' },
                        { label: 'Lift', value: 'lift' },
                        { label: 'Scale Image', value: 'scale-image' }
                    ]
                }
            },
            defaultProps: {
                title: 'Card Title',
                description: 'Card description goes here',
                image: '',
                link: '',
                variant: 'default'
            },
            render: CardBlock
        },
        Stats: {
            label: 'Stats / Counters',
            fields: StatsBlockFields,
            defaultProps: {
                items: [
                    { value: '10k+', label: 'Happy Users', icon: 'users' },
                    { value: '99%', label: 'Satisfaction', icon: 'award' },
                    { value: '24/7', label: 'Support', icon: 'zap' }
                ]
            },
            render: StatsBlock
        },
        Pricing: {
            label: 'Pricing Table',
            fields: PricingBlockFields,
            defaultProps: {
                items: [
                    { title: 'Starter', price: 'Free', period: 'forever', description: 'Good for trying out', buttonText: 'Sign Up' },
                    { title: 'Pro', price: '$29', period: '/month', description: 'Best for professionals', isPopular: true, buttonText: 'Go Pro' },
                    { title: 'Enterprise', price: '$99', period: '/month', description: 'For large teams', buttonText: 'Contact Sales' }
                ]
            },
            render: PricingBlock
        },
        Testimonial: {
            label: 'Testimonial',
            fields: {
                quote: { type: 'textarea', label: 'Testimonial Quote' },
                name: { type: 'text', label: 'Customer Name' },
                role: { type: 'text', label: 'Role/Company' },
                avatar: {
                    type: 'custom',
                    label: 'Avatar Image',
                    render: ImageField
                },
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
            },
            defaultProps: {
                quote: 'This product has changed my life. Highly recommended!',
                name: 'John Doe',
                role: 'CEO, Company',
                avatar: '',
                rating: 5,
                variant: 'card'
            },
            render: TestimonialBlock
        },
        Accordion: {
            label: 'FAQ / Accordion',
            fields: AccordionBlockFields,
            defaultProps: {
                items: [
                    { title: 'Is this free?', content: 'Yes, there is a free tier available.' },
                    { title: 'Can I cancel anytime?', content: 'Absolutely, you can cancel your subscription at any time.' }
                ]
            },
            render: AccordionBlock
        },
        FeaturesList: {
            label: 'Features List (Grid/Side)',
            fields: FeaturesListBlockFields,
            defaultProps: {
                layout: 'grid',
                columns: 3,
                title: 'Our Features',
                items: [
                    { title: 'Feature 1', description: 'Description 1', icon: 'tabler:star' },
                    { title: 'Feature 2', description: 'Description 2', icon: 'tabler:rocket' },
                    { title: 'Feature 3', description: 'Description 3', icon: 'tabler:shield' }
                ]
            },
            render: FeaturesListBlock
        },
        Steps: {
            label: 'Steps / Timeline',
            fields: StepsBlockFields,
            defaultProps: {
                title: 'How It Works',
                items: [
                    { title: 'Step 1', description: 'Do this first', icon: 'tabler:one' },
                    { title: 'Step 2', description: 'Then do this', icon: 'tabler:two' },
                    { title: 'Step 3', description: 'Finally do this', icon: 'tabler:three' }
                ]
            },
            render: StepsBlock
        },

        // --- Dynamic Integrations ---
        LatestBlogs: {
            label: 'Latest Blogs',
            fields: LatestBlogsBlockFields,
            defaultProps: {
                count: 3,
                layout: 'grid',
                showImage: true,
                showDate: true
            },
            render: LatestBlogsBlock,
            resolveData: resolveLatestBlogsData
        },
        ServicesList: {
            label: 'Services List',
            fields: ServicesListBlockFields,
            defaultProps: {
                count: 6,
                columns: 3,
                showIcon: true
            },
            render: ServicesListBlock,
            resolveData: resolveServicesData
        },
        TeamList: {
            label: 'Team List',
            fields: TeamListBlockFields,
            defaultProps: {
                count: 4,
                showSocial: true
            },
            render: TeamListBlock,
            resolveData: resolveTeamData
        },
        PartnersList: {
            label: 'Partners List',
            fields: PartnersListBlockFields,
            defaultProps: {
                count: 6
            },
            render: PartnersListBlock,
            resolveData: resolvePartnersData
        },
        TestimonialsList: {
            label: 'Testimonials List',
            fields: TestimonialsListBlockFields,
            defaultProps: {
                count: 3,
                layout: 'grid'
            },
            render: TestimonialsListBlock,
            resolveData: resolveTestimonialsData
        },
        Promotion: {
            label: 'Promotion / Ad',
            fields: PromotionBlockFields,
            defaultProps: {
                promotionId: '',
                variant: 'banner',
                showImage: true
            },
            render: PromotionBlock
        },
        Gallery: {
            label: 'Image Gallery',
            fields: {
                images: {
                    type: 'custom',
                    label: 'Gallery Images',
                    render: MultiImageField
                },
                columns: {
                    type: 'select',
                    label: 'Columns',
                    options: [
                        { label: '2 Columns', value: 2 },
                        { label: '3 Columns', value: 3 },
                        { label: '4 Columns', value: 4 },
                        { label: '5 Columns', value: 5 }
                    ]
                },
                gap: {
                    type: 'select',
                    label: 'Gap',
                    options: [
                        { label: 'None', value: 0 },
                        { label: 'Small', value: 8 },
                        { label: 'Medium', value: 16 },
                        { label: 'Large', value: 24 }
                    ]
                },
                aspectRatio: {
                    type: 'select',
                    label: 'Aspect Ratio',
                    options: [
                        { label: 'Square (1:1)', value: 'square' },
                        { label: 'Landscape (16:9)', value: 'landscape' },
                        { label: 'Portrait (3:4)', value: 'portrait' },
                        { label: 'Auto', value: 'auto' }
                    ]
                },
                lightbox: {
                    type: 'radio',
                    label: 'Enable Lightbox',
                    options: [
                        { label: 'Yes', value: true },
                        { label: 'No', value: false }
                    ]
                },
                borderRadius: {
                    type: 'select',
                    label: 'Border Radius',
                    options: [
                        { label: 'None', value: 'none' },
                        { label: 'Small', value: 'sm' },
                        { label: 'Medium', value: 'md' },
                        { label: 'Large', value: 'lg' }
                    ]
                }
            },
            defaultProps: {
                images: '',
                columns: 3,
                gap: 16,
                aspectRatio: 'square',
                lightbox: true,
                borderRadius: 'md'
            },
            render: GalleryBlock
        },
        ContactForm: {
            label: 'Contact Form',
            fields: ContactFormBlockFields,
            defaultProps: {
                title: 'Get in Touch',
                subtitle: 'We\'d love to hear from you',
                showName: true,
                showPhone: true,
                showSubject: true,
                buttonText: 'Send Message',
                successMessage: 'Thank you! We\'ll get back to you soon.',
                recipientEmail: '',
                variant: 'card'
            },
            render: ContactFormBlock
        },
        Navigation: {
            label: 'Navigation Menu',
            fields: NavigationBlockFields,
            defaultProps: {
                style: 'horizontal',
                alignment: 'left',
                showDropdowns: true,
                fontSize: 'base',
                gap: 8
            },
            render: NavigationBlock
        },
    },

    // Root component configuration (page settings)
    root: {
        fields: {
            backgroundColor: {
                type: 'text',
                label: 'Background Color'
            },
            maxWidth: {
                type: 'select',
                label: 'Max Width',
                options: [
                    { label: 'Full Width', value: 'full' },
                    { label: 'Container (1200px)', value: '1200px' },
                    { label: 'Narrow (800px)', value: '800px' }
                ]
            }
        },
        defaultProps: {
            backgroundColor: '#ffffff',
            maxWidth: '1200px'
        }
    }
};
