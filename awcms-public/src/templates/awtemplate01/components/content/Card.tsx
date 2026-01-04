import React from 'react';
import type { ComponentConfig } from "@measured/puck";
import { z } from "astro/zod";
import { cn } from "@/lib/utils";

export interface CardProps {
    title?: string;
    description?: string;
    imageUrl?: string;
    linkText?: string;
    linkUrl?: string;
    variant?: 'default' | 'outline' | 'ghost';
}

export const Card: React.FC<CardProps> = ({
    title,
    description,
    imageUrl,
    linkText,
    linkUrl,
    variant = 'default'
}) => {
    return (
        <div className={cn(
            "overflow-hidden rounded-lg transition-all duration-200",
            variant === 'default' && "bg-card text-card-foreground shadow-sm border border-border",
            variant === 'outline' && "border border-border bg-transparent",
            variant === 'ghost' && "bg-transparent shadow-none"
        )}>
            {imageUrl && (
                <div className="aspect-video w-full overflow-hidden">
                    <img
                        src={imageUrl}
                        alt={title || "Card image"}
                        className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
                        loading="lazy"
                    />
                </div>
            )}
            <div className="p-6">
                {title && <h3 className="mb-2 text-xl font-semibold tracking-tight">{title}</h3>}
                {description && <p className="mb-4 text-muted-foreground">{description}</p>}
                {linkUrl && linkText && (
                    <a
                        href={linkUrl}
                        className="inline-flex items-center text-sm font-medium text-primary hover:underline"
                    >
                        {linkText}
                        <svg
                            className="ml-1 h-4 w-4"
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M5 12h14" />
                            <path d="m12 5 7 7-7 7" />
                        </svg>
                    </a>
                )}
            </div>
        </div>
    );
};

export const CardConfig: ComponentConfig<CardProps> = {
    label: "Card",
    fields: {
        title: { type: "text", label: "Title" },
        description: { type: "textarea", label: "Description" },
        imageUrl: { type: "text", label: "Image URL" },
        linkText: { type: "text", label: "Link Text" },
        linkUrl: { type: "text", label: "Link URL" },
        variant: {
            type: "select",
            options: [
                { label: "Default", value: "default" },
                { label: "Outline", value: "outline" },
                { label: "Ghost", value: "ghost" },
            ],
            label: "Variant"
        }
    },
    defaultProps: {
        title: "Card Title",
        description: "This is a brief description of the card content.",
        linkText: "Learn More",
        variant: "default"
    },
    render: (props) => <Card {...props} />
};
