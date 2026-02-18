import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
// Use the standard local service role key directly as retrieved from .env (commented out section)
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

if (!supabaseUrl) {
    console.error('Error: Supabase URL not found in environment variables.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

const PAGES = [
    {
        slug: 'about',
        title: 'About Us',
        content: {
            root: { props: { title: 'About Us' }, children: ["hero-id", "mission-id", "stats-id", "team-id"] },
            "hero-id": {
                type: 'Hero',
                props: {
                    id: 'hero-id',
                    title: 'About Our Company',
                    subtitle: 'We are dedicated to providing the best solutions for our customers.',
                    align: 'center',
                    padding: '24',
                    height: 'medium',
                    overlayStyle: 'dark',
                    backgroundImage: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=2000&q=80',
                    buttons: [
                        { label: 'Contact Us', variant: 'primary', url: '/contact' }
                    ]
                }
            },
            "mission-id": {
                type: 'Content',
                props: {
                    id: 'mission-id',
                    title: 'Our Mission',
                    description: 'To empower businesses with innovative technology solutions that drive growth and efficiency.',
                    align: 'center'
                }
            },
            "stats-id": {
                type: 'Stats',
                props: {
                    id: 'stats-id',
                    items: [
                        { value: '10+', label: 'Years Experience', icon: 'calendar', valueColor: '#2563eb', labelColor: '#64748b' },
                        { value: '500+', label: 'Projects Delivered', icon: 'check-circle', valueColor: '#2563eb', labelColor: '#64748b' },
                        { value: '50+', label: 'Team Members', icon: 'users', valueColor: '#2563eb', labelColor: '#64748b' }
                    ]
                }
            },
            "team-id": {
                type: 'TeamList',
                props: { id: 'team-id', count: 3, showSocial: true }
            }
        }
    },
    {
        slug: 'services',
        title: 'Our Services',
        content: {
            root: { props: { title: 'Services' }, children: ["hero-id", "services-id", "features-id", "testimonials-id"] },
            "hero-id": {
                type: 'Hero',
                props: {
                    id: 'hero-id',
                    title: 'Our Services',
                    subtitle: 'Comprehensive solutions tailored to your needs.',
                    height: 'medium',
                    overlayStyle: 'gradient-bottom',
                    backgroundImage: 'https://images.unsplash.com/photo-1504384308090-c54be3855833?auto=format&fit=crop&w=2000&q=80'
                }
            },
            "services-id": {
                type: 'ServicesList',
                props: { id: 'services-id', count: 6, columns: 3 }
            },
            "features-id": {
                type: 'FeaturesList',
                props: {
                    id: 'features-id',
                    layout: 'image-side',
                    title: 'Why Choose Us?',
                    image: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=800&q=80',
                    items: [
                        { title: 'Expert Team', description: 'Our team consists of industry experts.', icon: 'tabler:users' },
                        { title: '24/7 Support', description: 'We are always here to help you.', icon: 'tabler:headset' },
                        { title: 'Proven Results', description: 'We deliver measurable results.', icon: 'tabler:chart-bar' }
                    ]
                }
            },
            "testimonials-id": {
                type: 'TestimonialsList',
                props: { id: 'testimonials-id', count: 3, layout: 'grid' }
            }
        }
    },
    {
        slug: 'pricing',
        title: 'Pricing Plans',
        content: {
            root: { props: { title: 'Pricing' }, children: ["hero-id", "pricing-id", "faq-id"] },
            "hero-id": {
                type: 'Hero',
                props: {
                    id: 'hero-id',
                    title: 'Simple, Transparent Pricing',
                    subtitle: 'Choose the plan that fits your business needs.',
                    height: 'medium',
                    align: 'center',
                    overlayStyle: 'blur',
                    backgroundImage: 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=2000&q=80'
                }
            },
            "pricing-id": {
                type: 'Pricing',
                props: {
                    id: 'pricing-id',
                    items: [
                        {
                            title: 'Starter',
                            price: '$29',
                            period: '/mo',
                            description: 'Perfect for small businesses',
                            buttonText: 'Get Started',
                            buttonLink: '/contact',
                            isPopular: false,
                            features: [{ text: '5 Projects' }, { text: 'Basic Analytics' }, { text: 'Email Support' }]
                        },
                        {
                            title: 'Professional',
                            price: '$99',
                            period: '/mo',
                            description: 'For growing teams',
                            buttonText: 'Try Pro',
                            buttonLink: '/contact',
                            isPopular: true,
                            ribbonTitle: 'Best Value',
                            features: [{ text: 'Unlimited Projects' }, { text: 'Advanced Analytics' }, { text: 'Priority Support' }, { text: 'Team Collaboration' }]
                        },
                        {
                            title: 'Enterprise',
                            price: 'Custom',
                            period: '',
                            description: 'For large organizations',
                            buttonText: 'Contact Sales',
                            buttonLink: '/contact',
                            isPopular: false,
                            features: [{ text: 'Custom Solutions' }, { text: 'Dedicated Account Manager' }, { text: 'SLA Support' }, { text: 'On-premise Deployment' }]
                        }
                    ]
                }
            },
            "faq-id": {
                type: 'Section',
                props: { id: 'faq-id', title: 'Frequently Asked Questions' },
                children: [
                    {
                        type: 'Accordion',
                        props: {
                            items: [
                                { title: 'Can I change plans anytime?', content: 'Yes, you can upgrade or downgrade your plan at any time.' },
                                { title: 'Do you offer a free trial?', content: 'Yes, we offer a 14-day free trial on all paid plans.' },
                                { title: 'What payment methods do you accept?', content: 'We accept all major credit cards and PayPal.' }
                            ]
                        }
                    }
                ]
            }
        }
    },
    {
        slug: 'contact',
        title: 'Contact Us',
        content: {
            root: { props: { title: 'Contact' }, children: ["hero-id", "form-id", "info-id"] },
            "hero-id": {
                type: 'Hero',
                props: {
                    id: 'hero-id',
                    title: 'Get in Touch',
                    subtitle: 'We are here to answer any questions you may have.',
                    height: 'medium',
                    overlayStyle: 'dark',
                    backgroundImage: 'https://images.unsplash.com/photo-1423666639041-f140481dcad5?auto=format&fit=crop&w=2000&q=80'
                }
            },
            "form-id": {
                type: 'ContactForm',
                props: {
                    id: 'form-id',
                    title: 'Send us a message',
                    subtitle: 'Fill out the form below and we will get back to you shortly.',
                    showName: true,
                    showPhone: true,
                    showSubject: true
                }
            },
            "info-id": {
                type: 'Section',
                props: { id: 'info-id', padding: '8' },
                children: [
                    {
                        type: 'Text',
                        props: {
                            content: '<div style="text-align: center;"><h3>Our Office</h3><p>123 Business Street, Tech City, TC 12345</p><p>Email: contact@ahliweb.com</p><p>Phone: +1 (555) 123-4567</p></div>'
                        }
                    }
                ]
            }
        }
    }
];

async function migrate() {
    console.log('Starting migration of public pages...');

    // Get Primary Tenant
    const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .select('id')
        .eq('slug', 'primary')
        .single();

    if (tenantError || !tenant) {
        console.error('Error fetching primary tenant:', tenantError);
        return;
    }

    const tenantId = tenant.id;
    console.log(`Found Primary Tenant ID: ${tenantId}`);

    for (const page of PAGES) {
        console.log(`Migrating page: ${page.title} (${page.slug})...`);

        // Check if page exists
        const { data: existingPage } = await supabase
            .from('pages')
            .select('id')
            .eq('slug', page.slug)
            .eq('tenant_id', tenantId)
            .single();

        const pageData = {
            title: page.title,
            content: JSON.stringify(page.content), // Storing JSON structure in content as text too
            layout_data: page.content, // Puck JSON goes to layout_data (jsonb)
            status: 'published',
            published_at: new Date().toISOString(),
            tenant_id: tenantId,
            editor_type: 'visual',
            slug: page.slug
        };

        let result;
        if (existingPage) {
            console.log(`Updating existing page ${page.slug}...`);
            result = await supabase
                .from('pages')
                .update(pageData)
                .eq('id', existingPage.id);
        } else {
            console.log(`Creating new page ${page.slug}...`);
            result = await supabase
                .from('pages')
                .insert(pageData);
        }

        if (result.error) {
            console.error(`Error migrating ${page.slug}:`, result.error);
        } else {
            console.log(`Successfully migrated ${page.slug}.`);
        }
    }

    console.log('Migration complete.');
}

migrate();
