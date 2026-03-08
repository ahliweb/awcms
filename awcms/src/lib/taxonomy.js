const TAXONOMY_MODULES = [
  {
    value: 'content',
    label: 'Shared Content',
    description: 'Reusable across blogs and pages.',
    categoryTypes: ['content'],
    categoryAliases: ['content'],
    tagUsageModules: ['blogs', 'pages'],
  },
  {
    value: 'blogs',
    label: 'Blogs',
    description: 'Editorial posts and articles.',
    categoryTypes: ['blog'],
    categoryAliases: ['blog', 'blogs', 'content'],
    tagUsageModules: ['blogs', 'articles'],
  },
  {
    value: 'pages',
    label: 'Pages',
    description: 'Static and landing pages.',
    categoryTypes: ['page'],
    categoryAliases: ['page', 'pages', 'content'],
    tagUsageModules: ['pages'],
  },
  {
    value: 'products',
    label: 'Products',
    description: 'Commerce categories and labels.',
    categoryTypes: ['product'],
    categoryAliases: ['product', 'products'],
    tagUsageModules: ['products'],
  },
  {
    value: 'product_types',
    label: 'Product Types',
    description: 'Product type metadata and discovery.',
    categoryTypes: [],
    categoryAliases: [],
    tagUsageModules: ['product_types'],
  },
  {
    value: 'portfolio',
    label: 'Portfolio',
    description: 'Case studies and showcase entries.',
    categoryTypes: ['portfolio'],
    categoryAliases: ['portfolio'],
    tagUsageModules: ['portfolio'],
  },
  {
    value: 'announcements',
    label: 'Announcements',
    description: 'Time-sensitive updates and notices.',
    categoryTypes: ['announcement'],
    categoryAliases: ['announcement', 'announcements'],
    tagUsageModules: ['announcements'],
  },
  {
    value: 'promotions',
    label: 'Promotions',
    description: 'Offers and campaign content.',
    categoryTypes: ['promotion'],
    categoryAliases: ['promotion', 'promotions'],
    tagUsageModules: ['promotions'],
  },
  {
    value: 'testimonies',
    label: 'Testimonials',
    description: 'Reviews, quotes, and testimonials.',
    categoryTypes: ['testimony'],
    categoryAliases: ['testimony', 'testimonies'],
    tagUsageModules: ['testimonies'],
  },
  {
    value: 'media',
    label: 'Media Library',
    description: 'Files, albums, and gallery organization.',
    categoryTypes: ['media', 'gallery'],
    categoryAliases: ['media', 'gallery'],
    tagUsageModules: ['photo_gallery', 'video_gallery'],
  },
  {
    value: 'contacts',
    label: 'Contacts',
    description: 'CRM contacts and submissions.',
    categoryTypes: ['contact'],
    categoryAliases: ['contact', 'contacts'],
    tagUsageModules: ['contacts', 'contact_messages'],
  },
];

const TAG_USAGE_LABELS = {
  articles: 'Articles',
  announcements: 'Announcements',
  blogs: 'Blogs',
  contact_messages: 'Messages',
  contacts: 'Contacts',
  pages: 'Pages',
  photo_gallery: 'Photo Gallery',
  portfolio: 'Portfolio',
  product_types: 'Product Types',
  products: 'Products',
  promotions: 'Promotions',
  testimonies: 'Testimonials',
  video_gallery: 'Video Gallery',
};

export const CATEGORY_SCOPE_OPTIONS = TAXONOMY_MODULES.filter((module) => module.categoryTypes.length > 0)
  .map((module) => ({
    value: module.categoryTypes[0],
    label: module.label,
    description: module.description,
  }));

export const TAG_MODULE_OPTIONS = [
  { value: 'all', label: 'All Modules' },
  ...TAXONOMY_MODULES.filter((module) => module.tagUsageModules.length > 0).map((module) => ({
    value: module.value,
    label: module.label,
  })),
];

export function getCategoryTypesForModule(moduleKey) {
  return TAXONOMY_MODULES.find((module) => module.value === moduleKey)?.categoryAliases ?? [];
}

export function getCategoryScopeMeta(type) {
  const match = TAXONOMY_MODULES.find((module) => module.categoryAliases.includes(type));
  return match ?? null;
}

export function getTagUsageMeta(moduleKey) {
  const sharedModule = TAXONOMY_MODULES.find((module) => module.tagUsageModules.includes(moduleKey));
  return {
    key: sharedModule?.value ?? moduleKey,
    label: TAG_USAGE_LABELS[moduleKey] ?? sharedModule?.label ?? moduleKey,
  };
}

export function matchesTagModuleFilter(moduleKey, filterValue) {
  if (!filterValue || filterValue === 'all') return true;

  const sharedModule = TAXONOMY_MODULES.find((module) => module.tagUsageModules.includes(moduleKey));
  return sharedModule?.value === filterValue;
}
