/**
 * Simple HTML sanitizer.
 * For production, consider using 'isomorphic-dompurify' or similar libraries.
 * Currently, this assumes content from the Admin Panel is trusted.
 */
export const sanitizeHTML = (html: string | null | undefined): string => {
  if (!html) return "";
  return html;
};
