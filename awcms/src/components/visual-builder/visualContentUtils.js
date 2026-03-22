import { useVisualContentContext } from './VisualContentContext';

export function useVisualContent(source = 'page') {
  const context = useVisualContentContext();
  return source === 'blog' ? context.blog : context.page;
}

export function createVisualContentResource(record, overrides = {}) {
  if (!record && !overrides) return null;

  return {
    title: overrides.title ?? record?.title ?? '',
    excerpt: overrides.excerpt ?? record?.excerpt ?? record?.meta_description ?? '',
    htmlContent:
      typeof overrides.htmlContent === 'string'
        ? overrides.htmlContent
        : typeof record?.content === 'string'
          ? record.content
          : '',
    featuredImage: overrides.featuredImage ?? record?.featured_image ?? '',
    publishedAt: overrides.publishedAt ?? record?.published_at ?? record?.created_at ?? null,
    categoryName:
      overrides.categoryName
      ?? record?.category?.name
      ?? record?.categories?.name
      ?? record?.main_category?.title
      ?? '',
    tags: overrides.tags ?? record?.tags ?? [],
    authorName:
      overrides.authorName
      ?? record?.author?.full_name
      ?? record?.users?.full_name
      ?? '',
  };
}
