/**
 * Shared sanitize config for AWCMS public portals.
 *
 * This module intentionally has no third-party runtime dependency so it can
 * be imported from linked local packages without module-resolution issues.
 */

export const SANITIZE_ALLOWED_TAGS = [
    'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'del', 'div',
    'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 'section', 'span',
    'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'th', 'thead',
    'tr', 'u', 'ul',
];

export const SANITIZE_ALLOWED_ATTRIBUTES = {
    '*': ['class', 'aria-label', 'aria-hidden', 'role'],
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan', 'scope'],
};

export const SANITIZE_BASE_OPTIONS = {
    allowedTags: SANITIZE_ALLOWED_TAGS,
    allowedAttributes: SANITIZE_ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    disallowedTagsMode: 'discard' as const,
    parseStyleAttributes: false,
};
