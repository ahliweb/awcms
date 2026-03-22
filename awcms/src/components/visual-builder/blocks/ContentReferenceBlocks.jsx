import { Calendar, Image as ImageIcon, Tag, User } from 'lucide-react';
import { sanitizeHTML } from '@/utils/sanitize';
import { useVisualContent } from '../visualContentUtils';

const SOURCE_OPTIONS = [
  { label: 'Page', value: 'page' },
  { label: 'Blog', value: 'blog' },
];

const ALIGNMENT_CLASSES = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

const META_ALIGNMENT_CLASSES = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
};

function Placeholder({ title, description }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
      <p className="font-semibold text-slate-700">{title}</p>
      <p className="mt-1">{description}</p>
    </div>
  );
}

function useResolvedContent(source) {
  return useVisualContent(source);
}

export function ContentTitleBlock({
  source = 'page',
  headingLevel = 'h1',
  alignment = 'left',
  fallbackText = 'Untitled content',
}) {
  const content = useResolvedContent(source);
  const TagName = headingLevel;
  const title = content?.title || fallbackText;
  const alignmentClass = ALIGNMENT_CLASSES[alignment] || ALIGNMENT_CLASSES.left;

  return (
    <TagName className={`${alignmentClass} text-4xl font-bold tracking-tight text-slate-900`}>
      {title}
    </TagName>
  );
}

export function ContentExcerptBlock({
  source = 'page',
  alignment = 'left',
  fallbackText = 'Add an excerpt or summary to improve this layout.',
}) {
  const content = useResolvedContent(source);
  const excerpt = content?.excerpt || fallbackText;
  const alignmentClass = ALIGNMENT_CLASSES[alignment] || ALIGNMENT_CLASSES.left;

  return (
    <p className={`${alignmentClass} text-lg leading-relaxed text-slate-600`}>
      {excerpt}
    </p>
  );
}

export function ContentFeaturedImageBlock({
  source = 'page',
  aspectRatio = 'video',
  rounded = 'xl',
  showCaption = false,
}) {
  const content = useResolvedContent(source);
  const src = content?.featuredImage;
  const aspectClass = aspectRatio === 'square' ? 'aspect-square' : aspectRatio === 'portrait' ? 'aspect-[3/4]' : 'aspect-video';
  const radiusClass = rounded === 'none' ? 'rounded-none' : rounded === 'lg' ? 'rounded-lg' : rounded === '2xl' ? 'rounded-2xl' : 'rounded-xl';

  if (!src) {
    return (
      <div className={`flex ${aspectClass} items-center justify-center border border-dashed border-slate-300 bg-slate-50 text-slate-400 ${radiusClass}`}>
        <div className="text-center">
          <ImageIcon className="mx-auto mb-2 h-8 w-8" />
          <p className="text-sm font-medium">No featured image</p>
        </div>
      </div>
    );
  }

  return (
    <figure className="space-y-2">
      <img src={src} alt={content?.title || ''} className={`w-full object-cover shadow-sm ${aspectClass} ${radiusClass}`} />
      {showCaption && content?.title ? (
        <figcaption className="text-sm text-slate-500">{content.title}</figcaption>
      ) : null}
    </figure>
  );
}

export function ContentBodyBlock({
  source = 'page',
  emptyState = 'This block renders rich text content from the selected record.',
}) {
  const content = useResolvedContent(source);

  if (!content?.htmlContent) {
    return <Placeholder title="No rich text content" description={emptyState} />;
  }

  return (
    <div
      className="prose prose-slate max-w-none"
      dangerouslySetInnerHTML={sanitizeHTML(content.htmlContent)}
    />
  );
}

