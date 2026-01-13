import DOMPurify from 'isomorphic-dompurify';

export const sanitizeHtml = (html: string): string => {
    // Basic sanitization config
    // We allow standard tags but strip scripts, iframes (unless whitelisted later), and event handlers.
    return DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        // Add specific attributes if needed for layout, e.g. class, style
        ADD_TAGS: ['iframe'], // Example: if we want to allow standard embeds, but be careful
        ADD_ATTR: ['target', 'allow', 'allowfullscreen', 'frameborder', 'scrolling'], // For iframes
    });
};
