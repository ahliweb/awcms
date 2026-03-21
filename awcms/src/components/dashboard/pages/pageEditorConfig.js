export const PAGE_TRANSLATION_CONFIG = {
  tableName: 'content_translations',
  contentType: 'page',
  locale: 'en',
  fieldMap: {
    title_en: 'title',
    slug_en: 'slug',
    content_en: 'content',
    excerpt_en: 'excerpt',
    meta_description_en: 'meta_description',
  },
};

export function getPageEditorProps(selectedLanguage = 'id') {
  return {
    translationConfig: PAGE_TRANSLATION_CONFIG,
    selectedLanguage,
  };
}
