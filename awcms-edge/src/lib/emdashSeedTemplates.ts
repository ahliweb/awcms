type JsonRecord = Record<string, unknown>

export type EmdashSeedWidget = {
  sourceId: string
  name: string
  type: string
  order: number
  showTitle?: boolean
  content?: string | null
  config?: Record<string, unknown>
  rawPayload: Record<string, unknown>
}

export type EmdashSeedWidgetArea = {
  sourceId: string
  slug: string
  name: string
  widgets: EmdashSeedWidget[]
  rawPayload: Record<string, unknown>
}

export type EmdashSeedBlog = {
  sourceId: string
  title: string
  slug: string
  excerpt: string
  content: string
  featuredImage?: string | null
  rawPayload: Record<string, unknown>
}

export type EmdashSeedTemplate = {
  sourceKey: string
  sourceVersion: string
  templateSlug: string
  pageTemplate: {
    sourceId: string
    title: string
    slug: string
    excerpt: string
    rawPayload: Record<string, unknown>
    content: Record<string, unknown>
  }
  blogs: EmdashSeedBlog[]
  widgetAreas: EmdashSeedWidgetArea[]
}

const isRecord = (value: unknown): value is JsonRecord => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const asString = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback

const asOptionalString = (value: unknown) => typeof value === 'string' ? value : null

const asBoolean = (value: unknown, fallback = false) => typeof value === 'boolean' ? value : fallback

const asNumber = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback

const toRecord = (value: unknown, fallback: JsonRecord = {}) => isRecord(value) ? value : fallback

const slugifySeedValue = (value: string, fallback: string) => {
  const normalized = String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || fallback
}

const blogSinglePostContent = {
  root: {
    props: {
      title: 'EmDash Blog Template',
    },
    children: [
      {
        type: 'ContentTitle',
        props: {
          source: 'blog',
          headingLevel: 'h1',
          alignment: 'left',
        },
      },
      {
        type: 'ContentMeta',
        props: {
          source: 'blog',
          showDate: true,
          showAuthor: true,
          showCategory: true,
          showTags: true,
          alignment: 'left',
        },
      },
      {
        type: 'ContentFeaturedImage',
        props: {
          source: 'blog',
          aspectRatio: 'video',
          rounded: 'xl',
          showCaption: false,
        },
      },
      {
        type: 'ContentBody',
        props: {
          source: 'blog',
        },
      },
      {
        type: 'WidgetArea',
        props: {
          area: 'emdash-blog-sidebar',
          title: 'Sidebar',
        },
      },
    ],
  },
}

