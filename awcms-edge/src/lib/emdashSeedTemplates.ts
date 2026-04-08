type JsonRecord = Record<string, unknown>

type ProcessLike = {
  cwd?: () => string
}

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

export type EmdashMarketingPage = {
  sourceId: string
  title: string
  slug: string
  excerpt: string
  content: Record<string, unknown>
  rawPayload: Record<string, unknown>
}

export type EmdashMarketingService = {
  sourceId: string
  title: string
  slug: string
  description: string
  icon?: string | null
  image?: string | null
  link?: string | null
  displayOrder: number
  rawPayload: Record<string, unknown>
}

export type EmdashMarketingTeamMember = {
  sourceId: string
  name: string
  slug: string
  role: string
  image?: string | null
  socialLinks: unknown[]
  displayOrder: number
  rawPayload: Record<string, unknown>
}

export type EmdashMarketingTestimony = {
  sourceId: string
  title: string
  slug: string
  content: string
  authorName: string
  authorPosition: string
  authorImage?: string | null
  rating?: number | null
  rawPayload: Record<string, unknown>
}

export type EmdashPortfolioItem = {
  sourceId: string
  title: string
  slug: string
  description: string
  client: string
  projectDate?: string | null
  images: unknown[]
  tags: unknown
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
  marketing: {
    pages: EmdashMarketingPage[]
    services: EmdashMarketingService[]
    team: EmdashMarketingTeamMember[]
    testimonies: EmdashMarketingTestimony[]
  }
  portfolio: {
    items: EmdashPortfolioItem[]
  }
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
  marketing: {
    pages: [],
    services: [],
    team: [],
    testimonies: [],
  },
  portfolio: {
    items: [],
  },
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

const normalizeMarketingPage = (input: unknown, index: number): EmdashMarketingPage | null => {
  if (!isRecord(input)) return null
  const title = asString(input.title, `Marketing Page ${index + 1}`)
  const slug = slugifySeedValue(asString(input.slug, title), `marketing-page-${index + 1}`)
  return {
    sourceId: asString(input.sourceId, `marketing-page:${slug}`),
    title,
    slug,
    excerpt: asString(input.excerpt),
    content: toRecord(input.content),
    rawPayload: toRecord(input.rawPayload, input),
  }
}

const normalizeMarketingService = (input: unknown, index: number): EmdashMarketingService | null => {
  if (!isRecord(input)) return null
  const title = asString(input.title, `Service ${index + 1}`)
  const slug = slugifySeedValue(asString(input.slug, title), `service-${index + 1}`)
  return {
    sourceId: asString(input.sourceId, `service:${slug}`),
    title,
    slug,
    description: asString(input.description),
    icon: asOptionalString(input.icon),
    image: asOptionalString(input.image),
    link: asOptionalString(input.link),
    displayOrder: asNumber(input.displayOrder ?? input.display_order, index),
    rawPayload: toRecord(input.rawPayload, input),
  }
}

const normalizeMarketingTeamMember = (input: unknown, index: number): EmdashMarketingTeamMember | null => {
  if (!isRecord(input)) return null
  const name = asString(input.name, `Team Member ${index + 1}`)
  const slug = slugifySeedValue(asString(input.slug, name), `team-member-${index + 1}`)
  return {
    sourceId: asString(input.sourceId, `team:${slug}`),
    name,
    slug,
    role: asString(input.role),
    image: asOptionalString(input.image),
    socialLinks: Array.isArray(input.socialLinks) ? input.socialLinks : Array.isArray(input.social_links) ? input.social_links : [],
    displayOrder: asNumber(input.displayOrder ?? input.display_order, index),
    rawPayload: toRecord(input.rawPayload, input),
  }
}

const normalizeMarketingTestimony = (input: unknown, index: number): EmdashMarketingTestimony | null => {
  if (!isRecord(input)) return null
  const title = asString(input.title, `Testimony ${index + 1}`)
  const slug = slugifySeedValue(asString(input.slug, title), `testimony-${index + 1}`)
  const ratingValue = input.rating
  const rating = typeof ratingValue === 'number' && Number.isFinite(ratingValue) ? ratingValue : null
  return {
    sourceId: asString(input.sourceId, `testimony:${slug}`),
    title,
    slug,
    content: asString(input.content),
    authorName: asString(input.authorName ?? input.author_name),
    authorPosition: asString(input.authorPosition ?? input.author_position),
    authorImage: asOptionalString(input.authorImage ?? input.author_image),
    rating,
    rawPayload: toRecord(input.rawPayload, input),
  }
}

const normalizePortfolioItem = (input: unknown, index: number): EmdashPortfolioItem | null => {
  if (!isRecord(input)) return null
  const title = asString(input.title, `Portfolio Item ${index + 1}`)
  const slug = slugifySeedValue(asString(input.slug, title), `portfolio-item-${index + 1}`)
  return {
    sourceId: asString(input.sourceId, `portfolio:${slug}`),
    title,
    slug,
    description: asString(input.description),
    client: asString(input.client),
    projectDate: asOptionalString(input.projectDate ?? input.project_date),
    images: Array.isArray(input.images) ? input.images : [],
    tags: input.tags ?? [],
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

  const marketingRoot = isRecord(importData.marketing) ? importData.marketing : {}
  const portfolioRoot = isRecord(importData.portfolio) ? importData.portfolio : {}
  const marketingPages = (Array.isArray(marketingRoot.pages) ? marketingRoot.pages : [])
    .map((page, index) => normalizeMarketingPage(page, index))
    .filter(Boolean) as EmdashMarketingPage[]
  const marketingServices = (Array.isArray(marketingRoot.services) ? marketingRoot.services : [])
    .map((service, index) => normalizeMarketingService(service, index))
    .filter(Boolean) as EmdashMarketingService[]
  const marketingTeam = (Array.isArray(marketingRoot.team) ? marketingRoot.team : Array.isArray(marketingRoot.teams) ? marketingRoot.teams : [])
    .map((member, index) => normalizeMarketingTeamMember(member, index))
    .filter(Boolean) as EmdashMarketingTeamMember[]
  const marketingTestimonies = (Array.isArray(marketingRoot.testimonies) ? marketingRoot.testimonies : [])
    .map((testimony, index) => normalizeMarketingTestimony(testimony, index))
    .filter(Boolean) as EmdashMarketingTestimony[]
  const portfolioItems = (Array.isArray(portfolioRoot.items) ? portfolioRoot.items : Array.isArray(portfolioRoot.portfolio) ? portfolioRoot.portfolio : [])
    .map((item, index) => normalizePortfolioItem(item, index))
    .filter(Boolean) as EmdashPortfolioItem[]

  const hasBlogContent = blogs.length > 0
  const hasMarketingContent = marketingPages.length > 0
    || marketingServices.length > 0
    || marketingTeam.length > 0
    || marketingTestimonies.length > 0
  const hasPortfolioContent = portfolioItems.length > 0

  const hasSupportedContent = templateSlug === 'blog'
    ? hasBlogContent
    : templateSlug === 'marketing'
      ? hasMarketingContent
      : templateSlug === 'portfolio'
        ? hasPortfolioContent
        : hasBlogContent || hasMarketingContent || hasPortfolioContent

  if (!hasSupportedContent) return null

  return {
    sourceKey: asString(importData.sourceKey || templateRoot.sourceKey, `${templateSlug}:seed`),
    sourceVersion: asString(importData.sourceVersion || templateRoot.sourceVersion || templateRoot.version, 'emdash-template-v1'),
    templateSlug,
    pageTemplate: normalizePageTemplate(importData.pageTemplate || importData.page_template || templateRoot.pageTemplate, templateSlug, widgetAreas),
    blogs,
    widgetAreas,
    marketing: {
      pages: marketingPages,
      services: marketingServices,
      team: marketingTeam,
      testimonies: marketingTestimonies,
    },
    portfolio: {
      items: portfolioItems,
    },
  }
}

export const getEmdashSeedTemplate = (templateSlug: string, importType: string): EmdashSeedTemplate | null => {
  if (templateSlug === 'blog' && importType === 'seed') {
    return BUILTIN_BLOG_SEED_TEMPLATE
  }

  return null
}

const isLikelyLocalPath = (locator: string) => {
  if (!locator) return false
  if (locator.startsWith('file://')) return true
  if (locator.startsWith('./') || locator.startsWith('../')) return true
  if (locator.startsWith('/')) return true
  return /^[A-Za-z]:[\\/]/.test(locator)
}

const readLocalSeedFile = async (locator: string) => {
  const runtimeProcess = (globalThis as typeof globalThis & { process?: ProcessLike }).process
  const cwd = typeof runtimeProcess?.cwd === 'function' ? runtimeProcess.cwd() : null
  if (!cwd) {
    throw new Error('Local file-path seed locators require a Node-compatible runtime with process.cwd()')
  }

  const [{ readFile }, pathModule, urlModule] = await Promise.all([
    (0, eval)("import('node:fs/promises')"),
    (0, eval)("import('node:path')"),
    (0, eval)("import('node:url')"),
  ])

  const resolvedPath = locator.startsWith('file://')
    ? urlModule.fileURLToPath(locator)
    : pathModule.resolve(cwd, locator)

  return readFile(resolvedPath, 'utf8')
}

export const loadEmdashExternalSeedTemplate = async (params: {
  sourceLocator: string | null
  templateSlug: string
}): Promise<EmdashSeedTemplate | null> => {
  const locator = asString(params.sourceLocator).trim()
  if (!locator) return null

  if (isLikelyLocalPath(locator)) {
    const payload = JSON.parse(await readLocalSeedFile(locator))
    const normalized = normalizeSeedTemplate(payload, params.templateSlug)
    if (!normalized) {
      throw new Error('Local EmDash seed.json is invalid or missing blog seed content')
    }

    return normalized
  }

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
