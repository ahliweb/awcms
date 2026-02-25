export const DEFAULT_STITCH_MAX_INPUT_KB = 256;

export const STITCH_ALLOWED_TAGS = [
    'a',
    'article',
    'b',
    'blockquote',
    'br',
    'button',
    'code',
    'div',
    'em',
    'figcaption',
    'figure',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'i',
    'iframe',
    'img',
    'li',
    'ol',
    'p',
    'pre',
    'section',
    'span',
    'strong',
    'table',
    'tbody',
    'td',
    'th',
    'thead',
    'tr',
    'u',
    'ul',
];

export const STITCH_ALLOWED_ATTR = [
    'allow',
    'allowfullscreen',
    'alt',
    'aria-hidden',
    'aria-label',
    'class',
    'colspan',
    'height',
    'href',
    'loading',
    'name',
    'referrerpolicy',
    'rel',
    'role',
    'rowspan',
    'scope',
    'src',
    'target',
    'title',
    'width',
];

export const STITCH_FORBID_TAGS = ['script', 'style', 'noscript', 'form', 'input', 'textarea', 'select'];

export const STITCH_FORBID_ATTR = ['style'];

export const STITCH_ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel):|data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,|[^a-z]|[a-z0-9+.-]+(?:[^a-z0-9+.-:]|$))/i;