const BUILTIN_BLOG_SEED_TEMPLATE: EmdashSeedTemplate = {
  sourceKey: 'blog:seed',
  sourceVersion: 'emdash-template-v1',
  templateSlug: 'blog',
  pageTemplate: {
    sourceId: 'page:single-post',
    title: 'EmDash Single Post Template',
    slug: 'emdash-single-post',
    excerpt: 'Seeded single-post template for EmDash blog imports.',
    rawPayload: {
      pageType: 'single_post',
      origin: 'emdash.seed',
    },
    content: blogSinglePostContent,
  },
  blogs: [
    {
      sourceId: 'blog:welcome-to-emdash',
      title: 'Welcome to EmDash in AWCMS',
      slug: 'welcome-to-emdash',
      excerpt: 'A seeded blog post proving the first EmDash tenant import path from source payload to public rendering.',
      content:
        '<p>EmDash content now lands in tenant-scoped AWCMS records through a replayable import flow.</p><p>This seed verifies blog creation, widget-area preservation, and public single-post rendering from one atomic import step.</p><p>Future waves can extend this same contract to marketing and portfolio templates without changing the foundation tables.</p>',
      featuredImage: 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=1600&q=80',
      rawPayload: {
        contentType: 'blog',
        componentId: 'core:post',
        schemaVersion: 'emdash-template-v1',
      },
    },
  ],
  widgetAreas: [
    {
      sourceId: 'widget-area:emdash-blog-sidebar',
      slug: 'emdash-blog-sidebar',
      name: 'EmDash Blog Sidebar',
      rawPayload: {
        componentId: 'core:widget-area',
        schemaVersion: 'emdash-template-v1',
      },
      widgets: [
        {
          sourceId: 'widget:sidebar-search',
          name: 'Search Posts',
          type: 'search',
          order: 0,
          showTitle: true,
          config: {
            placeholder: 'Search posts',
          },
          rawPayload: {
            componentId: 'core:search',
            schemaVersion: 'emdash-template-v1',
          },
        },
        {
          sourceId: 'widget:sidebar-content',
          name: 'About This Import',
          type: 'content',
          order: 1,
          showTitle: true,
          config: {},
          rawPayload: {
            componentId: 'core:content',
            schemaVersion: 'emdash-template-v1',
            content: [
              {
                children: [
                  {
                    text: 'This sidebar was imported from the EmDash foundation flow. The original payload is preserved on the widget record.',
                  },
                ],
              },
            ],
          },
        },
        {
          sourceId: 'widget:sidebar-links',
          name: 'Quick Links',
          type: 'links',
          order: 2,
          showTitle: true,
          config: {
            items: [
              { title: 'All Blogs', url: '/id/blogs' },
              { title: 'Back to Home', url: '/id' },
            ],
          },
          rawPayload: {
            componentId: 'core:links',
            schemaVersion: 'emdash-template-v1',
          },
        },
      ],
    },
  ],
}

const normalizeWidget = (input: unknown, index: number): EmdashSeedWidget | null => {
  if (!isRecord(input)) return null

  const rawPayload = toRecord(input.rawPayload, input)
  const config = toRecord(input.config)
  const content = asOptionalString(input.content)
  const componentId = asString(rawPayload.componentId || input.componentId, '')
  const normalizedType = asString(input.type)
    || (componentId === 'core:recent-posts' ? 'recent_posts' : '')
    || (componentId === 'core:widget-area' ? 'content' : '')
    || (componentId.startsWith('core:') ? componentId.replace('core:', '').replace(/-/g, '_') : '')
    || 'content'

  return {
    sourceId: asString(input.sourceId, `widget:${slugifySeedValue(asString(input.name, normalizedType), 'item')}:${index}`),
    name: asString(input.name, normalizedType),
    type: normalizedType,
    order: asNumber(input.order, index),
    showTitle: asBoolean(input.showTitle, true),
    content,
    config,
    rawPayload,
  }
}

const normalizeWidgetArea = (input: unknown, index: number): EmdashSeedWidgetArea | null => {
  if (!isRecord(input)) return null

  const slug = slugifySeedValue(asString(input.slug, asString(input.name, `widget-area-${index}`)), `widget-area-${index}`)
  const widgetsSource = Array.isArray(input.widgets)
    ? input.widgets
    : Array.isArray(input.items)
      ? input.items
      : []

  return {
    sourceId: asString(input.sourceId, `widget-area:${slug}`),
    slug,
    name: asString(input.name, slug),
    widgets: widgetsSource
      .map((widget, widgetIndex) => normalizeWidget(widget, widgetIndex))
      .filter(Boolean) as EmdashSeedWidget[],
    rawPayload: toRecord(input.rawPayload, input),
  }
}

const normalizeBlog = (input: unknown, index: number): EmdashSeedBlog | null => {
  if (!isRecord(input)) return null

  const title = asString(input.title, `Imported Blog ${index + 1}`)
  const slug = slugifySeedValue(asString(input.slug, title), `imported-blog-${index + 1}`)

  return {
    sourceId: asString(input.sourceId, `blog:${slug}`),
    title,
    slug,
    excerpt: asString(input.excerpt),
    content: asString(input.content),
    featuredImage: asOptionalString(input.featuredImage || input.featured_image),
    rawPayload: toRecord(input.rawPayload, input),
  }
}

