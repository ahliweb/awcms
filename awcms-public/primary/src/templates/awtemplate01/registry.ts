/**
 * awtemplate01 Component Registry
 * Registers all template components for Puck visual builder
 */

import { z } from 'zod';
import type { ComponentType } from 'react';

// Import components
import { Container } from './components/layout/Container';
import { Section } from './components/layout/Section';
import { Grid } from './components/layout/Grid';
import { RichTextBlock } from './components/content/RichTextBlock';
import { HeroBlock } from './components/content/HeroBlock';
import { MediaBlock } from './components/content/MediaBlock';
import { CTABlock } from './components/content/CTABlock';
import { Card } from './components/content/Card';
import { Menu } from './components/navigation/Menu';
import { Breadcrumbs } from './components/navigation/Breadcrumbs';

// --- Schemas ---

export const ContainerSchema = z.object({
    maxWidth: z.enum(['sm', 'md', 'lg', 'xl', '2xl', 'full']).default('xl'),
    padding: z.enum(['none', 'sm', 'md', 'lg']).default('md'),
});

export const SectionSchema = z.object({
    variant: z.enum(['default', 'secondary', 'dark', 'accent']).default('default'),
    paddingY: z.enum(['none', 'sm', 'md', 'lg', 'xl']).default('lg'),
    fullWidth: z.boolean().default(false),
});

export const GridSchema = z.object({
    columns: z.number().min(1).max(12).default(3),
    gap: z.enum(['none', 'sm', 'md', 'lg']).default('md'),
    responsive: z.boolean().default(true),
});

export const RichTextBlockSchema = z.object({
    content: z.any(), // TipTap JSON document
    align: z.enum(['left', 'center', 'right']).default('left'),
});

export const HeroBlockSchema = z.object({
    title: z.string().min(1),
    subtitle: z.string().optional(),
    backgroundImage: z.string().optional(),
    buttonText: z.string().optional(),
    buttonLink: z.string().optional(),
    alignment: z.enum(['left', 'center', 'right']).default('center'),
    overlay: z.boolean().default(true),
    height: z.enum(['small', 'medium', 'large', 'full']).default('large'),
});

export const MediaBlockSchema = z.object({
    type: z.enum(['image', 'video']).default('image'),
    src: z.string().min(1),
    alt: z.string().optional(),
    caption: z.string().optional(),
    aspectRatio: z.enum(['auto', '16:9', '4:3', '1:1', '3:2']).default('auto'),
    rounded: z.boolean().default(true),
});

export const CTABlockSchema = z.object({
    title: z.string(),
    description: z.string().optional(),
    buttonText: z.string().default('Get Started'),
    buttonLink: z.string().default('#'),
    variant: z.enum(['primary', 'secondary', 'outline']).default('primary'),
    align: z.enum(['left', 'center', 'right']).default('center'),
});

export const CardSchema = z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    imageUrl: z.string().optional(),
    linkText: z.string().optional(),
    linkUrl: z.string().optional(),
    variant: z.enum(['default', 'outline', 'ghost']).default('default'),
});

export const MenuSchema = z.object({
    menuId: z.string().optional(),
    variant: z.enum(['horizontal', 'vertical']).default('horizontal'),
});

export const BreadcrumbsSchema = z.object({
    separator: z.string().default('/'),
    showHome: z.boolean().default(true),
});

// --- Registry Type ---

type RegistryItem<T = any> = {
    component: ComponentType<T>;
    schema: z.ZodType<T>;
    label: string;
    category: 'layout' | 'content' | 'navigation';
};

// --- Registry ---

export const awtemplate01Registry: Record<string, RegistryItem> = {
    'awt01/container': {
        component: Container,
        schema: ContainerSchema,
        label: 'Container',
        category: 'layout',
    },
    'awt01/section': {
        component: Section,
        schema: SectionSchema,
        label: 'Section',
        category: 'layout',
    },
    'awt01/grid': {
        component: Grid,
        schema: GridSchema,
        label: 'Grid',
        category: 'layout',
    },
    'awt01/richtext': {
        component: RichTextBlock,
        schema: RichTextBlockSchema,
        label: 'Rich Text',
        category: 'content',
    },
    'awt01/hero': {
        component: HeroBlock,
        schema: HeroBlockSchema,
        label: 'Hero',
        category: 'content',
    },
    'awt01/media': {
        component: MediaBlock,
        schema: MediaBlockSchema,
        label: 'Media',
        category: 'content',
    },
    'awt01/cta': {
        component: CTABlock,
        schema: CTABlockSchema,
        label: 'Call to Action',
        category: 'content',
    },
    'awt01/card': {
        component: Card,
        schema: CardSchema,
        label: 'Card',
        category: 'content',
    },
    'awt01/menu': {
        component: Menu,
        schema: MenuSchema,
        label: 'Menu',
        category: 'navigation',
    },
    'awt01/breadcrumbs': {
        component: Breadcrumbs,
        schema: BreadcrumbsSchema,
        label: 'Breadcrumbs',
        category: 'navigation',
    },
};

export const getAwtemplate01Component = (type: string) => {
    return awtemplate01Registry[type];
};
