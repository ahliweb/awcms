import { sanitizeHTML } from '@/utils/sanitize';

export const RawHTMLBlockFields = {
    html: {
        type: 'textarea',
        label: 'Raw HTML',
    },
};

export const RawHTMLBlock = ({ html, content }) => {
    const rawHtml = html || content || '';

    return (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-amber-700">
                Raw HTML Fallback (Sanitized)
            </div>
            <div
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={sanitizeHTML(rawHtml)}
            />
        </div>
    );
};
