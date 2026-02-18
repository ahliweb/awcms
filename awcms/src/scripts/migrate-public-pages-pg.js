import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const connectionString = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;

if (!connectionString) {
    console.error('Error: DATABASE_ADMIN_URL or DATABASE_URL not found in environment variables.');
    process.exit(1);
}

const client = new pg.Client({
    connectionString,
});

const PAGES = [
    {
        slug: 'about',
        title: 'About Us',
        content: {
            root: { props: { title: 'About Us' }, children: [] },
            content: [
                {
                    type: 'Hero',
                    props: {
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
                {
                    type: 'Content',
                    props: {
                        title: 'Our Mission',
                        description: 'To empower businesses with innovative technology solutions that drive growth and efficiency.',
                        align: 'center'
                    }
                },
                {
                    type: 'Stats',
                    props: {
                        items: [
                            { value: '10+', label: 'Years Experience', icon: 'calendar', valueColor: '#2563eb', labelColor: '#64748b' },
                            { value: '500+', label: 'Projects Delivered', icon: 'check-circle', valueColor: '#2563eb', labelColor: '#64748b' },
                            { value: '50+', label: 'Team Members', icon: 'users', valueColor: '#2563eb', labelColor: '#64748b' }
                        ]
                    }
                },
                {
                    type: 'TeamList',
                    props: { count: 3, showSocial: true }
                }
            ]
        }
    },
    {
        slug: 'services',
        title: 'Our Services',
        content: {
            root: { props: { title: 'Services' } },
            content: [
                {
                    type: 'Hero',
                    props: {
                        title: 'Our Services',
                        subtitle: 'Comprehensive solutions tailored to your needs.',
                        height: 'medium',
                        overlayStyle: 'gradient-bottom',
                        backgroundImage: 'https://images.unsplash.com/photo-1504384308090-c54be3855833?auto=format&fit=crop&w=2000&q=80'
                    }
                },
                {
                    type: 'ServicesList',
                    props: { count: 6, columns: 3 }
                },
                {
                    type: 'FeaturesList',
                    props: {
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
                {
                    type: 'TestimonialsList',
                    props: { count: 3, layout: 'grid' }
                }
            ]
        }
    },
    {
        slug: 'pricing',
        title: 'Pricing Plans',
        content: {
            root: { props: { title: 'Pricing' } },
            content: [
                {
                    type: 'Hero',
                    props: {
                        title: 'Simple, Transparent Pricing',
                        subtitle: 'Choose the plan that fits your business needs.',
                        height: 'medium',
                        align: 'center',
                        overlayStyle: 'blur',
                        backgroundImage: 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=2000&q=80'
                    }
                },
                {
                    type: 'Pricing',
                    props: {
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
                {
                    type: 'Section',
                    props: { title: 'Frequently Asked Questions' },
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
            ]
        }
    },
    {
        slug: 'contact',
        title: 'Contact Us',
        content: {
            root: { props: { title: 'Contact' } },
            content: [
                {
                    type: 'Hero',
                    props: {
                        title: 'Get in Touch',
                        subtitle: 'We are here to answer any questions you may have.',
                        height: 'medium',
                        overlayStyle: 'dark',
                        backgroundImage: 'https://images.unsplash.com/photo-1423666639041-f140481dcad5?auto=format&fit=crop&w=2000&q=80'
                    }
                },
                {
                    type: 'ContactForm',
                    props: {
                        title: 'Send us a message',
                        subtitle: 'Fill out the form below and we will get back to you shortly.',
                        showName: true,
                        showPhone: true,
                        showSubject: true
                    }
                },
                {
                    type: 'Section',
                    props: { padding: '8' },
                    children: [
                        {
                            type: 'Text',
                            props: {
                                content: '<div style="text-align: center;"><h3>Our Office</h3><p>123 Business Street, Tech City, TC 12345</p><p>Email: contact@ahliweb.com</p><p>Phone: +1 (555) 123-4567</p></div>'
                            }
                        }
                    ]
                }
            ]
        }
    }
];

async function migrate() {
    console.log('Connecting to database...');
    await client.connect();

    try {
        // Get Primary Tenant
        const res = await client.query('SELECT id FROM tenants WHERE slug = $1', ['primary']);
        let tenantId;

        if (res.rows.length === 0) {
            console.log('Primary tenant not found. Seeding...');
            // Direct insert as backup if RPC fails or too complex via raw SQL
            // Assuming standard columns + id defaulting to uuid_generate_v4()
            const insertRes = await client.query(`
         INSERT INTO tenants (name, slug, type, status) 
         VALUES ($1, $2, $3, $4) 
         RETURNING id
       `, ['Ahliweb CMS', 'primary', 'enterprise', 'active']);
            tenantId = insertRes.rows[0].id;
            console.log(`Seeded Primary Tenant: ${tenantId}`);
        } else {
            tenantId = res.rows[0].id;
            console.log(`Found Primary Tenant ID: ${tenantId}`);
        }

        for (const page of PAGES) {
            console.log(`Migrating page: ${page.title} (${page.slug})...`);

            const pageRes = await client.query('SELECT id FROM pages WHERE slug = $1 AND tenant_id = $2', [page.slug, tenantId]);

            const pageData = [
                page.title,
                JSON.stringify(page.content),
                true,
                tenantId,
                page.slug,
                'page'
            ];

            if (pageRes.rows.length > 0) {
                console.log(`Updating existing page ${page.slug}...`);
                // Assuming content column is named 'content' and is jsonb
                // Also updating title, is_published just in case
                await client.query(`
            UPDATE pages 
            SET title = $1, content = $2, is_published = $3 
            WHERE id = $4
          `, [page.title, JSON.stringify(page.content), true, pageRes.rows[0].id]);
            } else {
                console.log(`Creating new page ${page.slug}...`);
                await client.query(`
            INSERT INTO pages (title, content, is_published, tenant_id, slug, type)
            VALUES ($1, $2, $3, $4, $5, $6)
          `, pageData);
            }
            console.log(`Successfully migrated ${page.slug}.`);
        }

        console.log('Migration complete.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await client.end();
    }
}

migrate();