export function ContentMetaBlock({
  source = 'page',
  showDate = true,
  showAuthor = true,
  showCategory = true,
  showTags = true,
  alignment = 'left',
}) {
  const content = useResolvedContent(source);
  const publishedLabel = content?.publishedAt
    ? new Date(content.publishedAt).toLocaleDateString()
    : null;
  const tags = Array.isArray(content?.tags)
    ? content.tags.map((tag) => (typeof tag === 'string' ? { name: tag } : tag)).filter(Boolean)
    : [];

  if (!publishedLabel && !content?.authorName && !content?.categoryName && tags.length === 0) {
    return <Placeholder title="No metadata available" description="Publish the content or enrich its metadata to populate this block." />;
  }

  return (
    <div className={`flex flex-wrap items-center gap-3 text-sm text-slate-500 ${META_ALIGNMENT_CLASSES[alignment] || META_ALIGNMENT_CLASSES.left}`}>
      {showDate && publishedLabel ? (
        <span className="inline-flex items-center gap-1.5"><Calendar className="h-4 w-4" />{publishedLabel}</span>
      ) : null}
      {showAuthor && content?.authorName ? (
        <span className="inline-flex items-center gap-1.5"><User className="h-4 w-4" />{content.authorName}</span>
      ) : null}
      {showCategory && content?.categoryName ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{content.categoryName}</span>
      ) : null}
      {showTags && tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {tags.map((tag, index) => (
            <span key={`${tag.slug || tag.name || 'tag'}-${index}`} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-xs">
              <Tag className="h-3 w-3" />
              {tag.name || tag.slug}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const ContentTitleBlockFields = {
  source: { type: 'select', label: 'Source', options: SOURCE_OPTIONS },
  headingLevel: {
    type: 'select',
    label: 'Heading Level',
    options: [
      { label: 'H1', value: 'h1' },
      { label: 'H2', value: 'h2' },
      { label: 'H3', value: 'h3' },
    ],
  },
  alignment: {
    type: 'select',
    label: 'Alignment',
    options: [
      { label: 'Left', value: 'left' },
      { label: 'Center', value: 'center' },
      { label: 'Right', value: 'right' },
    ],
  },
  fallbackText: { type: 'text', label: 'Fallback Text' },
};

export const ContentExcerptBlockFields = {
  source: { type: 'select', label: 'Source', options: SOURCE_OPTIONS },
  alignment: {
    type: 'select',
    label: 'Alignment',
    options: [
      { label: 'Left', value: 'left' },
      { label: 'Center', value: 'center' },
      { label: 'Right', value: 'right' },
    ],
  },
  fallbackText: { type: 'textarea', label: 'Fallback Text' },
};

export const ContentFeaturedImageBlockFields = {
  source: { type: 'select', label: 'Source', options: SOURCE_OPTIONS },
  aspectRatio: {
    type: 'select',
    label: 'Aspect Ratio',
    options: [
      { label: 'Video', value: 'video' },
      { label: 'Square', value: 'square' },
      { label: 'Portrait', value: 'portrait' },
    ],
  },
  rounded: {
    type: 'select',
    label: 'Rounded',
    options: [
      { label: 'None', value: 'none' },
      { label: 'Large', value: 'lg' },
      { label: 'XL', value: 'xl' },
      { label: '2XL', value: '2xl' },
    ],
  },
  showCaption: {
    type: 'radio',
    label: 'Show Caption',
    options: [
      { label: 'Yes', value: true },
      { label: 'No', value: false },
    ],
  },
};

export const ContentBodyBlockFields = {
  source: { type: 'select', label: 'Source', options: SOURCE_OPTIONS },
  emptyState: { type: 'textarea', label: 'Empty State Message' },
};

export const ContentMetaBlockFields = {
  source: { type: 'select', label: 'Source', options: SOURCE_OPTIONS },
  alignment: {
    type: 'select',
    label: 'Alignment',
    options: [
      { label: 'Left', value: 'left' },
      { label: 'Center', value: 'center' },
      { label: 'Right', value: 'right' },
    ],
  },
  showDate: {
    type: 'radio',
    label: 'Show Date',
    options: [
      { label: 'Yes', value: true },
      { label: 'No', value: false },
    ],
  },
  showAuthor: {
    type: 'radio',
    label: 'Show Author',
    options: [
      { label: 'Yes', value: true },
      { label: 'No', value: false },
    ],
  },
  showCategory: {
    type: 'radio',
    label: 'Show Category',
    options: [
      { label: 'Yes', value: true },
      { label: 'No', value: false },
    ],
  },
  showTags: {
    type: 'radio',
    label: 'Show Tags',
    options: [
      { label: 'Yes', value: true },
      { label: 'No', value: false },
    ],
  },
};