const normalizePageTemplate = (input: unknown, templateSlug: string, widgetAreas: EmdashSeedWidgetArea[]) => {
  const fallbackAreaSlug = widgetAreas[0]?.slug || `${templateSlug}-sidebar`
  const fallback = {
    sourceId: 'page:single-post',
    title: 'EmDash Single Post Template',
    slug: `emdash-${templateSlug}-single-post`,
    excerpt: `Seeded single-post template for ${templateSlug} imports.`,
    rawPayload: {
      pageType: 'single_post',
      origin: 'emdash.seed',
    },
    content: {
      ...blogSinglePostContent,
      root: {
        ...blogSinglePostContent.root,
        children: (blogSinglePostContent.root.children || []).map((block) => (
          isRecord(block)
            && block.type === 'WidgetArea'
            && isRecord(block.props)
            ? { ...block, props: { ...block.props, area: fallbackAreaSlug } }
            : block
        )),
      },
    },
  }

  if (!isRecord(input)) return fallback

  const content = toRecord(input.content, fallback.content)
  return {
    sourceId: asString(input.sourceId, fallback.sourceId),
    title: asString(input.title, fallback.title),
    slug: slugifySeedValue(asString(input.slug, fallback.slug), fallback.slug),
    excerpt: asString(input.excerpt, fallback.excerpt),
    rawPayload: toRecord(input.rawPayload, input),
    content,
  }
}

const normalizeSeedTemplate = (input: unknown, fallbackTemplateSlug: string): EmdashSeedTemplate | null => {
  if (!isRecord(input)) return null

  const templateRoot = isRecord(input.seed)
    ? input.seed
    : isRecord(input.template)
      ? input.template
      : input

  const importData = isRecord(templateRoot.import)
    ? templateRoot.import
    : templateRoot

  const templateSlug = asString(importData.templateSlug || templateRoot.templateSlug, fallbackTemplateSlug || 'blog')
  const widgetAreasSource = Array.isArray(importData.widgetAreas)
    ? importData.widgetAreas
    : Array.isArray(importData.widget_areas)
      ? importData.widget_areas
      : []
  const blogsSource = Array.isArray(importData.blogs)
    ? importData.blogs
    : Array.isArray(importData.posts)
      ? importData.posts
      : []

  const widgetAreas = widgetAreasSource
    .map((area, index) => normalizeWidgetArea(area, index))
    .filter(Boolean) as EmdashSeedWidgetArea[]
  const blogs = blogsSource
    .map((blog, index) => normalizeBlog(blog, index))
    .filter(Boolean) as EmdashSeedBlog[]

  if (!blogs.length) return null

  return {
    sourceKey: asString(importData.sourceKey || templateRoot.sourceKey, `${templateSlug}:seed`),
    sourceVersion: asString(importData.sourceVersion || templateRoot.sourceVersion || templateRoot.version, 'emdash-template-v1'),
    templateSlug,
    pageTemplate: normalizePageTemplate(importData.pageTemplate || importData.page_template || templateRoot.pageTemplate, templateSlug, widgetAreas),
    blogs,
    widgetAreas,
  }
}

export const getEmdashSeedTemplate = (templateSlug: string, importType: string): EmdashSeedTemplate | null => {
  if (templateSlug === 'blog' && importType === 'seed') {
    return BUILTIN_BLOG_SEED_TEMPLATE
  }

  return null
}

export const loadEmdashExternalSeedTemplate = async (params: {
  sourceLocator: string | null
  templateSlug: string
}): Promise<EmdashSeedTemplate | null> => {
  const locator = asString(params.sourceLocator).trim()
  if (!locator) return null

  let url: URL
  try {
    url = new URL(locator)
  } catch {
    return null
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return null
  }

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch external EmDash seed: ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  const normalized = normalizeSeedTemplate(payload, params.templateSlug)
  if (!normalized) {
    throw new Error('External EmDash seed.json is invalid or missing blog seed content')
  }

  return normalized
}
