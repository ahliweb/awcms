import DOMPurify from 'dompurify';

export const sanitizeHTML = (html) => {
    if (!html) return { __html: '' };
    return {
        __html: DOMPurify.sanitize(html, {
            ADD_TAGS: ['iframe'], // Allow iframes for embeds if needed (common in CMS)
            ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling', 'target'] // Attributes for iframes and links
        })
    };
};
