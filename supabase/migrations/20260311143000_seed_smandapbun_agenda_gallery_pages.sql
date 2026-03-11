SET client_min_messages TO warning;

WITH tenant AS (
  SELECT id
  FROM public.tenants
  WHERE slug = 'smandapbun'
    AND deleted_at IS NULL
  LIMIT 1
),
page_seed(slug, title_id, title_en, excerpt_id, excerpt_en, content_id, content_en, featured_image) AS (
  VALUES
    (
      'agenda',
      'Agenda Sekolah',
      'School Agenda',
      'Jadwal agenda sekolah, kalender akademik, dan kegiatan penting SMAN 2 Pangkalan Bun.',
      'School schedule, academic calendar, and important activities at SMAN 2 Pangkalan Bun.',
      $$<p>Halaman agenda sekolah memuat ringkasan kegiatan penting, kalender akademik, dan jadwal yang perlu diketahui siswa, guru, serta orang tua.</p><ul><li>Agenda mendatang yang perlu dipersiapkan bersama.</li><li>Ringkasan kegiatan sekolah yang sudah berlangsung.</li><li>Akses cepat ke kalender pendidikan sekolah.</li></ul>$$,
      $$<p>The school agenda page provides an overview of important events, the academic calendar, and schedules relevant to students, teachers, and parents.</p><ul><li>Upcoming events that require preparation.</li><li>A summary of recent school activities.</li><li>Quick access to the school academic calendar.</li></ul>$$,
      '/images/backgrounds/hero-ceremony.webp'
    ),
    (
      'galeri',
      'Galeri Kegiatan Sekolah',
      'School Activities Gallery',
      'Dokumentasi visual kegiatan belajar, acara sekolah, dan momen penting di SMAN 2 Pangkalan Bun.',
      'Visual documentation of learning activities, school events, and important moments at SMAN 2 Pangkalan Bun.',
      $$<p>Galeri sekolah menampilkan dokumentasi kegiatan belajar, acara resmi, serta momen kebersamaan warga sekolah.</p><ul><li>Dokumentasi kegiatan akademik dan non-akademik.</li><li>Album visual untuk kegiatan sekolah pilihan.</li><li>Ruang publikasi untuk memperkuat identitas sekolah di kanal digital.</li></ul>$$,
      $$<p>The school gallery showcases documentation of learning activities, official events, and moments shared across the school community.</p><ul><li>Documentation of academic and non-academic activities.</li><li>Visual albums for selected school events.</li><li>A publication space to strengthen the school's identity across digital channels.</li></ul>$$,
      '/images/backgrounds/hero-activity.webp'
    )
),
inserted AS (
  INSERT INTO public.pages (
    tenant_id,
    title,
    slug,
    content,
    excerpt,
    featured_image,
    status,
    is_public,
    is_active,
    editor_type,
    page_type,
    meta_title,
    meta_description,
    published_at,
    created_at,
    updated_at
  )
  SELECT
    tenant.id,
    seed.title_id,
    seed.slug,
    seed.content_id,
    seed.excerpt_id,
    seed.featured_image,
    'published',
    true,
    true,
    'richtext',
    'regular',
    seed.title_id,
    seed.excerpt_id,
    now(),
    now(),
    now()
  FROM tenant
  CROSS JOIN page_seed seed
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.pages existing
    WHERE existing.tenant_id = tenant.id
      AND existing.slug = seed.slug
      AND existing.deleted_at IS NULL
  )
  RETURNING id, slug
)
SELECT count(*) FROM inserted;

WITH tenant AS (
  SELECT id
  FROM public.tenants
  WHERE slug = 'smandapbun'
    AND deleted_at IS NULL
  LIMIT 1
),
page_seed(slug, title_id, title_en, excerpt_id, excerpt_en, content_id, content_en, featured_image) AS (
  VALUES
    ('agenda','Agenda Sekolah','School Agenda','Jadwal agenda sekolah, kalender akademik, dan kegiatan penting SMAN 2 Pangkalan Bun.','School schedule, academic calendar, and important activities at SMAN 2 Pangkalan Bun.',$$<p>Halaman agenda sekolah memuat ringkasan kegiatan penting, kalender akademik, dan jadwal yang perlu diketahui siswa, guru, serta orang tua.</p><ul><li>Agenda mendatang yang perlu dipersiapkan bersama.</li><li>Ringkasan kegiatan sekolah yang sudah berlangsung.</li><li>Akses cepat ke kalender pendidikan sekolah.</li></ul>$$,$$<p>The school agenda page provides an overview of important events, the academic calendar, and schedules relevant to students, teachers, and parents.</p><ul><li>Upcoming events that require preparation.</li><li>A summary of recent school activities.</li><li>Quick access to the school academic calendar.</li></ul>$$,'/images/backgrounds/hero-ceremony.webp'),
    ('galeri','Galeri Kegiatan Sekolah','School Activities Gallery','Dokumentasi visual kegiatan belajar, acara sekolah, dan momen penting di SMAN 2 Pangkalan Bun.','Visual documentation of learning activities, school events, and important moments at SMAN 2 Pangkalan Bun.',$$<p>Galeri sekolah menampilkan dokumentasi kegiatan belajar, acara resmi, serta momen kebersamaan warga sekolah.</p><ul><li>Dokumentasi kegiatan akademik dan non-akademik.</li><li>Album visual untuk kegiatan sekolah pilihan.</li><li>Ruang publikasi untuk memperkuat identitas sekolah di kanal digital.</li></ul>$$,$$<p>The school gallery showcases documentation of learning activities, official events, and moments shared across the school community.</p><ul><li>Documentation of academic and non-academic activities.</li><li>Visual albums for selected school events.</li><li>A publication space to strengthen the school's identity across digital channels.</li></ul>$$,'/images/backgrounds/hero-activity.webp')
)
INSERT INTO public.content_translations (
  content_type,
  content_id,
  locale,
  title,
  slug,
  content,
  excerpt,
  meta_description,
  tenant_id,
  created_at,
  updated_at
)
SELECT
  'page',
  p.id,
  'en',
  seed.title_en,
  seed.slug,
  seed.content_en,
  seed.excerpt_en,
  seed.excerpt_en,
  tenant.id,
  now(),
  now()
FROM tenant
JOIN page_seed seed ON true
JOIN public.pages p
  ON p.tenant_id = tenant.id
 AND p.slug = seed.slug
 AND p.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM public.content_translations existing
  WHERE existing.tenant_id = tenant.id
    AND existing.content_type = 'page'
    AND existing.content_id = p.id
    AND existing.locale = 'en'
);
