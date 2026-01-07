# Performance Optimization

This guide covers performance optimization strategies for AWCMS, ensuring fast load times and smooth user experience.

---

## Bundle Optimization

### Code Splitting

All route components use `React.lazy()` for automatic code splitting:

```javascript
// src/routes/MainRouter.jsx
const Articles = lazy(() => import('@/pages/dashboard/ArticlesPage'));
const Products = lazy(() => import('@/pages/dashboard/ProductsPage'));
```

### Bundle Size Targets

| Metric | Target | Check Command |
| -------- | -------- | --------------- |
| Initial JS (gzipped) | < 200 KB | `npm run build` |
| Total JS (gzipped) | < 500 KB | `npm run build` |
| CSS (gzipped) | < 50 KB | `npm run build` |

### Tree Shaking

- Import only what you need: `import { Button } from '@/components/ui/button'`
- Avoid barrel imports: Use direct component paths
- Use ES modules for all internal code

---

## React Optimization

### Memoization Guidelines

```javascript
// Use useMemo for expensive computations
const filteredItems = useMemo(() => 
  items.filter(item => item.name.includes(query)),
  [items, query]
);

// Use useCallback for stable function references
const handleClick = useCallback((id) => {
  setSelectedId(id);
}, []);

// Use React.memo for pure components
const ListItem = React.memo(({ item }) => (
  <div>{item.name}</div>
));
```

### When NOT to Optimize

- Simple calculations (basic filters, maps)
- Components that always re-render with parent
- Event handlers that don't cause child re-renders

### Virtual Lists

For lists > 100 items, consider virtualization:

```javascript
import { useVirtualizer } from '@tanstack/react-virtual';
```

---

## Database Optimization

### Query Efficiency

```javascript
// ❌ Bad: Fetch all columns
const { data } = await supabase.from('articles').select('*');

// ✅ Good: Fetch only needed columns
const { data } = await supabase.from('articles').select('id, title, slug');
```

### Pagination

Always paginate large datasets:

```javascript
const { data } = await supabase
  .from('articles')
  .select('id, title', { count: 'exact' })
  .range(0, 9)  // First 10 items
  .order('created_at', { ascending: false });
```

### Index Recommendations

| Table | Recommended Indexes |
| ------- | --------------------- |
| `articles` | `tenant_id`, `status`, `created_at` |
| `users` | `tenant_id`, `email`, `role_id` |
| `pages` | `tenant_id`, `slug`, `status` |
| `products` | `tenant_id`, `sku`, `status` |

### RLS Performance

- Use simple RLS policies where possible
- Avoid complex subqueries in RLS
- Index columns used in RLS conditions

---

## Image Optimization

### Upload Guidelines

- Max file size: 5 MB
- Preferred formats: WebP, AVIF, PNG
- Lazy load images below the fold

### Supabase Transformations

```javascript
// Get optimized image URL
const imageUrl = supabase.storage
  .from('media')
  .getPublicUrl('image.jpg', {
    transform: { width: 800, height: 600, quality: 80 }
  });
```

### Cloudflare R2 Integration

- Use R2 for large media files
- Configure cache headers for static assets
- Use Image Resizing API when available

---

## Caching Strategies

### Browser Caching

| Asset Type | Cache Duration |
| ------------ | ---------------- |
| JS/CSS (hashed) | 1 year |
| Images | 1 month |
| HTML | No cache |

### Supabase Cache

- Enable PostgREST caching for read-heavy tables
- Use `stale-while-revalidate` pattern for dashboard data

### TanStack Query (React Query)

```javascript
const { data } = useQuery({
  queryKey: ['articles', tenantId],
  queryFn: () => fetchArticles(tenantId),
  staleTime: 5 * 60 * 1000,  // 5 minutes
  cacheTime: 30 * 60 * 1000, // 30 minutes
});
```

---

## Core Web Vitals Targets

| Metric | Target | Description |
| -------- | -------- | ------------- |
| **LCP** | < 2.5s | Largest Contentful Paint |
| **FID** | < 100ms | First Input Delay |
| **CLS** | < 0.1 | Cumulative Layout Shift |
| **TTFB** | < 600ms | Time to First Byte |

### Monitoring Tools

- Chrome DevTools Lighthouse
- WebPageTest.org
- Supabase Dashboard (Query Performance)

---

## Offline Performance

### UnifiedDataManager (UDM)

For offline-capable modules, use UDM which provides:

- Local SQLite caching
- Background sync
- Conflict resolution

```javascript
import { udm } from '@/lib/data/UnifiedDataManager';

// Automatically uses cache when offline
const { data } = await udm.from('articles').select('*');
```

### Sync Strategy

- **Push First**: Sync local changes immediately when online
- **Pull on Demand**: Fetch fresh data on page load
- **Background Refresh**: Periodic sync every 5 minutes

---

## Checklist

- [ ] Initial bundle < 200 KB (gzipped)
- [ ] LCP < 2.5 seconds
- [ ] All images lazy loaded
- [ ] Database queries paginated
- [ ] RLS policies optimized
- [ ] No N+1 query patterns
- [ ] Critical CSS inlined
- [ ] Critical CSS inlined
- [ ] Fonts preloaded

---

## Benchmarks & Limits

The following limits have been tested and verified on the Pro Tier infrastructure:

| Feature | Limit / Benchmark | Notes |
| :--- | :--- | :--- |
| **Max Articles** | 50,000+ | Per tenant. With proper indexing. |
| **Max Tenants** | 1,000+ | Single database instance. |
| **Concurrent Users** | ~5,000 | Using Supavisor Transaction Mode. |
| **Build Time** | ~45s | Cloudflare Pages (Cache enabled). |
| **Cold Start** | ~800ms | Edge Functions (Global). |
