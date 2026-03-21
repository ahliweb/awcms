export const BLOG_TRANSLATION_CONFIG = {
  tableName: 'content_translations',
  contentType: 'article',
  locale: 'en',
  fieldMap: {
    title_en: 'title',
    slug_en: 'slug',
    content_en: 'content',
    excerpt_en: 'excerpt',
    meta_description_en: 'meta_description',
  },
};

export function getBlogEditorProps(selectedLanguage = 'id') {
  return {
    translationConfig: BLOG_TRANSLATION_CONFIG,
    selectedLanguage,
  };
}
