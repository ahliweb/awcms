SET client_min_messages TO warning;

INSERT INTO public.settings (
  tenant_id,
  key,
  value,
  type,
  description,
  is_public,
  updated_at
)
SELECT
  id,
  'public_rebuild_webhook_url',
  '',
  'string',
  'Cloudflare Pages deploy hook URL for automatic public rebuilds.',
  false,
  now()
FROM public.tenants
WHERE slug = 'smandapbun'
  AND deleted_at IS NULL
ON CONFLICT (tenant_id, key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.request_public_rebuild()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant_id uuid;
  v_hook_url text;
BEGIN
  v_tenant_id := COALESCE(NEW.tenant_id, OLD.tenant_id);

  IF v_tenant_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext(v_tenant_id::text), hashtext('public_rebuild')) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  SELECT NULLIF(trim(value), '')
  INTO v_hook_url
  FROM public.settings
  WHERE tenant_id = v_tenant_id
    AND key = 'public_rebuild_webhook_url'
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_hook_url IS NOT NULL THEN
    PERFORM extensions.http_post(
      url := v_hook_url,
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object(
        'tenant_id', v_tenant_id,
        'table', TG_TABLE_NAME,
        'operation', TG_OP,
        'changed_at', timezone('utc', now())
      )
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'public rebuild trigger failed for tenant % on %: %', v_tenant_id, TG_TABLE_NAME, SQLERRM;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS request_public_rebuild_on_pages ON public.pages;
CREATE TRIGGER request_public_rebuild_on_pages
AFTER INSERT OR UPDATE OR DELETE ON public.pages
FOR EACH ROW EXECUTE FUNCTION public.request_public_rebuild();

DROP TRIGGER IF EXISTS request_public_rebuild_on_blogs ON public.blogs;
CREATE TRIGGER request_public_rebuild_on_blogs
AFTER INSERT OR UPDATE OR DELETE ON public.blogs
FOR EACH ROW EXECUTE FUNCTION public.request_public_rebuild();

DROP TRIGGER IF EXISTS request_public_rebuild_on_menus ON public.menus;
CREATE TRIGGER request_public_rebuild_on_menus
AFTER INSERT OR UPDATE OR DELETE ON public.menus
FOR EACH ROW EXECUTE FUNCTION public.request_public_rebuild();

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
      'profil',
      'Profil Sekolah',
      'School Profile',
      'Gambaran umum SMAN 2 Pangkalan Bun, sejarah perkembangan, budaya sekolah, dan arah pembelajaran.',
      'An overview of SMAN 2 Pangkalan Bun, its development history, school culture, and learning direction.',
      $$<p>SMAN 2 Pangkalan Bun tumbuh sebagai sekolah negeri yang menempatkan karakter, kompetensi, dan prestasi sebagai fondasi utama pembelajaran.</p><p>Halaman profil ini menjadi pintu masuk untuk mengenal arah sekolah melalui sambutan kepala sekolah, sejarah perkembangan, visi dan misi, struktur organisasi, tenaga pendidik, sarana prasarana, serta program Adiwiyata.</p><h2>Fokus Utama</h2><ul><li>Budaya sekolah BERDASI: beriman, cerdas, dan berprestasi.</li><li>Pembelajaran yang adaptif, kolaboratif, dan relevan dengan perkembangan digital.</li><li>Penguatan layanan akademik, non-akademik, dan karakter peserta didik.</li></ul>$$,
      $$<p>SMAN 2 Pangkalan Bun continues to grow as a public school that places character, competence, and achievement at the center of learning.</p><p>This profile page serves as the entry point to explore the principal's message, school history, vision and mission, organizational structure, teaching staff, facilities, and the Adiwiyata program.</p><h2>Main Focus</h2><ul><li>The BERDASI school culture: faithful, intelligent, and achieving.</li><li>Adaptive, collaborative learning that stays relevant to digital development.</li><li>Strengthening academic, non-academic, and character-building services for students.</li></ul>$$,
      '/images/backgrounds/hero-profile.webp'
    ),
    (
      'sambutan-kepala-sekolah',
      'Sambutan Kepala Sekolah',
      'Principal''s Welcome Message',
      'Pesan kepala sekolah tentang budaya BERDASI, mutu layanan, dan komitmen pendidikan yang berpusat pada siswa.',
      'The principal''s message on BERDASI culture, service quality, and student-centered education.',
      $$<p>Assalamu'alaikum Warahmatullahi Wabarakatuh.</p><p>Selamat datang di SMAN 2 Pangkalan Bun. Kami berkomitmen menghadirkan lingkungan belajar yang aman, hangat, dan menantang agar setiap peserta didik berkembang sebagai pribadi yang beriman, cerdas, dan berprestasi.</p><p>Melalui pembelajaran yang kreatif, kolaboratif, dan berdiferensiasi, sekolah terus memperkuat literasi, numerasi, teknologi digital, kepemimpinan, dan kepedulian sosial.</p><h2>Komitmen Kami</h2><ul><li>Membentuk peserta didik yang berkarakter dan bertanggung jawab.</li><li>Mendorong inovasi serta penguasaan ilmu pengetahuan dan teknologi.</li><li>Mengembangkan prestasi akademik dan non-akademik secara seimbang.</li></ul>$$,
      $$<p>Assalamu'alaikum Warahmatullahi Wabarakatuh.</p><p>Welcome to SMAN 2 Pangkalan Bun. We are committed to building a safe, warm, and challenging learning environment so that every student can grow into a faithful, intelligent, and high-achieving individual.</p><p>Through creative, collaborative, and differentiated learning, the school continues to strengthen literacy, numeracy, digital capability, leadership, and social awareness.</p><h2>Our Commitments</h2><ul><li>Shape students who are responsible and strong in character.</li><li>Encourage innovation and mastery of science and digital technology.</li><li>Develop balanced academic and non-academic achievement.</li></ul>$$,
      '/images/staff/teachers/teacher-01.webp'
    ),
    (
      'sejarah',
      'Sejarah SMAN 2 Pangkalan Bun',
      'History of SMAN 2 Pangkalan Bun',
      'Perjalanan sekolah dari masa perintisan hingga penguatan mutu layanan pendidikan saat ini.',
      'The school''s journey from its founding period to the current strengthening of education services.',
      $$<p>SMAN 2 Pangkalan Bun berdiri pada 20 November 1984 dan terus berkembang menjadi sekolah menengah atas negeri yang dipercaya masyarakat Kotawaringin Barat.</p><h2>Perkembangan Utama</h2><ul><li>Periode awal ditandai dengan pembentukan rombongan belajar, penambahan guru, dan penguatan tata kelola sekolah.</li><li>Tahun-tahun berikutnya membawa perluasan ruang kelas, laboratorium, perpustakaan, sarana ibadah, dan fasilitas olahraga.</li><li>Transformasi pembelajaran terus dilakukan melalui penguatan kurikulum, teknologi pembelajaran, dan layanan peserta didik.</li></ul><p>Sejarah sekolah menunjukkan semangat bertumbuh yang konsisten: memperkuat kualitas layanan sambil tetap berakar pada kebutuhan masyarakat lokal.</p>$$,
      $$<p>SMAN 2 Pangkalan Bun was established on 20 November 1984 and has grown into a trusted public high school for the people of Kotawaringin Barat.</p><h2>Key Milestones</h2><ul><li>The early years focused on building study groups, expanding teachers, and strengthening school governance.</li><li>Later periods brought new classrooms, laboratories, a library, worship facilities, and sports infrastructure.</li><li>Learning transformation continued through curriculum development, classroom technology, and stronger student services.</li></ul><p>The school''s history reflects a steady commitment to quality growth while remaining rooted in local community needs.</p>$$,
      '/images/backgrounds/hero-campus.webp'
    ),
    (
      'keselarasan-standar-kompetensi',
      'Keselarasan Standar Kompetensi',
      'Competency Standards Alignment',
      'Keselarasan tujuan pendidikan nasional, standar kompetensi lulusan, dan implementasi pembelajaran mendalam di sekolah.',
      'Alignment of national education goals, graduate competency standards, and deep learning implementation at school.',
      $$<p>SMAN 2 Pangkalan Bun menyelaraskan tujuan pendidikan nasional dengan standar kompetensi lulusan dan praktik pembelajaran mendalam di kelas.</p><h2>Pilar Kompetensi</h2><ul><li>Keimanan dan ketakwaan.</li><li>Kewargaan dan tanggung jawab sosial.</li><li>Penalaran kritis, kreativitas, kolaborasi, dan komunikasi.</li><li>Kemandirian, kesehatan, serta kesiapan menghadapi tantangan masa depan.</li></ul><p>Penyelarasan ini diwujudkan melalui praktik pedagogis, lingkungan belajar yang suportif, kemitraan pembelajaran, dan pemanfaatan teknologi digital secara bertanggung jawab.</p>$$,
      $$<p>SMAN 2 Pangkalan Bun aligns national education goals with graduate competency standards and deep learning practices in the classroom.</p><h2>Competency Pillars</h2><ul><li>Faith and devotion.</li><li>Citizenship and social responsibility.</li><li>Critical reasoning, creativity, collaboration, and communication.</li><li>Independence, wellbeing, and readiness for future challenges.</li></ul><p>This alignment is implemented through pedagogical practice, a supportive learning environment, learning partnerships, and responsible use of digital technology.</p>$$,
      '/images/backgrounds/section-campus.webp'
    ),
    (
      'visi-misi',
      'Visi, Misi, dan Tujuan',
      'Vision, Mission, and Goals',
      'Arah strategis sekolah untuk membentuk generasi pelajar yang beriman, cerdas, dan berprestasi.',
      'The school''s strategic direction to shape a generation of faithful, intelligent, and high-achieving students.',
      $$<h2>Visi</h2><p>Terwujudnya generasi pelajar yang beriman, cerdas, dan berprestasi (BERDASI).</p><h2>Misi</h2><ul><li>Membentuk peserta didik yang beriman, bertakwa, dan berbudi pekerti luhur.</li><li>Membimbing peserta didik agar inovatif, santun, dan menguasai ilmu pengetahuan serta teknologi digital.</li><li>Mengembangkan ketangguhan dan prestasi akademik maupun non-akademik melalui pembelajaran kreatif dan kegiatan kokurikuler serta ekstrakurikuler.</li></ul><h2>Tujuan</h2><p>Sekolah menargetkan peningkatan karakter, kompetensi, dan prestasi peserta didik secara terukur melalui budaya belajar yang kolaboratif dan berpusat pada siswa.</p>$$,
      $$<h2>Vision</h2><p>To realize a generation of students who are faithful, intelligent, and achieving (BERDASI).</p><h2>Mission</h2><ul><li>Form students who are faithful, devoted, and strong in character.</li><li>Guide students to become innovative, respectful, and capable in science and digital technology.</li><li>Develop resilience and academic as well as non-academic achievement through creative learning and strong co-curricular and extracurricular programs.</li></ul><h2>Goals</h2><p>The school aims to improve student character, competence, and achievement through a collaborative, student-centered learning culture.</p>$$,
      '/images/backgrounds/hero-profile.webp'
    ),
    (
      'sarana-prasarana',
      'Sarana dan Prasarana',
      'Facilities and Infrastructure',
      'Ringkasan fasilitas utama yang mendukung pembelajaran, kegiatan siswa, dan kenyamanan lingkungan sekolah.',
      'An overview of the main facilities supporting learning, student activities, and a comfortable school environment.',
      $$<p>Lingkungan belajar di SMAN 2 Pangkalan Bun didukung oleh sarana dan prasarana yang terus diperbarui agar pembelajaran berjalan efektif, aman, dan nyaman.</p><h2>Fasilitas Utama</h2><ul><li>Ruang kelas representatif dengan perangkat presentasi.</li><li>Laboratorium sains, komputer, dan bahasa.</li><li>Perpustakaan, masjid, aula, lapangan olahraga, dan ruang layanan siswa.</li><li>Area sekolah yang mendukung budaya bersih, hijau, dan sehat.</li></ul>$$,
      $$<p>The learning environment at SMAN 2 Pangkalan Bun is supported by facilities and infrastructure that continue to be improved so learning remains effective, safe, and comfortable.</p><h2>Main Facilities</h2><ul><li>Representative classrooms with presentation equipment.</li><li>Science, computer, and language laboratories.</li><li>A library, mosque, hall, sports fields, and student service areas.</li><li>A school environment that supports a clean, green, and healthy culture.</li></ul>$$,
      '/images/backgrounds/section-staff.webp'
    ),
    (
      'adiwiyata',
      'Program Adiwiyata',
      'Adiwiyata Program',
      'Komitmen sekolah dalam menjaga lingkungan melalui budaya hijau, hemat energi, dan pengelolaan sampah yang berkelanjutan.',
      'The school''s environmental commitment through green culture, energy efficiency, and sustainable waste management.',
      $$<p>Program Adiwiyata menjadi salah satu identitas penting SMAN 2 Pangkalan Bun dalam membangun budaya sekolah yang peduli lingkungan.</p><h2>Program Unggulan</h2><ul><li>Bank sampah sekolah dan pengelolaan limbah yang lebih tertib.</li><li>Greenhouse, kebun sekolah, dan tanaman obat keluarga.</li><li>Edukasi hemat energi dan pengurangan plastik sekali pakai.</li></ul><p>Program ini memperkuat keterlibatan siswa, guru, dan warga sekolah dalam menjaga lingkungan secara berkelanjutan.</p>$$,
      $$<p>The Adiwiyata program is one of the defining strengths of SMAN 2 Pangkalan Bun in building an environmentally responsible school culture.</p><h2>Flagship Programs</h2><ul><li>A school waste bank and more structured waste management.</li><li>A greenhouse, school garden, and medicinal plant area.</li><li>Energy-saving education and reduction of single-use plastics.</li></ul><p>The program strengthens the involvement of students, teachers, and the entire school community in caring for the environment sustainably.</p>$$,
      '/images/backgrounds/hero-activity.webp'
    ),
    (
      'tenaga-pendidik',
      'Tenaga Pendidik dan Kependidikan',
      'Teaching and Administrative Staff',
      'Tim guru dan tenaga kependidikan yang mendukung pembelajaran dan layanan sekolah.',
      'The teachers and administrative staff who support learning and school services.',
      $$<p>Keberhasilan layanan pendidikan di SMAN 2 Pangkalan Bun ditopang oleh tim guru dan tenaga kependidikan yang bekerja kolaboratif.</p><h2>Peran Utama</h2><ul><li>Guru mata pelajaran yang memperkuat literasi, numerasi, sains, sosial, seni, dan bahasa.</li><li>Wakil kepala sekolah serta koordinator program yang memastikan layanan sekolah berjalan baik.</li><li>Tenaga administrasi dan layanan pendukung yang menjaga operasional sekolah tetap efektif.</li></ul>$$,
      $$<p>The quality of education services at SMAN 2 Pangkalan Bun is sustained by teachers and administrative staff who work collaboratively.</p><h2>Main Roles</h2><ul><li>Subject teachers who strengthen literacy, numeracy, science, social studies, arts, and languages.</li><li>Vice principals and program coordinators who ensure school services run effectively.</li><li>Administrative and support staff who keep school operations efficient.</li></ul>$$,
      '/images/backgrounds/section-staff.webp'
    ),
    (
      'struktur-organisasi',
      'Struktur Organisasi',
      'Organizational Structure',
      'Gambaran struktur kepemimpinan dan koordinasi utama di lingkungan sekolah.',
      'An overview of the main leadership and coordination structure within the school.',
      $$<p>Struktur organisasi sekolah dirancang untuk memastikan pengambilan keputusan, koordinasi program, dan pelayanan kepada siswa berjalan jelas dan akuntabel.</p><h2>Komponen Organisasi</h2><ul><li>Kepala sekolah dan jajaran wakil kepala sekolah.</li><li>Unit tata usaha dan layanan administrasi.</li><li>Koordinasi program sekolah, hubungan masyarakat, serta layanan peserta didik.</li><li>Sinergi dengan komite sekolah, OSIS, dan MPK.</li></ul>$$,
      $$<p>The school''s organizational structure is designed to ensure that decision-making, program coordination, and student services remain clear and accountable.</p><h2>Organizational Components</h2><ul><li>The principal and the vice-principal leadership team.</li><li>Administrative and office support units.</li><li>School programs, public relations, and student services coordination.</li><li>Collaboration with the school committee, student council, and representative council.</li></ul>$$,
      '/images/backgrounds/hero-campus.webp'
    ),
    (
      'layanan',
      'Layanan Sekolah',
      'School Services',
      'Layanan akademik dan non-akademik yang mendukung kebutuhan siswa, guru, dan orang tua.',
      'Academic and non-academic services that support students, teachers, and parents.',
      $$<p>SMAN 2 Pangkalan Bun menyediakan berbagai layanan untuk mendukung proses belajar, pengembangan minat bakat, dan kebutuhan administrasi sekolah.</p><h2>Layanan Utama</h2><ul><li>Ekstrakurikuler untuk pengembangan minat dan kepemimpinan.</li><li>Laboratorium dan perpustakaan sebagai penguat pembelajaran.</li><li>Layanan kesiswaan, pembinaan prestasi, dan berbagai kebutuhan administrasi siswa.</li></ul>$$,
      $$<p>SMAN 2 Pangkalan Bun provides a range of services to support learning, talent development, and school administration.</p><h2>Main Services</h2><ul><li>Extracurricular programs for talent development and leadership.</li><li>Laboratories and the library as learning support facilities.</li><li>Student affairs services, achievement development, and administrative support.</li></ul>$$,
      '/images/backgrounds/hero-activity.webp'
    ),
    (
      'ekstrakurikuler',
      'Ekstrakurikuler',
      'Extracurricular Programs',
      'Program pengembangan minat, bakat, karakter, dan kepemimpinan siswa di luar jam belajar utama.',
      'Programs that develop student interests, talents, character, and leadership outside core learning hours.',
      $$<p>Kegiatan ekstrakurikuler dirancang untuk memberi ruang eksplorasi minat dan bakat siswa secara sehat dan terarah.</p><h2>Bidang Kegiatan</h2><ul><li>Kepemimpinan dan organisasi siswa.</li><li>Olahraga, seni, musik, dan budaya.</li><li>Sains, debat, karya ilmiah, dan teknologi.</li><li>Kegiatan keagamaan, kepanduan, dan kepedulian sosial.</li></ul>$$,
      $$<p>Extracurricular activities are designed to give students healthy and structured opportunities to explore their interests and talents.</p><h2>Program Areas</h2><ul><li>Leadership and student organization.</li><li>Sports, arts, music, and culture.</li><li>Science, debate, research, and technology.</li><li>Religious activities, scouting, and social responsibility.</li></ul>$$,
      '/images/backgrounds/hero-activity.webp'
    ),
    (
      'laboratorium',
      'Laboratorium',
      'Laboratories',
      'Fasilitas laboratorium untuk mendukung eksperimen, praktik, dan literasi teknologi siswa.',
      'Laboratory facilities that support experimentation, practice, and students'' technology literacy.',
      $$<p>Laboratorium di SMAN 2 Pangkalan Bun membantu siswa belajar melalui pengalaman praktik yang relevan dan terukur.</p><h2>Area Laboratorium</h2><ul><li>Laboratorium sains untuk fisika, kimia, dan biologi.</li><li>Laboratorium komputer untuk pembelajaran TIK dan literasi digital.</li><li>Laboratorium bahasa untuk penguatan keterampilan komunikasi.</li></ul>$$,
      $$<p>The laboratories at SMAN 2 Pangkalan Bun help students learn through relevant and measurable practical experience.</p><h2>Laboratory Areas</h2><ul><li>Science labs for physics, chemistry, and biology.</li><li>Computer labs for ICT learning and digital literacy.</li><li>A language lab to strengthen communication skills.</li></ul>$$,
      '/images/backgrounds/section-campus.webp'
    ),
    (
      'perpustakaan',
      'Perpustakaan',
      'Library',
      'Pusat sumber belajar sekolah dengan koleksi buku, ruang baca, dan akses penunjang belajar mandiri.',
      'The school learning resource center with book collections, reading space, and support for independent study.',
      $$<p>Perpustakaan sekolah menjadi pusat sumber belajar yang mendukung literasi, riset sederhana, dan kebiasaan membaca siswa.</p><h2>Layanan Utama</h2><ul><li>Koleksi buku pelajaran, referensi, dan bacaan umum.</li><li>Ruang baca yang nyaman dan tertata.</li><li>Dukungan pembelajaran mandiri dan kegiatan literasi sekolah.</li></ul>$$,
      $$<p>The school library serves as a learning resource center that supports literacy, simple research, and students'' reading habits.</p><h2>Main Services</h2><ul><li>Collections of textbooks, references, and general reading materials.</li><li>A comfortable and organized reading room.</li><li>Support for independent study and school literacy activities.</li></ul>$$,
      '/images/backgrounds/section-campus.webp'
    ),
    (
      'keuangan',
      'Transparansi Keuangan',
      'Financial Transparency',
      'Informasi ringkas mengenai prinsip transparansi pengelolaan dana sekolah.',
      'A concise overview of transparent school fund management principles.',
      $$<p>SMAN 2 Pangkalan Bun berkomitmen menjaga transparansi pengelolaan keuangan sekolah agar pemanfaatan dana dapat dipertanggungjawabkan secara terbuka.</p><h2>Sumber Pengelolaan Dana</h2><ul><li>Dana BOS untuk mendukung kebutuhan operasional sekolah.</li><li>Dana APBD untuk pengembangan fasilitas dan peningkatan mutu.</li><li>Dana komite sekolah untuk program-program yang disepakati bersama.</li></ul><p>Ringkasan ini dapat terus diperbarui melalui AWCMS Admin sesuai kebutuhan publikasi sekolah.</p>$$,
      $$<p>SMAN 2 Pangkalan Bun is committed to transparent financial management so that school funds can be accounted for openly.</p><h2>Funding Sources</h2><ul><li>BOS funds to support school operational needs.</li><li>APBD funds for facility development and quality improvement.</li><li>School committee funds for jointly agreed programs.</li></ul><p>This summary can be continuously updated through AWCMS Admin based on the school''s publication needs.</p>$$,
      '/images/backgrounds/hero-campus.webp'
    ),
    (
      'prestasi',
      'Prestasi Siswa dan Sekolah',
      'Student and School Achievements',
      'Sorotan capaian akademik, non-akademik, dan institusional sekolah.',
      'Highlights of the school''s academic, non-academic, and institutional achievements.',
      $$<p>Prestasi menjadi bagian penting dari budaya belajar di SMAN 2 Pangkalan Bun.</p><h2>Ruang Prestasi</h2><ul><li>Pencapaian akademik seperti olimpiade sains, debat, dan karya ilmiah.</li><li>Pencapaian non-akademik pada seni, olahraga, dan kepemimpinan siswa.</li><li>Pengakuan institusional yang memperkuat reputasi sekolah di tingkat daerah hingga nasional.</li></ul>$$,
      $$<p>Achievement is an important part of the learning culture at SMAN 2 Pangkalan Bun.</p><h2>Achievement Areas</h2><ul><li>Academic accomplishments such as science olympiads, debate, and scientific writing.</li><li>Non-academic accomplishments in arts, sports, and student leadership.</li><li>Institutional recognitions that strengthen the school''s reputation from local to national levels.</li></ul>$$,
      '/images/backgrounds/hero-activity.webp'
    ),
    (
      'alumni',
      'Profil Alumni',
      'Alumni Profile',
      'Jejak alumni SMAN 2 Pangkalan Bun di berbagai bidang profesi dan kontribusi sosial.',
      'The journey of SMAN 2 Pangkalan Bun alumni across professions and social contributions.',
      $$<p>Alumni SMAN 2 Pangkalan Bun tersebar di berbagai bidang profesi dan menjadi bagian penting dari jejaring dukungan sekolah.</p><h2>Peran Alumni</h2><ul><li>Menjadi inspirasi bagi siswa melalui kiprah profesional.</li><li>Membuka jejaring untuk pendidikan lanjutan dan pengembangan karier.</li><li>Mendukung kegiatan sekolah melalui kolaborasi, beasiswa, dan kontribusi sosial.</li></ul>$$,
      $$<p>SMAN 2 Pangkalan Bun alumni are active across many professional fields and remain an important part of the school''s support network.</p><h2>Alumni Contributions</h2><ul><li>Inspiring students through professional achievements.</li><li>Opening networks for higher education and career development.</li><li>Supporting school programs through collaboration, scholarships, and social contributions.</li></ul>$$,
      '/images/backgrounds/section-staff.webp'
    ),
    (
      'kontak',
      'Hubungi Kami',
      'Contact Us',
      'Informasi kontak resmi sekolah untuk komunikasi, kunjungan, dan layanan informasi publik.',
      'Official school contact information for communication, visits, and public information services.',
      $$<p>Silakan hubungi SMAN 2 Pangkalan Bun melalui kanal resmi sekolah untuk kebutuhan informasi, kerja sama, maupun layanan publik lainnya.</p><h2>Informasi Kontak</h2><ul><li>Alamat sekolah dan jam operasional.</li><li>Kontak telepon dan email resmi sekolah.</li><li>Media sosial sekolah untuk informasi dan publikasi terbaru.</li></ul>$$,
      $$<p>Please contact SMAN 2 Pangkalan Bun through the school''s official channels for information requests, collaboration, or public service needs.</p><h2>Contact Information</h2><ul><li>School address and operating hours.</li><li>Official phone and email contact.</li><li>School social media channels for updates and public communication.</li></ul>$$,
      '/images/backgrounds/hero-campus.webp'
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
    ('profil','Profil Sekolah','School Profile','Gambaran umum SMAN 2 Pangkalan Bun, sejarah perkembangan, budaya sekolah, dan arah pembelajaran.','An overview of SMAN 2 Pangkalan Bun, its development history, school culture, and learning direction.',$$<p>SMAN 2 Pangkalan Bun tumbuh sebagai sekolah negeri yang menempatkan karakter, kompetensi, dan prestasi sebagai fondasi utama pembelajaran.</p><p>Halaman profil ini menjadi pintu masuk untuk mengenal arah sekolah melalui sambutan kepala sekolah, sejarah perkembangan, visi dan misi, struktur organisasi, tenaga pendidik, sarana prasarana, serta program Adiwiyata.</p><h2>Fokus Utama</h2><ul><li>Budaya sekolah BERDASI: beriman, cerdas, dan berprestasi.</li><li>Pembelajaran yang adaptif, kolaboratif, dan relevan dengan perkembangan digital.</li><li>Penguatan layanan akademik, non-akademik, dan karakter peserta didik.</li></ul>$$,$$<p>SMAN 2 Pangkalan Bun continues to grow as a public school that places character, competence, and achievement at the center of learning.</p><p>This profile page serves as the entry point to explore the principal's message, school history, vision and mission, organizational structure, teaching staff, facilities, and the Adiwiyata program.</p><h2>Main Focus</h2><ul><li>The BERDASI school culture: faithful, intelligent, and achieving.</li><li>Adaptive, collaborative learning that stays relevant to digital development.</li><li>Strengthening academic, non-academic, and character-building services for students.</li></ul>$$,'/images/backgrounds/hero-profile.webp'),
    ('sambutan-kepala-sekolah','Sambutan Kepala Sekolah','Principal''s Welcome Message','Pesan kepala sekolah tentang budaya BERDASI, mutu layanan, dan komitmen pendidikan yang berpusat pada siswa.','The principal''s message on BERDASI culture, service quality, and student-centered education.',$$<p>Assalamu'alaikum Warahmatullahi Wabarakatuh.</p><p>Selamat datang di SMAN 2 Pangkalan Bun. Kami berkomitmen menghadirkan lingkungan belajar yang aman, hangat, dan menantang agar setiap peserta didik berkembang sebagai pribadi yang beriman, cerdas, dan berprestasi.</p><p>Melalui pembelajaran yang kreatif, kolaboratif, dan berdiferensiasi, sekolah terus memperkuat literasi, numerasi, teknologi digital, kepemimpinan, dan kepedulian sosial.</p><h2>Komitmen Kami</h2><ul><li>Membentuk peserta didik yang berkarakter dan bertanggung jawab.</li><li>Mendorong inovasi serta penguasaan ilmu pengetahuan dan teknologi.</li><li>Mengembangkan prestasi akademik dan non-akademik secara seimbang.</li></ul>$$,$$<p>Assalamu'alaikum Warahmatullahi Wabarakatuh.</p><p>Welcome to SMAN 2 Pangkalan Bun. We are committed to building a safe, warm, and challenging learning environment so that every student can grow into a faithful, intelligent, and high-achieving individual.</p><p>Through creative, collaborative, and differentiated learning, the school continues to strengthen literacy, numeracy, digital capability, leadership, and social awareness.</p><h2>Our Commitments</h2><ul><li>Shape students who are responsible and strong in character.</li><li>Encourage innovation and mastery of science and digital technology.</li><li>Develop balanced academic and non-academic achievement.</li></ul>$$,'/images/staff/teachers/teacher-01.webp'),
    ('sejarah','Sejarah SMAN 2 Pangkalan Bun','History of SMAN 2 Pangkalan Bun','Perjalanan sekolah dari masa perintisan hingga penguatan mutu layanan pendidikan saat ini.','The school''s journey from its founding period to the current strengthening of education services.',$$<p>SMAN 2 Pangkalan Bun berdiri pada 20 November 1984 dan terus berkembang menjadi sekolah menengah atas negeri yang dipercaya masyarakat Kotawaringin Barat.</p><h2>Perkembangan Utama</h2><ul><li>Periode awal ditandai dengan pembentukan rombongan belajar, penambahan guru, dan penguatan tata kelola sekolah.</li><li>Tahun-tahun berikutnya membawa perluasan ruang kelas, laboratorium, perpustakaan, sarana ibadah, dan fasilitas olahraga.</li><li>Transformasi pembelajaran terus dilakukan melalui penguatan kurikulum, teknologi pembelajaran, dan layanan peserta didik.</li></ul><p>Sejarah sekolah menunjukkan semangat bertumbuh yang konsisten: memperkuat kualitas layanan sambil tetap berakar pada kebutuhan masyarakat lokal.</p>$$,$$<p>SMAN 2 Pangkalan Bun was established on 20 November 1984 and has grown into a trusted public high school for the people of Kotawaringin Barat.</p><h2>Key Milestones</h2><ul><li>The early years focused on building study groups, expanding teachers, and strengthening school governance.</li><li>Later periods brought new classrooms, laboratories, a library, worship facilities, and sports infrastructure.</li><li>Learning transformation continued through curriculum development, classroom technology, and stronger student services.</li></ul><p>The school''s history reflects a steady commitment to quality growth while remaining rooted in local community needs.</p>$$,'/images/backgrounds/hero-campus.webp'),
    ('keselarasan-standar-kompetensi','Keselarasan Standar Kompetensi','Competency Standards Alignment','Keselarasan tujuan pendidikan nasional, standar kompetensi lulusan, dan implementasi pembelajaran mendalam di sekolah.','Alignment of national education goals, graduate competency standards, and deep learning implementation at school.',$$<p>SMAN 2 Pangkalan Bun menyelaraskan tujuan pendidikan nasional dengan standar kompetensi lulusan dan praktik pembelajaran mendalam di kelas.</p><h2>Pilar Kompetensi</h2><ul><li>Keimanan dan ketakwaan.</li><li>Kewargaan dan tanggung jawab sosial.</li><li>Penalaran kritis, kreativitas, kolaborasi, dan komunikasi.</li><li>Kemandirian, kesehatan, serta kesiapan menghadapi tantangan masa depan.</li></ul><p>Penyelarasan ini diwujudkan melalui praktik pedagogis, lingkungan belajar yang suportif, kemitraan pembelajaran, dan pemanfaatan teknologi digital secara bertanggung jawab.</p>$$,$$<p>SMAN 2 Pangkalan Bun aligns national education goals with graduate competency standards and deep learning practices in the classroom.</p><h2>Competency Pillars</h2><ul><li>Faith and devotion.</li><li>Citizenship and social responsibility.</li><li>Critical reasoning, creativity, collaboration, and communication.</li><li>Independence, wellbeing, and readiness for future challenges.</li></ul><p>This alignment is implemented through pedagogical practice, a supportive learning environment, learning partnerships, and responsible use of digital technology.</p>$$,'/images/backgrounds/section-campus.webp'),
    ('visi-misi','Visi, Misi, dan Tujuan','Vision, Mission, and Goals','Arah strategis sekolah untuk membentuk generasi pelajar yang beriman, cerdas, dan berprestasi.','The school''s strategic direction to shape a generation of faithful, intelligent, and high-achieving students.',$$<h2>Visi</h2><p>Terwujudnya generasi pelajar yang beriman, cerdas, dan berprestasi (BERDASI).</p><h2>Misi</h2><ul><li>Membentuk peserta didik yang beriman, bertakwa, dan berbudi pekerti luhur.</li><li>Membimbing peserta didik agar inovatif, santun, dan menguasai ilmu pengetahuan serta teknologi digital.</li><li>Mengembangkan ketangguhan dan prestasi akademik maupun non-akademik melalui pembelajaran kreatif dan kegiatan kokurikuler serta ekstrakurikuler.</li></ul><h2>Tujuan</h2><p>Sekolah menargetkan peningkatan karakter, kompetensi, dan prestasi peserta didik secara terukur melalui budaya belajar yang kolaboratif dan berpusat pada siswa.</p>$$,$$<h2>Vision</h2><p>To realize a generation of students who are faithful, intelligent, and achieving (BERDASI).</p><h2>Mission</h2><ul><li>Form students who are faithful, devoted, and strong in character.</li><li>Guide students to become innovative, respectful, and capable in science and digital technology.</li><li>Develop resilience and academic as well as non-academic achievement through creative learning and strong co-curricular and extracurricular programs.</li></ul><h2>Goals</h2><p>The school aims to improve student character, competence, and achievement through a collaborative, student-centered learning culture.</p>$$,'/images/backgrounds/hero-profile.webp'),
    ('sarana-prasarana','Sarana dan Prasarana','Facilities and Infrastructure','Ringkasan fasilitas utama yang mendukung pembelajaran, kegiatan siswa, dan kenyamanan lingkungan sekolah.','An overview of the main facilities supporting learning, student activities, and a comfortable school environment.',$$<p>Lingkungan belajar di SMAN 2 Pangkalan Bun didukung oleh sarana dan prasarana yang terus diperbarui agar pembelajaran berjalan efektif, aman, dan nyaman.</p><h2>Fasilitas Utama</h2><ul><li>Ruang kelas representatif dengan perangkat presentasi.</li><li>Laboratorium sains, komputer, dan bahasa.</li><li>Perpustakaan, masjid, aula, lapangan olahraga, dan ruang layanan siswa.</li><li>Area sekolah yang mendukung budaya bersih, hijau, dan sehat.</li></ul>$$,$$<p>The learning environment at SMAN 2 Pangkalan Bun is supported by facilities and infrastructure that continue to be improved so learning remains effective, safe, and comfortable.</p><h2>Main Facilities</h2><ul><li>Representative classrooms with presentation equipment.</li><li>Science, computer, and language laboratories.</li><li>A library, mosque, hall, sports fields, and student service areas.</li><li>A school environment that supports a clean, green, and healthy culture.</li></ul>$$,'/images/backgrounds/section-staff.webp'),
    ('adiwiyata','Program Adiwiyata','Adiwiyata Program','Komitmen sekolah dalam menjaga lingkungan melalui budaya hijau, hemat energi, dan pengelolaan sampah yang berkelanjutan.','The school''s environmental commitment through green culture, energy efficiency, and sustainable waste management.',$$<p>Program Adiwiyata menjadi salah satu identitas penting SMAN 2 Pangkalan Bun dalam membangun budaya sekolah yang peduli lingkungan.</p><h2>Program Unggulan</h2><ul><li>Bank sampah sekolah dan pengelolaan limbah yang lebih tertib.</li><li>Greenhouse, kebun sekolah, dan tanaman obat keluarga.</li><li>Edukasi hemat energi dan pengurangan plastik sekali pakai.</li></ul><p>Program ini memperkuat keterlibatan siswa, guru, dan warga sekolah dalam menjaga lingkungan secara berkelanjutan.</p>$$,$$<p>The Adiwiyata program is one of the defining strengths of SMAN 2 Pangkalan Bun in building an environmentally responsible school culture.</p><h2>Flagship Programs</h2><ul><li>A school waste bank and more structured waste management.</li><li>A greenhouse, school garden, and medicinal plant area.</li><li>Energy-saving education and reduction of single-use plastics.</li></ul><p>The program strengthens the involvement of students, teachers, and the entire school community in caring for the environment sustainably.</p>$$,'/images/backgrounds/hero-activity.webp'),
    ('tenaga-pendidik','Tenaga Pendidik dan Kependidikan','Teaching and Administrative Staff','Tim guru dan tenaga kependidikan yang mendukung pembelajaran dan layanan sekolah.','The teachers and administrative staff who support learning and school services.',$$<p>Keberhasilan layanan pendidikan di SMAN 2 Pangkalan Bun ditopang oleh tim guru dan tenaga kependidikan yang bekerja kolaboratif.</p><h2>Peran Utama</h2><ul><li>Guru mata pelajaran yang memperkuat literasi, numerasi, sains, sosial, seni, dan bahasa.</li><li>Wakil kepala sekolah serta koordinator program yang memastikan layanan sekolah berjalan baik.</li><li>Tenaga administrasi dan layanan pendukung yang menjaga operasional sekolah tetap efektif.</li></ul>$$,$$<p>The quality of education services at SMAN 2 Pangkalan Bun is sustained by teachers and administrative staff who work collaboratively.</p><h2>Main Roles</h2><ul><li>Subject teachers who strengthen literacy, numeracy, science, social studies, arts, and languages.</li><li>Vice principals and program coordinators who ensure school services run effectively.</li><li>Administrative and support staff who keep school operations efficient.</li></ul>$$,'/images/backgrounds/section-staff.webp'),
    ('struktur-organisasi','Struktur Organisasi','Organizational Structure','Gambaran struktur kepemimpinan dan koordinasi utama di lingkungan sekolah.','An overview of the main leadership and coordination structure within the school.',$$<p>Struktur organisasi sekolah dirancang untuk memastikan pengambilan keputusan, koordinasi program, dan pelayanan kepada siswa berjalan jelas dan akuntabel.</p><h2>Komponen Organisasi</h2><ul><li>Kepala sekolah dan jajaran wakil kepala sekolah.</li><li>Unit tata usaha dan layanan administrasi.</li><li>Koordinasi program sekolah, hubungan masyarakat, serta layanan peserta didik.</li><li>Sinergi dengan komite sekolah, OSIS, dan MPK.</li></ul>$$,$$<p>The school''s organizational structure is designed to ensure that decision-making, program coordination, and student services remain clear and accountable.</p><h2>Organizational Components</h2><ul><li>The principal and the vice-principal leadership team.</li><li>Administrative and office support units.</li><li>School programs, public relations, and student services coordination.</li><li>Collaboration with the school committee, student council, and representative council.</li></ul>$$,'/images/backgrounds/hero-campus.webp'),
    ('layanan','Layanan Sekolah','School Services','Layanan akademik dan non-akademik yang mendukung kebutuhan siswa, guru, dan orang tua.','Academic and non-academic services that support students, teachers, and parents.',$$<p>SMAN 2 Pangkalan Bun menyediakan berbagai layanan untuk mendukung proses belajar, pengembangan minat bakat, dan kebutuhan administrasi sekolah.</p><h2>Layanan Utama</h2><ul><li>Ekstrakurikuler untuk pengembangan minat dan kepemimpinan.</li><li>Laboratorium dan perpustakaan sebagai penguat pembelajaran.</li><li>Layanan kesiswaan, pembinaan prestasi, dan berbagai kebutuhan administrasi siswa.</li></ul>$$,$$<p>SMAN 2 Pangkalan Bun provides a range of services to support learning, talent development, and school administration.</p><h2>Main Services</h2><ul><li>Extracurricular programs for talent development and leadership.</li><li>Laboratories and the library as learning support facilities.</li><li>Student affairs services, achievement development, and administrative support.</li></ul>$$,'/images/backgrounds/hero-activity.webp'),
    ('ekstrakurikuler','Ekstrakurikuler','Extracurricular Programs','Program pengembangan minat, bakat, karakter, dan kepemimpinan siswa di luar jam belajar utama.','Programs that develop student interests, talents, character, and leadership outside core learning hours.',$$<p>Kegiatan ekstrakurikuler dirancang untuk memberi ruang eksplorasi minat dan bakat siswa secara sehat dan terarah.</p><h2>Bidang Kegiatan</h2><ul><li>Kepemimpinan dan organisasi siswa.</li><li>Olahraga, seni, musik, dan budaya.</li><li>Sains, debat, karya ilmiah, dan teknologi.</li><li>Kegiatan keagamaan, kepanduan, dan kepedulian sosial.</li></ul>$$,$$<p>Extracurricular activities are designed to give students healthy and structured opportunities to explore their interests and talents.</p><h2>Program Areas</h2><ul><li>Leadership and student organization.</li><li>Sports, arts, music, and culture.</li><li>Science, debate, research, and technology.</li><li>Religious activities, scouting, and social responsibility.</li></ul>$$,'/images/backgrounds/hero-activity.webp'),
    ('laboratorium','Laboratorium','Laboratories','Fasilitas laboratorium untuk mendukung eksperimen, praktik, dan literasi teknologi siswa.','Laboratory facilities that support experimentation, practice, and students'' technology literacy.',$$<p>Laboratorium di SMAN 2 Pangkalan Bun membantu siswa belajar melalui pengalaman praktik yang relevan dan terukur.</p><h2>Area Laboratorium</h2><ul><li>Laboratorium sains untuk fisika, kimia, dan biologi.</li><li>Laboratorium komputer untuk pembelajaran TIK dan literasi digital.</li><li>Laboratorium bahasa untuk penguatan keterampilan komunikasi.</li></ul>$$,$$<p>The laboratories at SMAN 2 Pangkalan Bun help students learn through relevant and measurable practical experience.</p><h2>Laboratory Areas</h2><ul><li>Science labs for physics, chemistry, and biology.</li><li>Computer labs for ICT learning and digital literacy.</li><li>A language lab to strengthen communication skills.</li></ul>$$,'/images/backgrounds/section-campus.webp'),
    ('perpustakaan','Perpustakaan','Library','Pusat sumber belajar sekolah dengan koleksi buku, ruang baca, dan akses penunjang belajar mandiri.','The school learning resource center with book collections, reading space, and support for independent study.',$$<p>Perpustakaan sekolah menjadi pusat sumber belajar yang mendukung literasi, riset sederhana, dan kebiasaan membaca siswa.</p><h2>Layanan Utama</h2><ul><li>Koleksi buku pelajaran, referensi, dan bacaan umum.</li><li>Ruang baca yang nyaman dan tertata.</li><li>Dukungan pembelajaran mandiri dan kegiatan literasi sekolah.</li></ul>$$,$$<p>The school library serves as a learning resource center that supports literacy, simple research, and students'' reading habits.</p><h2>Main Services</h2><ul><li>Collections of textbooks, references, and general reading materials.</li><li>A comfortable and organized reading room.</li><li>Support for independent study and school literacy activities.</li></ul>$$,'/images/backgrounds/section-campus.webp'),
    ('keuangan','Transparansi Keuangan','Financial Transparency','Informasi ringkas mengenai prinsip transparansi pengelolaan dana sekolah.','A concise overview of transparent school fund management principles.',$$<p>SMAN 2 Pangkalan Bun berkomitmen menjaga transparansi pengelolaan keuangan sekolah agar pemanfaatan dana dapat dipertanggungjawabkan secara terbuka.</p><h2>Sumber Pengelolaan Dana</h2><ul><li>Dana BOS untuk mendukung kebutuhan operasional sekolah.</li><li>Dana APBD untuk pengembangan fasilitas dan peningkatan mutu.</li><li>Dana komite sekolah untuk program-program yang disepakati bersama.</li></ul><p>Ringkasan ini dapat terus diperbarui melalui AWCMS Admin sesuai kebutuhan publikasi sekolah.</p>$$,$$<p>SMAN 2 Pangkalan Bun is committed to transparent financial management so that school funds can be accounted for openly.</p><h2>Funding Sources</h2><ul><li>BOS funds to support school operational needs.</li><li>APBD funds for facility development and quality improvement.</li><li>School committee funds for jointly agreed programs.</li></ul><p>This summary can be continuously updated through AWCMS Admin based on the school''s publication needs.</p>$$,'/images/backgrounds/hero-campus.webp'),
    ('prestasi','Prestasi Siswa dan Sekolah','Student and School Achievements','Sorotan capaian akademik, non-akademik, dan institusional sekolah.','Highlights of the school''s academic, non-academic, and institutional achievements.',$$<p>Prestasi menjadi bagian penting dari budaya belajar di SMAN 2 Pangkalan Bun.</p><h2>Ruang Prestasi</h2><ul><li>Pencapaian akademik seperti olimpiade sains, debat, dan karya ilmiah.</li><li>Pencapaian non-akademik pada seni, olahraga, dan kepemimpinan siswa.</li><li>Pengakuan institusional yang memperkuat reputasi sekolah di tingkat daerah hingga nasional.</li></ul>$$,$$<p>Achievement is an important part of the learning culture at SMAN 2 Pangkalan Bun.</p><h2>Achievement Areas</h2><ul><li>Academic accomplishments such as science olympiads, debate, and scientific writing.</li><li>Non-academic accomplishments in arts, sports, and student leadership.</li><li>Institutional recognitions that strengthen the school''s reputation from local to national levels.</li></ul>$$,'/images/backgrounds/hero-activity.webp'),
    ('alumni','Profil Alumni','Alumni Profile','Jejak alumni SMAN 2 Pangkalan Bun di berbagai bidang profesi dan kontribusi sosial.','The journey of SMAN 2 Pangkalan Bun alumni across professions and social contributions.',$$<p>Alumni SMAN 2 Pangkalan Bun tersebar di berbagai bidang profesi dan menjadi bagian penting dari jejaring dukungan sekolah.</p><h2>Peran Alumni</h2><ul><li>Menjadi inspirasi bagi siswa melalui kiprah profesional.</li><li>Membuka jejaring untuk pendidikan lanjutan dan pengembangan karier.</li><li>Mendukung kegiatan sekolah melalui kolaborasi, beasiswa, dan kontribusi sosial.</li></ul>$$,$$<p>SMAN 2 Pangkalan Bun alumni are active across many professional fields and remain an important part of the school''s support network.</p><h2>Alumni Contributions</h2><ul><li>Inspiring students through professional achievements.</li><li>Opening networks for higher education and career development.</li><li>Supporting school programs through collaboration, scholarships, and social contributions.</li></ul>$$,'/images/backgrounds/section-staff.webp'),
    ('kontak','Hubungi Kami','Contact Us','Informasi kontak resmi sekolah untuk komunikasi, kunjungan, dan layanan informasi publik.','Official school contact information for communication, visits, and public information services.',$$<p>Silakan hubungi SMAN 2 Pangkalan Bun melalui kanal resmi sekolah untuk kebutuhan informasi, kerja sama, maupun layanan publik lainnya.</p><h2>Informasi Kontak</h2><ul><li>Alamat sekolah dan jam operasional.</li><li>Kontak telepon dan email resmi sekolah.</li><li>Media sosial sekolah untuk informasi dan publikasi terbaru.</li></ul>$$,$$<p>Please contact SMAN 2 Pangkalan Bun through the school's official channels for information requests, collaboration, or public service needs.</p><h2>Contact Information</h2><ul><li>School address and operating hours.</li><li>Official phone and email contact.</li><li>School social media channels for updates and public communication.</li></ul>$$,'/images/backgrounds/hero-campus.webp')
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
