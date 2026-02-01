-- Migration: Seed smandapbun settings
-- Created: 2026-02-01
-- Purpose: Seed default settings data for smandapbun public portal.

DO $seed$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT id INTO v_tenant_id FROM public.tenants WHERE slug = 'smandapbun';

  IF v_tenant_id IS NULL THEN
    RAISE NOTICE 'Tenant smandapbun not found, skipping settings seed.';
  ELSE
    INSERT INTO public.settings (tenant_id, key, value, type, description, is_public, updated_at)
    VALUES
      (v_tenant_id, 'site_info', $$
{
  "site": {
    "name": "SMAN 2 Pangkalan Bun",
    "shortName": "SMANDA",
    "tagline": "Beriman, Cerdas, Berprestasi (BERDASI)",
    "description": "SMA Negeri 2 Pangkalan Bun adalah sekolah menengah atas negeri yang berlokasi di Kota Pangkalan Bun, Kabupaten Kotawaringin Barat, Kalimantan Tengah.",
    "logo": "/images/smanda-logo.png",
    "favicon": "/favicon.png",
    "address": "Jl. Pasanah No. 15, RT 24, Sidorejo, Arut Selatan, Kotawaringin Barat, Kalimantan Tengah, 74111",
    "phone": "082254008080",
    "email": "info@sman2pangkalanbun.sch.id",
    "website": "https://sman2pangkalanbun.sch.id",
    "socialMedia": {
      "facebook": "https://facebook.com/sman2pangkalanbun",
      "instagram": "https://instagram.com/sman2pangkalanbun",
      "youtube": "https://youtube.com/@sman2pangkalanbun",
      "twitter": "https://twitter.com/sman2pbun"
    }
  },
  "accreditation": "A",
  "npsn": "30203456",
  "established": "1984",
  "headmaster": {
    "name": "Drs. H. Ahmad Sudirman, M.Pd",
    "photo": "/images/staff/kepala-sekolah.jpg"
  },
  "stats": {
    "students": 1250,
    "teachers": 68,
    "staff": 25,
    "classrooms": 36,
    "labs": 8,
    "extracurriculars": 18,
    "alumni": 8500,
    "achievements": 100
  }
}
$$, 'json', 'Smandapbun site info', true, now()),
      (v_tenant_id, 'contact_info', $$
{
  "address": "Jl. Pasanah No. 15, RT 24, Sidorejo, Arut Selatan, Kotawaringin Barat, Kalimantan Tengah, 74111",
  "phone": "082254008080",
  "email": "info@sman2pangkalanbun.sch.id",
  "website": "https://sman2pangkalanbun.sch.id",
  "operationalHours": "Senin - Jumat: 07:00 - 15:00 WIB"
}
$$, 'json', 'Smandapbun contact info', true, now()),
      (v_tenant_id, 'site_images', $$
{
  "hero": {
    "main": "https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=1920&h=800&fit=crop",
    "about": "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=800&h=450&fit=crop"
  },
  "classroom": [
    "https://images.unsplash.com/photo-1742549586702-c23994895082?w=800&h=600&fit=crop",
    "https://images.unsplash.com/photo-1589104760192-ccab0ce0d90f?w=800&h=600&fit=crop",
    "https://images.unsplash.com/photo-1665665160518-097a89d5383e?w=800&h=600&fit=crop",
    "https://images.pexels.com/photos/31940733/pexels-photo-31940733.jpeg?w=800&h=600&fit=crop"
  ],
  "laboratory": [
    "https://images.unsplash.com/photo-1605781645799-c9c7d820b4ac?w=800&h=600&fit=crop",
    "https://images.unsplash.com/photo-1608037222022-62649819f8aa?w=800&h=600&fit=crop",
    "https://images.unsplash.com/photo-1602052294200-a8b75e03adfe?w=800&h=600&fit=crop",
    "https://images.unsplash.com/photo-1602052577122-f73b9710adba?w=800&h=600&fit=crop"
  ],
  "library": [
    "https://images.unsplash.com/photo-1595315342809-fa10945ed07c?w=800&h=600&fit=crop",
    "https://images.unsplash.com/photo-1595315343110-9b445a960442?w=800&h=600&fit=crop",
    "https://images.unsplash.com/photo-1577036057060-d318e280b0c2?w=800&h=600&fit=crop",
    "https://images.pexels.com/photos/8499550/pexels-photo-8499550.jpeg?w=800&h=600&fit=crop"
  ],
  "sports": [
    "https://images.unsplash.com/photo-1531124042451-f3ba1765072c?w=800&h=600&fit=crop",
    "https://images.unsplash.com/photo-1759200135568-566eb9ecaa81?w=800&h=600&fit=crop",
    "https://images.pexels.com/photos/2874718/pexels-photo-2874718.jpeg?w=800&h=600&fit=crop",
    "https://images.pexels.com/photos/21937218/pexels-photo-21937218.jpeg?w=800&h=600&fit=crop"
  ],
  "blogs": [
    "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=400&h=225&fit=crop",
    "https://images.unsplash.com/photo-1509062522246-3755977927d7?w=400&h=225&fit=crop",
    "https://images.unsplash.com/photo-1427504494785-3a9ca7044f45?w=400&h=225&fit=crop"
  ],
  "gallery": {
    "kbm": [
      "https://images.unsplash.com/photo-1742549586702-c23994895082?w=400&h=400&fit=crop",
      "https://images.unsplash.com/photo-1589104760192-ccab0ce0d90f?w=400&h=400&fit=crop",
      "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=400&h=400&fit=crop"
    ],
    "ekskul": [
      "https://images.pexels.com/photos/2874718/pexels-photo-2874718.jpeg?w=400&h=400&fit=crop",
      "https://images.unsplash.com/photo-1531124042451-f3ba1765072c?w=400&h=400&fit=crop",
      "https://images.unsplash.com/photo-1577036057060-d318e280b0c2?w=400&h=400&fit=crop"
    ],
    "upacara": [
      "https://images.unsplash.com/photo-1665665160518-097a89d5383e?w=400&h=400&fit=crop",
      "https://images.unsplash.com/photo-1643216710579-a7500b9f2407?w=400&h=400&fit=crop"
    ]
  }
}
$$, 'json', 'Smandapbun site images', true, now()),
      (v_tenant_id, 'page_contact', $$
{
  "contactPage": {
    "id": "contact",
    "slug": "kontak",
    "category": "Contact",
    "title": {
      "id": "Hubungi Kami",
      "en": "Contact Us"
    },
    "description": {
      "id": "Silakan hubungi kami untuk informasi lebih lanjut tentang SMAN 2 Pangkalan Bun.",
      "en": "Please contact us for more information about SMAN 2 Pangkalan Bun."
    }
  },
  "contactInfo": {
    "address": {
      "id": "Jl. Pasanah No. 15, RT 24, Sidorejo, Arut Selatan, Kotawaringin Barat, Kalimantan Tengah, 74111",
      "en": "Jl. Pasanah No. 15, RT 24, Sidorejo, Arut Selatan, Kotawaringin Barat, Kalimantan Tengah, 74111"
    },
    "phone": "082254008080",
    "email": "info@sman2pangkalanbun.sch.id",
    "website": "https://sman2pangkalanbun.sch.id",
    "operationalHours": {
      "id": "Senin - Jumat: 07:00 - 15:00 WIB",
      "en": "Monday - Friday: 07:00 - 15:00 WIB"
    }
  },
  "socialMedia": [
    {
      "platform": "Facebook",
      "url": "https://facebook.com/sman2pangkalanbun",
      "icon": "tabler:brand-facebook"
    },
    {
      "platform": "Instagram",
      "url": "https://instagram.com/sman2pangkalanbun",
      "icon": "tabler:brand-instagram"
    },
    {
      "platform": "YouTube",
      "url": "https://youtube.com/@sman2pangkalanbun",
      "icon": "tabler:brand-youtube"
    },
    {
      "platform": "Twitter",
      "url": "https://twitter.com/sman2pbun",
      "icon": "tabler:brand-twitter"
    }
  ],
  "mapEmbed": "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2542.182637282755!2d111.64716318974263!3d-2.6854176337880564!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x2e08ee30ceed8459%3A0x47c7f285f4b5f9c!2sSMA%20Negeri%202%20Pangkalan%20Bun!5e1!3m2!1sid!2sid!4v1769956242665!5m2!1sid!2sid"
}
$$, 'json', 'Smandapbun contact page', true, now()),
      (v_tenant_id, 'page_organization', $$
{
  "schoolOrganization": {
    "id": "org-school",
    "slug": "struktur-organisasi/sekolah",
    "category": "Profile",
    "title": {
      "id": "Struktur Organisasi Sekolah",
      "en": "School Organizational Structure"
    },
    "positions": [
      {
        "position": { "id": "Kepala Sekolah", "en": "Principal" },
        "name": "Drs. H. Ahmad Sudirman, M.Pd",
        "photo": "/images/staff/kepala-sekolah.jpg"
      },
      {
        "position": { "id": "Wakasek Kurikulum", "en": "Vice Principal of Curriculum" },
        "name": "Drs. Bambang Sutrisno, M.Pd",
        "photo": "/images/staff/wakasek-kurikulum.jpg"
      },
      {
        "position": { "id": "Wakasek Kesiswaan", "en": "Vice Principal of Student Affairs" },
        "name": "Dra. Siti Rahayu, M.Pd",
        "photo": "/images/staff/wakasek-kesiswaan.jpg"
      },
      {
        "position": { "id": "Wakasek Sarana Prasarana", "en": "Vice Principal of Facilities" },
        "name": "Ir. Hendra Wijaya, M.M",
        "photo": "/images/staff/wakasek-sarpras.jpg"
      },
      {
        "position": { "id": "Wakasek Humas", "en": "Vice Principal of Public Relations" },
        "name": "Drs. Agus Purnomo, M.Pd",
        "photo": "/images/staff/wakasek-humas.jpg"
      },
      {
        "position": { "id": "Kepala Tata Usaha", "en": "Head of Administration" },
        "name": "Suparman, S.E",
        "photo": "/images/staff/kepala-tu.jpg"
      }
    ]
  },
  "committeeOrganization": {
    "id": "org-committee",
    "slug": "struktur-organisasi/komite-sekolah",
    "category": "Profile",
    "title": {
      "id": "Struktur Organisasi Komite Sekolah",
      "en": "School Committee Organizational Structure"
    },
    "period": "2023-2026",
    "positions": [
      {
        "position": { "id": "Ketua", "en": "Chairman" },
        "name": "H. Rusdi, S.H., M.H"
      },
      {
        "position": { "id": "Wakil Ketua", "en": "Vice Chairman" },
        "name": "Dr. Ir. Hartono, M.Si"
      },
      {
        "position": { "id": "Sekretaris", "en": "Secretary" },
        "name": "Hj. Nurhayati, S.Pd"
      },
      {
        "position": { "id": "Bendahara", "en": "Treasurer" },
        "name": "Ir. Sulaiman, M.M"
      },
      {
        "position": { "id": "Anggota", "en": "Members" },
        "name": "Drs. Abdullah, Hj. Fatimah, S.E, Ir. Mulyadi"
      }
    ]
  },
  "osisOrganization": {
    "id": "org-osis",
    "slug": "struktur-organisasi/osis",
    "category": "Profile",
    "title": {
      "id": "Struktur Organisasi OSIS",
      "en": "Student Council (OSIS) Organizational Structure"
    },
    "period": "2024/2025",
    "positions": [
      {
        "position": { "id": "Ketua OSIS", "en": "OSIS Chairman" },
        "name": "Muhammad Rizky Pratama",
        "class": "XII MIPA 1"
      },
      {
        "position": { "id": "Wakil Ketua", "en": "Vice Chairman" },
        "name": "Putri Amelia Sari",
        "class": "XII IPS 1"
      },
      {
        "position": { "id": "Sekretaris", "en": "Secretary" },
        "name": "Dewi Kartika",
        "class": "XI MIPA 2"
      },
      {
        "position": { "id": "Bendahara", "en": "Treasurer" },
        "name": "Ahmad Fauzi",
        "class": "XI MIPA 1"
      },
      {
        "position": { "id": "Koordinator Bidang", "en": "Division Coordinators" },
        "name": "Berbagai Siswa dari Kelas X, XI, XII"
      }
    ],
    "divisions": [
      { "id": "Ketakwaan kepada Tuhan YME", "en": "Faith and Devotion" },
      { "id": "Kehidupan Berbangsa dan Bernegara", "en": "Civic Life" },
      { "id": "Pendidikan Karakter", "en": "Character Education" },
      { "id": "Kepemimpinan", "en": "Leadership" },
      { "id": "Keterampilan dan Kewirausahaan", "en": "Skills and Entrepreneurship" },
      { "id": "Kesehatan Jasmani dan Daya Kreasi", "en": "Physical Health and Creativity" },
      { "id": "Persepsi, Apresiasi, dan Kreasi Seni", "en": "Art Perception and Creation" },
      { "id": "Teknologi Informasi dan Komunikasi", "en": "Information Technology" }
    ]
  },
  "mpkOrganization": {
    "id": "org-mpk",
    "slug": "struktur-organisasi/mpk",
    "category": "Profile",
    "title": {
      "id": "Struktur Organisasi MPK",
      "en": "Student Representative Council (MPK) Organizational Structure"
    },
    "period": "2024/2025",
    "positions": [
      {
        "position": { "id": "Ketua MPK", "en": "MPK Chairman" },
        "name": "Annisa Putri Rahmawati",
        "class": "XII MIPA 3"
      },
      {
        "position": { "id": "Wakil Ketua", "en": "Vice Chairman" },
        "name": "Budi Santoso",
        "class": "XII IPS 2"
      },
      {
        "position": { "id": "Sekretaris", "en": "Secretary" },
        "name": "Nur Hidayah",
        "class": "XI MIPA 3"
      },
      {
        "position": { "id": "Anggota", "en": "Members" },
        "name": "Perwakilan setiap kelas"
      }
    ],
    "description": {
      "id": "MPK (Majelis Perwakilan Kelas) adalah lembaga legislatif siswa yang bertugas mengawasi kinerja OSIS dan mewakili aspirasi seluruh siswa SMAN 2 Pangkalan Bun.",
      "en": "MPK (Student Representative Council) is the student legislative body responsible for overseeing OSIS performance and representing the aspirations of all SMAN 2 Pangkalan Bun students."
    }
  }
}
$$, 'json', 'Smandapbun organization page', true, now()),
      (v_tenant_id, 'page_services', $$
{
  "extracurricular": {
    "id": "extracurricular",
    "slug": "ekstrakurikuler",
    "category": "Extracurricular",
    "title": {
      "id": "Ekstrakurikuler",
      "en": "Extracurricular"
    },
    "description": {
      "id": "SMAN 2 Pangkalan Bun menyediakan berbagai kegiatan ekstrakurikuler untuk mengembangkan bakat dan minat siswa.",
      "en": "SMAN 2 Pangkalan Bun provides various extracurricular activities to develop students' talents and interests."
    },
    "activities": [
      { "name": "Pramuka", "category": "Wajib", "schedule": "Jumat, 14:00-17:00", "coach": "Drs. Suryadi" },
      { "name": "PMR (Palang Merah Remaja)", "category": "Pilihan", "schedule": "Sabtu, 08:00-11:00", "coach": "Sri Wahyuni, S.Pd" },
      { "name": "Paskibra", "category": "Pilihan", "schedule": "Sabtu, 13:00-16:00", "coach": "Fajar Kurniawan, S.Pd" },
      { "name": "Rohis", "category": "Pilihan", "schedule": "Jumat, 11:00-12:00", "coach": "Imam Syafi'i, S.Pd.I" },
      { "name": "English Club", "category": "Pilihan", "schedule": "Rabu, 14:00-16:00", "coach": "Drs. Agus Purnomo" },
      { "name": "Karya Ilmiah Remaja (KIR)", "category": "Pilihan", "schedule": "Selasa, 14:00-16:00", "coach": "Dra. Wiwik Hartini" },
      { "name": "Basket", "category": "Pilihan", "schedule": "Senin & Kamis, 15:00-17:00", "coach": "Fajar Kurniawan, S.Pd" },
      { "name": "Voli", "category": "Pilihan", "schedule": "Selasa & Jumat, 15:00-17:00", "coach": "Ahmad Hidayat, S.Pd" },
      { "name": "Futsal", "category": "Pilihan", "schedule": "Rabu & Sabtu, 15:00-17:00", "coach": "Dwi Santoso, S.Pd" },
      { "name": "Badminton", "category": "Pilihan", "schedule": "Senin & Kamis, 15:00-17:00", "coach": "Budi Raharjo" },
      { "name": "Seni Tari", "category": "Pilihan", "schedule": "Sabtu, 08:00-11:00", "coach": "Endang Lestari, S.Pd" },
      { "name": "Paduan Suara", "category": "Pilihan", "schedule": "Rabu, 14:00-16:00", "coach": "Rina Kusumawati, S.Pd" },
      { "name": "Band/Musik", "category": "Pilihan", "schedule": "Jumat, 14:00-17:00", "coach": "Krisna Bayu, S.Kom" },
      { "name": "Jurnalistik", "category": "Pilihan", "schedule": "Sabtu, 09:00-12:00", "coach": "Dra. Siti Rahayu" },
      { "name": "Robotik", "category": "Pilihan", "schedule": "Sabtu, 08:00-11:00", "coach": "Krisna Bayu, S.Kom" },
      { "name": "Debat Bahasa Inggris", "category": "Pilihan", "schedule": "Kamis, 14:00-16:00", "coach": "Linda Permata, S.Pd" },
      { "name": "OSN Club", "category": "Pilihan", "schedule": "Senin-Jumat, 14:00-16:00", "coach": "Tim Guru Mapel" },
      { "name": "Teater", "category": "Pilihan", "schedule": "Sabtu, 13:00-16:00", "coach": "Julia Ratnasari, S.Pd" }
    ]
  },
  "serviceClasses": {
    "id": "service-classes",
    "slug": "kelas-layanan",
    "category": "ServiceClasses",
    "title": {
      "id": "Kelas Layanan",
      "en": "Service Classes"
    },
    "description": {
      "id": "Program kelas layanan untuk siswa berprestasi dan berpotensi khusus.",
      "en": "Service class programs for high-achieving and specially talented students."
    }
  },
  "osn": {
    "id": "osn",
    "slug": "kelas-layanan/osn",
    "category": "OSN",
    "title": {
      "id": "Program OSN (Olimpiade Sains Nasional)",
      "en": "OSN Program (National Science Olympiad)"
    },
    "content": {
      "id": "<p>Program pembinaan Olimpiade Sains Nasional untuk siswa-siswa berprestasi dalam bidang sains dan matematika.</p><h3>Bidang yang Dibina</h3><ul><li>Matematika</li><li>Fisika</li><li>Kimia</li><li>Biologi</li><li>Informatika/Komputer</li><li>Ekonomi</li><li>Astronomi</li></ul>",
      "en": "<p>National Science Olympiad coaching program for students excelling in science and mathematics.</p><h3>Fields Covered</h3><ul><li>Mathematics</li><li>Physics</li><li>Chemistry</li><li>Biology</li><li>Informatics/Computer</li><li>Economics</li><li>Astronomy</li></ul>"
    },
    "schedule": "Senin-Jumat, 14:00-16:00"
  },
  "research": {
    "id": "research",
    "slug": "kelas-layanan/penelitian",
    "category": "Research",
    "title": {
      "id": "Program Penelitian",
      "en": "Research Program"
    },
    "content": {
      "id": "<p>Program pembinaan penelitian ilmiah untuk siswa yang berminat dalam bidang riset dan karya ilmiah.</p><h3>Kompetisi yang Diikuti</h3><ul><li>Lomba Karya Ilmiah Remaja (LKIR)</li><li>Olimpiade Penelitian Siswa Indonesia (OPSI)</li><li>Indonesian Science Project Olympiad (ISPO)</li></ul>",
      "en": "<p>Scientific research coaching program for students interested in research and scientific work.</p><h3>Competitions</h3><ul><li>Youth Scientific Paper Competition</li><li>Indonesian Student Research Olympiad</li><li>Indonesian Science Project Olympiad</li></ul>"
    }
  },
  "laboratory": {
    "id": "laboratory",
    "slug": "laboratorium",
    "category": "Laboratory",
    "title": {
      "id": "Laboratorium",
      "en": "Laboratory"
    },
    "labs": [
      {
        "name": { "id": "Laboratorium Fisika", "en": "Physics Laboratory" },
        "description": { "id": "Dilengkapi alat praktikum mekanika, listrik, dan optik", "en": "Equipped with mechanics, electricity, and optics practicum tools" },
        "capacity": 40
      },
      {
        "name": { "id": "Laboratorium Kimia", "en": "Chemistry Laboratory" },
        "description": { "id": "Memiliki peralatan lengkap untuk praktikum kimia dasar dan lanjut", "en": "Complete equipment for basic and advanced chemistry practicum" },
        "capacity": 40
      },
      {
        "name": { "id": "Laboratorium Biologi", "en": "Biology Laboratory" },
        "description": { "id": "Dilengkapi mikroskop, preparat, dan alat anatomi", "en": "Equipped with microscopes, specimens, and anatomy tools" },
        "capacity": 40
      },
      {
        "name": { "id": "Laboratorium Komputer 1", "en": "Computer Laboratory 1" },
        "description": { "id": "30 unit komputer dengan spesifikasi tinggi", "en": "30 high-spec computer units" },
        "capacity": 30
      },
      {
        "name": { "id": "Laboratorium Komputer 2", "en": "Computer Laboratory 2" },
        "description": { "id": "30 unit komputer untuk praktikum TIK", "en": "30 computer units for ICT practicum" },
        "capacity": 30
      },
      {
        "name": { "id": "Laboratorium Bahasa", "en": "Language Laboratory" },
        "description": { "id": "40 booth dengan headset dan sistem audio visual", "en": "40 booths with headsets and audio-visual system" },
        "capacity": 40
      }
    ]
  },
  "library": {
    "id": "library",
    "slug": "perpustakaan",
    "category": "Library",
    "title": {
      "id": "Perpustakaan",
      "en": "Library"
    },
    "content": {
      "id": "<p>Perpustakaan SMAN 2 Pangkalan Bun merupakan pusat sumber belajar yang menyediakan berbagai koleksi buku dan sumber informasi.</p><h3>Fasilitas</h3><ul><li>Koleksi 12.000+ buku</li><li>E-Library dengan akses digital</li><li>Ruang baca ber-AC</li><li>Area diskusi kelompok</li><li>Komputer untuk akses katalog</li></ul><h3>Jam Operasional</h3><p>Senin - Jumat: 07:00 - 16:00<br>Sabtu: 07:00 - 12:00</p>",
      "en": "<p>SMAN 2 Pangkalan Bun Library is a learning resource center providing various book collections and information sources.</p><h3>Facilities</h3><ul><li>12,000+ book collection</li><li>E-Library with digital access</li><li>Air-conditioned reading room</li><li>Group discussion area</li><li>Computers for catalog access</li></ul><h3>Operating Hours</h3><p>Monday - Friday: 07:00 - 16:00<br>Saturday: 07:00 - 12:00</p>"
    }
  },
  "serviceSurvey": {
    "id": "service-survey",
    "slug": "survei-kepuasan",
    "category": "ServiceSurvey",
    "title": {
      "id": "Survei Kepuasan Layanan",
      "en": "Service Quality Survey"
    },
    "content": {
      "id": "<p>Dalam upaya meningkatkan kualitas layanan, SMAN 2 Pangkalan Bun secara berkala melakukan survei kepuasan terhadap layanan pendidikan.</p><p>Silakan mengisi survei melalui link berikut untuk memberikan masukan dan saran.</p>",
      "en": "<p>In an effort to improve service quality, SMAN 2 Pangkalan Bun regularly conducts satisfaction surveys on educational services.</p><p>Please fill out the survey through the following link to provide feedback and suggestions.</p>"
    },
    "surveyLink": "https://forms.google.com/survey-kepuasan-smanda"
  },
  "studentAffairs": {
    "id": "student-affairs",
    "slug": "kesiswaan",
    "category": "StudentAffairs",
    "title": {
      "id": "Layanan Kesiswaan",
      "en": "Student Affairs Services"
    },
    "services": [
      { "id": "Surat Keterangan Aktif", "en": "Active Student Certificate" },
      { "id": "Surat Rekomendasi", "en": "Recommendation Letter" },
      { "id": "Legalisir Ijazah/Transkrip", "en": "Diploma/Transcript Legalization" },
      { "id": "Konseling Bimbingan", "en": "Counseling Guidance" },
      { "id": "Pengajuan Beasiswa", "en": "Scholarship Application" },
      { "id": "Izin Kegiatan Siswa", "en": "Student Activity Permit" }
    ]
  },
  "mentoringForm": {
    "id": "mentoring-form",
    "slug": "form-pendampingan",
    "category": "Mentoring",
    "title": {
      "id": "Form Pendampingan Ekstrakurikuler",
      "en": "Extracurricular Mentoring Form"
    },
    "content": {
      "id": "<p>Form ini digunakan untuk pengajuan pendampingan kegiatan ekstrakurikuler oleh guru pembina.</p>",
      "en": "<p>This form is used for submitting extracurricular activity mentoring requests by coach teachers.</p>"
    },
    "formLink": "https://forms.google.com/form-pendampingan-ekskul"
  }
}
$$, 'json', 'Smandapbun services page', true, now()),
      (v_tenant_id, 'page_finance', $$
{
  "financePage": {
    "id": "finance",
    "slug": "keuangan",
    "category": "Finance",
    "title": {
      "id": "Transparansi Keuangan",
      "en": "Financial Transparency"
    },
    "description": {
      "id": "SMAN 2 Pangkalan Bun berkomitmen untuk transparansi dalam pengelolaan keuangan sekolah. Berikut adalah laporan penggunaan dana yang bersumber dari BOS, APBD, dan Komite Sekolah.",
      "en": "SMAN 2 Pangkalan Bun is committed to transparency in school financial management. Below are reports on the use of funds from BOS, APBD, and School Committee."
    }
  },
  "bos": {
    "id": "bos",
    "slug": "bos",
    "category": "BOS",
    "tag": "general",
    "title": {
      "id": "Dana BOS (Bantuan Operasional Sekolah)",
      "en": "BOS Fund (School Operational Assistance)"
    },
    "content": {
      "id": "<p>Dana Bantuan Operasional Sekolah (BOS) merupakan program pemerintah untuk mendanai biaya operasional non-personalia sekolah.</p><h3>Penggunaan Dana BOS 2024</h3><table><thead><tr><th>Komponen</th><th>Alokasi</th></tr></thead><tbody><tr><td>Pengembangan Perpustakaan</td><td>Rp 85.000.000</td></tr><tr><td>Kegiatan Pembelajaran</td><td>Rp 250.000.000</td></tr><tr><td>Evaluasi Pembelajaran</td><td>Rp 75.000.000</td></tr><tr><td>Pengelolaan Sekolah</td><td>Rp 120.000.000</td></tr><tr><td>Langganan Daya & Jasa</td><td>Rp 95.000.000</td></tr><tr><td>Pemeliharaan Sarpras</td><td>Rp 180.000.000</td></tr><tr><td>Pembayaran Honor</td><td>Rp 200.000.000</td></tr></tbody></table><p><strong>Total Dana BOS 2024: Rp 1.005.000.000</strong></p>",
      "en": "<p>School Operational Assistance (BOS) fund is a government program to fund non-personnel operational costs of schools.</p><h3>BOS Fund Usage 2024</h3><table><thead><tr><th>Component</th><th>Allocation</th></tr></thead><tbody><tr><td>Library Development</td><td>Rp 85,000,000</td></tr><tr><td>Learning Activities</td><td>Rp 250,000,000</td></tr><tr><td>Learning Evaluation</td><td>Rp 75,000,000</td></tr><tr><td>School Management</td><td>Rp 120,000,000</td></tr><tr><td>Utilities Subscription</td><td>Rp 95,000,000</td></tr><tr><td>Facility Maintenance</td><td>Rp 180,000,000</td></tr><tr><td>Honorarium Payment</td><td>Rp 200,000,000</td></tr></tbody></table><p><strong>Total BOS Fund 2024: Rp 1,005,000,000</strong></p>"
    },
    "reports": [
      { "period": "Triwulan 1 2024", "file": "/documents/bos-tw1-2024.pdf" },
      { "period": "Triwulan 2 2024", "file": "/documents/bos-tw2-2024.pdf" },
      { "period": "Triwulan 3 2024", "file": "/documents/bos-tw3-2024.pdf" }
    ]
  },
  "apbd": {
    "id": "apbd",
    "slug": "apbd",
    "category": "APBD",
    "tag": "general",
    "title": {
      "id": "Dana APBD",
      "en": "APBD Fund"
    },
    "content": {
      "id": "<p>Dana APBD merupakan alokasi anggaran dari Pemerintah Daerah Kabupaten Kotawaringin Barat untuk mendukung operasional dan pengembangan sekolah.</p><h3>Alokasi Dana APBD 2024</h3><table><thead><tr><th>Program</th><th>Anggaran</th></tr></thead><tbody><tr><td>Rehabilitasi Ruang Kelas</td><td>Rp 450.000.000</td></tr><tr><td>Pengadaan Alat Lab</td><td>Rp 175.000.000</td></tr><tr><td>Pengembangan IT</td><td>Rp 125.000.000</td></tr><tr><td>Peningkatan Mutu Pendidikan</td><td>Rp 200.000.000</td></tr></tbody></table><p><strong>Total Dana APBD 2024: Rp 950.000.000</strong></p>",
      "en": "<p>APBD fund is a budget allocation from the Regional Government of Kotawaringin Barat Regency to support school operations and development.</p><h3>APBD Fund Allocation 2024</h3><table><thead><tr><th>Program</th><th>Budget</th></tr></thead><tbody><tr><td>Classroom Rehabilitation</td><td>Rp 450,000,000</td></tr><tr><td>Lab Equipment Procurement</td><td>Rp 175,000,000</td></tr><tr><td>IT Development</td><td>Rp 125,000,000</td></tr><tr><td>Education Quality Improvement</td><td>Rp 200,000,000</td></tr></tbody></table><p><strong>Total APBD Fund 2024: Rp 950,000,000</strong></p>"
    }
  },
  "committee": {
    "id": "committee-finance",
    "slug": "komite",
    "category": "Committee",
    "tag": "general",
    "title": {
      "id": "Dana Komite Sekolah",
      "en": "School Committee Fund"
    },
    "content": {
      "id": "<p>Dana Komite merupakan iuran sukarela dari orang tua/wali siswa yang dikelola secara transparan untuk mendukung kegiatan sekolah yang tidak tercover oleh dana pemerintah.</p><h3>Penggunaan Dana Komite 2024</h3><table><thead><tr><th>Kegiatan</th><th>Anggaran</th></tr></thead><tbody><tr><td>Kegiatan Ekstrakurikuler</td><td>Rp 85.000.000</td></tr><tr><td>Study Tour & Karyawisata</td><td>Rp 120.000.000</td></tr><tr><td>Seragam Pengurus OSIS</td><td>Rp 15.000.000</td></tr><tr><td>Kegiatan Keagamaan</td><td>Rp 45.000.000</td></tr><tr><td>Peningkatan Sarana</td><td>Rp 75.000.000</td></tr></tbody></table><p><strong>Total Dana Komite 2024: Rp 340.000.000</strong></p>",
      "en": "<p>Committee fund is a voluntary contribution from parents/guardians managed transparently to support school activities not covered by government funds.</p><h3>Committee Fund Usage 2024</h3><table><thead><tr><th>Activity</th><th>Budget</th></tr></thead><tbody><tr><td>Extracurricular Activities</td><td>Rp 85,000,000</td></tr><tr><td>Study Tour & Field Trips</td><td>Rp 120,000,000</td></tr><tr><td>OSIS Officer Uniforms</td><td>Rp 15,000,000</td></tr><tr><td>Religious Activities</td><td>Rp 45,000,000</td></tr><tr><td>Facility Improvement</td><td>Rp 75,000,000</td></tr></tbody></table><p><strong>Total Committee Fund 2024: Rp 340,000,000</strong></p>"
    }
  }
}
$$, 'json', 'Smandapbun finance page', true, now()),
      (v_tenant_id, 'page_achievements', $$
{
  "achievementsPage": {
    "id": "achievements",
    "slug": "prestasi",
    "category": "Achievements",
    "title": {
      "id": "Prestasi Siswa & Sekolah",
      "en": "Student & School Achievements"
    },
    "description": {
      "id": "Daftar prestasi yang diraih oleh siswa dan SMAN 2 Pangkalan Bun dalam berbagai bidang.",
      "en": "List of achievements by students and SMAN 2 Pangkalan Bun in various fields."
    }
  },
  "achievements": [
    {
      "year": "2024",
      "title": { "id": "Juara 1 OSN Matematika Tingkat Provinsi", "en": "1st Place Provincial Math OSN" },
      "participant": "Muhammad Rizky Pratama",
      "level": { "id": "Provinsi", "en": "Provincial" },
      "category": "Akademik"
    },
    {
      "year": "2024",
      "title": { "id": "Juara 2 OSN Biologi Tingkat Provinsi", "en": "2nd Place Provincial Biology OSN" },
      "participant": "Putri Amelia Sari",
      "level": { "id": "Provinsi", "en": "Provincial" },
      "category": "Akademik"
    },
    {
      "year": "2024",
      "title": { "id": "Juara 1 Debat Bahasa Inggris Tingkat Kabupaten", "en": "1st Place District English Debate" },
      "participant": "Tim Debat SMAN 2",
      "level": { "id": "Kabupaten", "en": "District" },
      "category": "Akademik"
    },
    {
      "year": "2024",
      "title": { "id": "Juara 1 Lomba Karya Ilmiah Remaja", "en": "1st Place Youth Scientific Paper" },
      "participant": "Annisa Putri R. & Budi Santoso",
      "level": { "id": "Kabupaten", "en": "District" },
      "category": "Akademik"
    },
    {
      "year": "2023",
      "title": { "id": "Juara 2 Basket Putra POPDA", "en": "2nd Place Men's Basketball POPDA" },
      "participant": "Tim Basket SMAN 2",
      "level": { "id": "Kabupaten", "en": "District" },
      "category": "Olahraga"
    },
    {
      "year": "2023",
      "title": { "id": "Juara 1 Voli Putri POPDA", "en": "1st Place Women's Volleyball POPDA" },
      "participant": "Tim Voli Putri SMAN 2",
      "level": { "id": "Kabupaten", "en": "District" },
      "category": "Olahraga"
    },
    {
      "year": "2023",
      "title": { "id": "Juara 3 FLS2N Seni Tari", "en": "3rd Place FLS2N Dance" },
      "participant": "Dewi Kartika",
      "level": { "id": "Provinsi", "en": "Provincial" },
      "category": "Seni"
    },
    {
      "year": "2023",
      "title": { "id": "Juara 1 Paduan Suara HUT RI", "en": "1st Place Independence Day Choir" },
      "participant": "Tim Paduan Suara SMAN 2",
      "level": { "id": "Kabupaten", "en": "District" },
      "category": "Seni"
    },
    {
      "year": "2023",
      "title": { "id": "Juara 2 Paskibra Tingkat Kabupaten", "en": "2nd Place District Flag Hoisting" },
      "participant": "Paskibra SMAN 2",
      "level": { "id": "Kabupaten", "en": "District" },
      "category": "Kepemimpinan"
    },
    {
      "year": "2022",
      "title": { "id": "Sekolah Adiwiyata Nasional", "en": "National Adiwiyata School" },
      "participant": "SMAN 2 Pangkalan Bun",
      "level": { "id": "Nasional", "en": "National" },
      "category": "Institusi"
    },
    {
      "year": "2022",
      "title": { "id": "Juara 1 OSN Fisika Tingkat Kabupaten", "en": "1st Place District Physics OSN" },
      "participant": "Ahmad Fauzi",
      "level": { "id": "Kabupaten", "en": "District" },
      "category": "Akademik"
    },
    {
      "year": "2022",
      "title": { "id": "Juara 1 Robotik Tingkat Provinsi", "en": "1st Place Provincial Robotics" },
      "participant": "Tim Robotik SMAN 2",
      "level": { "id": "Provinsi", "en": "Provincial" },
      "category": "Teknologi"
    }
  ]
}
$$, 'json', 'Smandapbun achievements page', true, now()),
      (v_tenant_id, 'page_alumni', $$
{
  "alumniPage": {
    "id": "alumni",
    "slug": "alumni",
    "category": "Alumni",
    "title": {
      "id": "Profil Alumni",
      "en": "Alumni Profile"
    },
    "description": {
      "id": "Alumni SMAN 2 Pangkalan Bun telah tersebar di berbagai bidang profesional dan memberikan kontribusi nyata bagi masyarakat.",
      "en": "SMAN 2 Pangkalan Bun alumni are spread across various professional fields and make real contributions to society."
    }
  },
  "featuredAlumni": [
    {
      "name": "Dr. Ir. Hasan Basri, M.Sc",
      "graduationYear": "1990",
      "currentPosition": { "id": "Dosen Universitas Gadjah Mada", "en": "Lecturer at Gadjah Mada University" },
      "achievement": { "id": "Pakar Teknik Lingkungan dengan berbagai penelitian internasional", "en": "Environmental Engineering Expert with various international research" },
      "photo": "/images/alumni/hasan-basri.jpg"
    },
    {
      "name": "Hj. Siti Nurhaliza, S.E., M.M",
      "graduationYear": "1995",
      "currentPosition": { "id": "Direktur PT Bank Kalteng", "en": "Director of PT Bank Kalteng" },
      "achievement": { "id": "Pemimpin perempuan dalam dunia perbankan daerah", "en": "Female leader in regional banking" },
      "photo": "/images/alumni/siti-nurhaliza.jpg"
    },
    {
      "name": "dr. Ahmad Yani, Sp.PD",
      "graduationYear": "1998",
      "currentPosition": { "id": "Dokter Spesialis Penyakit Dalam RSUD Pangkalan Bun", "en": "Internal Medicine Specialist at Pangkalan Bun Hospital" },
      "achievement": { "id": "Dokter teladan tingkat provinsi 2022", "en": "Provincial exemplary doctor 2022" },
      "photo": "/images/alumni/ahmad-yani.jpg"
    },
    {
      "name": "Rini Wulandari, S.Kom",
      "graduationYear": "2005",
      "currentPosition": { "id": "Software Engineer di Google Singapore", "en": "Software Engineer at Google Singapore" },
      "achievement": { "id": "Alumni pertama yang bekerja di perusahaan teknologi global", "en": "First alumni working at a global tech company" },
      "photo": "/images/alumni/rini-wulandari.jpg"
    },
    {
      "name": "Lettu. Inf. Budi Prasetyo",
      "graduationYear": "2008",
      "currentPosition": { "id": "Perwira TNI AD", "en": "Indonesian Army Officer" },
      "achievement": { "id": "Penerima Satya Lencana Kesetiaan", "en": "Recipient of Loyalty Medal" },
      "photo": "/images/alumni/budi-prasetyo.jpg"
    },
    {
      "name": "Dewi Permatasari, S.Sn",
      "graduationYear": "2010",
      "currentPosition": { "id": "Penari dan Koreografer Nasional", "en": "National Dancer and Choreographer" },
      "achievement": { "id": "Tampil di berbagai festival seni internasional", "en": "Performed at various international art festivals" },
      "photo": "/images/alumni/dewi-permatasari.jpg"
    }
  ],
  "alumniStats": {
    "totalRegistered": 8500,
    "universities": 120,
    "workingSector": {
      "government": "25%",
      "private": "45%",
      "entrepreneur": "20%",
      "others": "10%"
    }
  },
  "alumniAssociation": {
    "name": { "id": "Ikatan Alumni SMAN 2 Pangkalan Bun (IKASMANDA)", "en": "SMAN 2 Pangkalan Bun Alumni Association" },
    "chairman": "Dr. Ir. Hasan Basri, M.Sc",
    "contact": "alumni@sman2pangkalanbun.sch.id",
    "activities": [
      { "id": "Reuni Akbar Tahunan", "en": "Annual Grand Reunion" },
      { "id": "Beasiswa Alumni", "en": "Alumni Scholarship" },
      { "id": "Bimbingan Karir", "en": "Career Guidance" },
      { "id": "Donasi Sarana Prasarana", "en": "Facility Donation" }
    ]
  }
}
$$, 'json', 'Smandapbun alumni page', true, now()),
      (v_tenant_id, 'page_staff', $$
{
  "staffPage": {
    "id": "staff",
    "slug": "tenaga-pendidik",
    "category": "Profile",
    "title": {
      "id": "Tenaga Pendidik & Kependidikan",
      "en": "Teaching & Administrative Staff"
    },
    "description": {
      "id": "Daftar dewan guru dan staf tata usaha SMA Negeri 2 Pangkalan Bun tahun pelajaran 2025/2026.",
      "en": "Teacher council and administrative staff list for SMA Negeri 2 Pangkalan Bun, academic year 2025/2026."
    }
  },
  "teachingStaff": {
    "id": "teachers",
    "slug": "tenaga-pendidik",
    "category": "Profile",
    "title": {
      "id": "Dewan Guru",
      "en": "Teaching Council"
    },
    "description": {
      "id": "Susunan guru beserta penugasan jabatan dan mata pelajaran yang diampu.",
      "en": "Teacher roster with assigned roles and subjects taught."
    },
    "staff": [
      {
        "name": "Fitriah, S.Pd.",
        "role": "Kepala Sekolah",
        "subject": "-",
        "photo": "/images/staff/teachers/teacher-01.webp"
      },
      {
        "name": "Yasin Mudhofar, S.Pd.",
        "role": "Waka Kurikulum",
        "subject": "Bahasa Indonesia",
        "photo": "/images/staff/teachers/teacher-02.webp"
      },
      {
        "name": "David Pakili, S.Pd.",
        "role": "Waka Humas",
        "subject": "Fisika",
        "photo": "/images/staff/teachers/teacher-03.webp"
      },
      {
        "name": "Anis Nur Aini, S.Pd.",
        "role": "Waka Kesiswaan",
        "subject": "Bahasa Indonesia",
        "photo": "/images/staff/teachers/teacher-04.webp"
      },
      {
        "name": "Muhamad Fadli, S.Pd.",
        "role": "Waka Sarpras",
        "subject": "Sosiologi",
        "photo": "/images/staff/teachers/teacher-05.webp"
      },
      {
        "name": "Muhamad Wahyudi, S.E.",
        "role": "",
        "subject": "PKn",
        "photo": "/images/staff/teachers/teacher-06.webp"
      },
      {
        "name": "Titik Handayani, S.Pd.",
        "role": "",
        "subject": "Kimia",
        "photo": "/images/staff/teachers/teacher-07.webp"
      },
      {
        "name": "Jaitun, S.Pd.",
        "role": "",
        "subject": "Ekonomi",
        "photo": "/images/staff/teachers/teacher-08.webp"
      },
      {
        "name": "M. Nahrowi, S.Pd.",
        "role": "",
        "subject": "Biologi",
        "photo": "/images/staff/teachers/teacher-09.webp"
      },
      {
        "name": "Siti Ramlah, S.Pd.",
        "role": "",
        "subject": "Geografi",
        "photo": "/images/staff/teachers/teacher-10.webp"
      },
      {
        "name": "Herlina Candra, S.Pd.",
        "role": "Koordinator P5",
        "subject": "Bahasa Inggris",
        "photo": "/images/staff/teachers/teacher-11.webp"
      },
      {
        "name": "Suyamni, S.Pd.",
        "role": "",
        "subject": "Sejarah",
        "photo": "/images/staff/teachers/teacher-12.webp"
      },
      {
        "name": "Evita Waindriyani, M.Pd.",
        "role": "Kepala Lab. Biologi",
        "subject": "Biologi",
        "photo": "/images/staff/teachers/teacher-13.webp"
      },
      {
        "name": "Isnaniah, S.Pd.",
        "role": "",
        "subject": "Matematika",
        "photo": "/images/staff/teachers/teacher-14.webp"
      },
      {
        "name": "Irwan Nur, S.Pd.",
        "role": "",
        "subject": "Ekonomi",
        "photo": "/images/staff/teachers/teacher-15.webp"
      },
      {
        "name": "Sugeng Prihantoro, S.Pd.",
        "role": "",
        "subject": "Fisika",
        "photo": "/images/staff/teachers/teacher-16.webp"
      },
      {
        "name": "Elliy Fakhriyah, S.E.",
        "role": "Kepala Perpustakaan",
        "subject": "Ekonomi",
        "photo": "/images/staff/teachers/teacher-17.webp"
      },
      {
        "name": "Fitri Friscaloly, S.Pd.",
        "role": "",
        "subject": "Matematika",
        "photo": "/images/staff/teachers/teacher-18.webp"
      },
      {
        "name": "Caecilia Celin, S.Pd.",
        "role": "",
        "subject": "Seni Budaya",
        "photo": "/images/staff/teachers/teacher-19.webp"
      },
      {
        "name": "Six Yulsermiati L, S.Pd.",
        "role": "",
        "subject": "Fisika",
        "photo": "/images/staff/teachers/teacher-20.webp"
      },
      {
        "name": "Yusli Indrabowo, S.Pd.",
        "role": "",
        "subject": "PJOK",
        "photo": "/images/staff/teachers/teacher-21.webp"
      },
      {
        "name": "Arillia Octavia, S.Pd.",
        "role": "",
        "subject": "Bahasa Indonesia",
        "photo": "/images/staff/teachers/teacher-22.webp"
      },
      {
        "name": "Ridhani Noor, S.Pd.",
        "role": "",
        "subject": "Ekonomi",
        "photo": "/images/staff/teachers/teacher-23.webp"
      },
      {
        "name": "Ari Sitowati, S.Pd.",
        "role": "",
        "subject": "Prakarya dan Kewirausahaan (PKWU)",
        "photo": "/images/staff/teachers/teacher-24.webp"
      },
      {
        "name": "M. Sobirin Oktafia, S.Pd.",
        "role": "",
        "subject": "PJOK",
        "photo": "/images/staff/teachers/teacher-25.webp"
      },
      {
        "name": "Raudatul Jannah, S.Pd.",
        "role": "",
        "subject": "Bahasa Inggris",
        "photo": "/images/staff/teachers/teacher-26.webp"
      },
      {
        "name": "Dellyana, S.Pd.",
        "role": "",
        "subject": "Sejarah",
        "photo": "/images/staff/teachers/teacher-27.webp"
      },
      {
        "name": "Eka Kanty Rahayu, S.Pd.",
        "role": "",
        "subject": "Biologi dan PKWU",
        "photo": "/images/staff/teachers/teacher-28.webp"
      },
      {
        "name": "Sumiatun, S.Pd.H.",
        "role": "",
        "subject": "Agama Hindu",
        "photo": "/images/staff/teachers/teacher-29.webp"
      },
      {
        "name": "Arum Dharmawanti, S.Pd.",
        "role": "",
        "subject": "Bimbingan Konseling (BK)",
        "photo": "/images/staff/teachers/teacher-30.webp"
      },
      {
        "name": "Nahrawi, S.Pd.I",
        "role": "",
        "subject": "Agama Islam",
        "photo": "/images/staff/teachers/teacher-31.webp"
      },
      {
        "name": "Eka Suci Fajariah, M.Pd.",
        "role": "",
        "subject": "Matematika",
        "photo": "/images/staff/teachers/teacher-32.webp"
      },
      {
        "name": "Noor Rachmiyanti, S.T.",
        "role": "",
        "subject": "Informatika",
        "photo": "/images/staff/teachers/teacher-33.webp"
      },
      {
        "name": "Anggi Yulitasari, S.Pd.",
        "role": "",
        "subject": "Kimia dan PKWU",
        "photo": "/images/staff/teachers/teacher-34.webp"
      },
      {
        "name": "Vien Azizah, S.Pd.",
        "role": "",
        "subject": "Prakarya dan Kewirausahaan (PKWU)",
        "photo": "/images/staff/teachers/teacher-35.webp"
      },
      {
        "name": "Wilda Muslimah, S.Pd.",
        "role": "",
        "subject": "Geografi",
        "photo": "/images/staff/teachers/teacher-36.webp"
      },
      {
        "name": "Raniah Rahmawati, S.Pd.",
        "role": "Bendahara BOS",
        "subject": "Geografi",
        "photo": "/images/staff/teachers/teacher-37.webp"
      },
      {
        "name": "Steffi Oktariani, S.Pd.",
        "role": "",
        "subject": "Matematika",
        "photo": "/images/staff/teachers/teacher-38.webp"
      },
      {
        "name": "Fajar Adwi Fani, S.Pd.",
        "role": "",
        "subject": "PKn",
        "photo": "/images/staff/teachers/teacher-39.webp"
      },
      {
        "name": "Farida Yulinda, S.Pd.",
        "role": "",
        "subject": "Kimia",
        "photo": "/images/staff/teachers/teacher-40.webp"
      },
      {
        "name": "Albedri Marpas Yendo, S.Pd.",
        "role": "",
        "subject": "Agama Kristen",
        "photo": "/images/staff/teachers/teacher-41.webp"
      },
      {
        "name": "Alif Rachmad Taufik, S.Pd.",
        "role": "",
        "subject": "PJOK",
        "photo": "/images/staff/teachers/teacher-42.webp"
      },
      {
        "name": "Laras Sufia RJ, S.Pd.",
        "role": "",
        "subject": "Bahasa Indonesia",
        "photo": "/images/staff/teachers/teacher-43.webp"
      },
      {
        "name": "Novira Ismia Jean, S.Pd.",
        "role": "",
        "subject": "Sejarah dan Sosiologi",
        "photo": "/images/staff/teachers/teacher-44.webp"
      },
      {
        "name": "Achmad Jayadi, S.Pd.",
        "role": "",
        "subject": "Agama Islam",
        "photo": "/images/staff/teachers/teacher-45.webp"
      },
      {
        "name": "Mardiana, S.Pd.",
        "role": "",
        "subject": "Matematika",
        "photo": "/images/staff/teachers/teacher-46.webp"
      },
      {
        "name": "Rusydah Marwa Fadhila, S.Pd.I",
        "role": "",
        "subject": "Agama Islam",
        "photo": "/images/staff/teachers/teacher-47.webp"
      },
      {
        "name": "Yulisa Widyaningtyas, M.Pd.",
        "role": "",
        "subject": "Bahasa Inggris",
        "photo": "/images/staff/teachers/teacher-48.webp"
      },
      {
        "name": "Jemmy Ruserna Putra, A.Md.",
        "role": "Operator Dapodik",
        "subject": "-",
        "photo": "/images/staff/teachers/teacher-49.webp"
      }
    ]
  },
  "administrativeStaff": {
    "id": "admin-staff",
    "slug": "tenaga-pendidik",
    "category": "Profile",
    "title": {
      "id": "Staf Tata Usaha",
      "en": "Administrative Staff"
    },
    "description": {
      "id": "Daftar staf tata usaha yang mendukung layanan administrasi sekolah.",
      "en": "Administrative staff supporting school services."
    },
    "staff": [
      {
        "name": "Suprianty",
        "role": "",
        "photo": "/images/staff/admin/admin-01.webp"
      },
      {
        "name": "Maysinah",
        "role": "",
        "photo": "/images/staff/admin/admin-02.webp"
      },
      {
        "name": "Novita Melati Sukma",
        "role": "",
        "photo": "/images/staff/admin/admin-03.webp"
      },
      {
        "name": "Noerholis Majit, S.H.I",
        "role": "",
        "photo": "/images/staff/admin/admin-04.webp"
      }
    ]
  }
}
$$, 'json', 'Smandapbun staff page', true, now()),
      (v_tenant_id, 'page_agenda', $$
{
  "agenda": {
    "id": "agenda",
    "slug": "agenda",
    "category": "Agenda",
    "tag": "general",
    "title": {
      "id": "Agenda Sekolah",
      "en": "School Agenda"
    },
    "events": [
      {
        "date": "2025-07-01",
        "title": {
          "id": "Penerimaan Murid Baru",
          "en": "New Student Admissions"
        },
        "description": {
          "id": "Rentang pelaksanaan 1-4 Juli 2025",
          "en": "Scheduled for July 1-4, 2025"
        }
      },
      {
        "date": "2025-07-07",
        "title": {
          "id": "Pra MPLS",
          "en": "Pre-MPLS Orientation"
        },
        "description": {
          "id": "Pra MPLS tanggal 7-8 Juli 2025",
          "en": "Pre-MPLS held on July 7-8, 2025"
        }
      },
      {
        "date": "2025-07-09",
        "title": {
          "id": "MPLS",
          "en": "MPLS"
        },
        "description": {
          "id": "MPLS berlangsung 9-11 Juli 2025",
          "en": "MPLS runs July 9-11, 2025"
        }
      },
      {
        "date": "2025-09-05",
        "title": {
          "id": "Maulid Nabi Muhammad SAW",
          "en": "Maulid Nabi Holiday"
        },
        "description": {
          "id": "Libur hari besar keagamaan",
          "en": "Religious holiday"
        }
      },
      {
        "date": "2025-12-01",
        "title": {
          "id": "Penilaian Sumatif Semester 1",
          "en": "Semester 1 Summative Assessment"
        },
        "description": {
          "id": "Pelaksanaan 1-5 Desember 2025",
          "en": "Held on December 1-5, 2025"
        }
      },
      {
        "date": "2025-12-08",
        "title": {
          "id": "Penilaian Sumatif Semester 1 (Lanjutan)",
          "en": "Semester 1 Summative Assessment (Cont.)"
        },
        "description": {
          "id": "Pelaksanaan 8-12 Desember 2025",
          "en": "Held on December 8-12, 2025"
        }
      },
      {
        "date": "2025-12-19",
        "title": {
          "id": "Pembagian Raport Semester 1",
          "en": "Semester 1 Report Cards"
        },
        "description": {
          "id": "Pembagian raport semester ganjil",
          "en": "Semester 1 report card distribution"
        }
      },
      {
        "date": "2025-12-22",
        "title": {
          "id": "Libur Semester I",
          "en": "Semester I Break"
        },
        "description": {
          "id": "Libur 22-23 dan 29-31 Desember 2025",
          "en": "Break on December 22-23 and 29-31, 2025"
        }
      },
      {
        "date": "2025-12-25",
        "title": {
          "id": "Hari Raya Natal",
          "en": "Christmas Day"
        },
        "description": {
          "id": "Libur hari besar keagamaan",
          "en": "Religious holiday"
        }
      },
      {
        "date": "2026-01-01",
        "title": {
          "id": "Tahun Baru Masehi",
          "en": "New Year"
        },
        "description": {
          "id": "Libur awal tahun",
          "en": "New year holiday"
        }
      },
      {
        "date": "2026-01-16",
        "title": {
          "id": "Isra Miraj",
          "en": "Isra Miraj"
        },
        "description": {
          "id": "Libur hari besar keagamaan",
          "en": "Religious holiday"
        }
      },
      {
        "date": "2026-02-16",
        "title": {
          "id": "Libur Khusus Puasa",
          "en": "Special Fasting Break"
        },
        "description": {
          "id": "Libur menyesuaikan 16, 18-20 Februari 2026",
          "en": "Break adjusted on February 16 and 18-20, 2026"
        }
      },
      {
        "date": "2026-02-17",
        "title": {
          "id": "Tahun Baru Imlek",
          "en": "Lunar New Year"
        },
        "description": {
          "id": "Libur hari besar",
          "en": "Holiday"
        }
      },
      {
        "date": "2026-02-23",
        "title": {
          "id": "Penguatan Pendidikan Karakter",
          "en": "Character Education Strengthening"
        },
        "description": {
          "id": "Program 23-25 Februari 2026",
          "en": "Program runs February 23-25, 2026"
        }
      },
      {
        "date": "2026-03-19",
        "title": {
          "id": "Hari Raya Nyepi",
          "en": "Nyepi Day"
        },
        "description": {
          "id": "Libur hari besar keagamaan",
          "en": "Religious holiday"
        }
      },
      {
        "date": "2026-03-20",
        "title": {
          "id": "Hari Raya Idul Fitri",
          "en": "Eid al-Fitr"
        },
        "description": {
          "id": "Libur hari besar keagamaan",
          "en": "Religious holiday"
        }
      },
      {
        "date": "2026-04-03",
        "title": {
          "id": "Jumat Agung",
          "en": "Good Friday"
        },
        "description": {
          "id": "Libur hari besar keagamaan",
          "en": "Religious holiday"
        }
      },
      {
        "date": "2026-04-20",
        "title": {
          "id": "Penilaian Sumatif Semester 2",
          "en": "Semester 2 Summative Assessment"
        },
        "description": {
          "id": "Pelaksanaan 20-24 dan 27 April 2026",
          "en": "Held on April 20-24 and 27, 2026"
        }
      },
      {
        "date": "2026-05-27",
        "title": {
          "id": "Hari Raya Idul Adha",
          "en": "Eid al-Adha"
        },
        "description": {
          "id": "Libur hari besar keagamaan",
          "en": "Religious holiday"
        }
      },
      {
        "date": "2026-05-31",
        "title": {
          "id": "Hari Raya Waisak",
          "en": "Vesak Day"
        },
        "description": {
          "id": "Libur hari besar keagamaan",
          "en": "Religious holiday"
        }
      },
      {
        "date": "2026-06-01",
        "title": {
          "id": "Hari Lahir Pancasila",
          "en": "Pancasila Day"
        },
        "description": {
          "id": "Libur nasional",
          "en": "National holiday"
        }
      },
      {
        "date": "2026-06-26",
        "title": {
          "id": "Pembagian Raport Semester 2",
          "en": "Semester 2 Report Cards"
        },
        "description": {
          "id": "Pembagian raport semester genap",
          "en": "Semester 2 report card distribution"
        }
      },
      {
        "date": "2026-06-29",
        "title": {
          "id": "Libur Semester II",
          "en": "Semester II Break"
        },
        "description": {
          "id": "Libur 29-30 Juni 2026",
          "en": "Break on June 29-30, 2026"
        }
      }
    ]
  }
}
$$, 'json', 'Smandapbun agenda page', true, now()),
      (v_tenant_id, 'page_gallery', $$
{
  "gallery": {
    "id": "gallery",
    "slug": "galeri",
    "category": "Gallery",
    "tag": "general",
    "title": {
      "id": "Galeri Foto",
      "en": "Photo Gallery"
    },
    "albums": [
      {
        "title": {
          "id": "Kegiatan Belajar Mengajar",
          "en": "Teaching and Learning Activities"
        },
        "images": [
          "/images/gallery/kbm-1.jpg",
          "/images/gallery/kbm-2.jpg",
          "/images/gallery/kbm-3.jpg"
        ]
      },
      {
        "title": {
          "id": "Ekstrakurikuler",
          "en": "Extracurricular"
        },
        "images": [
          "/images/gallery/ekskul-1.jpg",
          "/images/gallery/ekskul-2.jpg",
          "/images/gallery/ekskul-3.jpg"
        ]
      },
      {
        "title": {
          "id": "Upacara dan Peringatan",
          "en": "Ceremonies and Commemorations"
        },
        "images": [
          "/images/gallery/upacara-1.jpg",
          "/images/gallery/upacara-2.jpg"
        ]
      },
      {
        "title": {
          "id": "Prestasi Siswa",
          "en": "Student Achievements"
        },
        "images": [
          "/images/gallery/prestasi-1.jpg",
          "/images/gallery/prestasi-2.jpg"
        ]
      }
    ]
  }
}
$$, 'json', 'Smandapbun gallery page', true, now()),
      (v_tenant_id, 'page_school_info', $$
{
  "schoolInfo": {
    "id": "school-info",
    "slug": "info-sekolah",
    "category": "Info",
    "tag": "general",
    "title": {
      "id": "Info Sekolah",
      "en": "School Info"
    },
    "content": {
      "id": "<p>Ringkasan kalender pendidikan SMA Provinsi Kalimantan Tengah (Lima Hari Sekolah) tahun ajaran 2025/2026 yang diterapkan di SMAN 2 Pangkalan Bun.</p><h3>Agenda Utama</h3><ul><li>1-4 Juli 2025: Penerimaan Murid Baru</li><li>7-8 Juli 2025: Pra MPLS</li><li>9-11 Juli 2025: MPLS</li><li>1-5 dan 8-12 Desember 2025: Penilaian Sumatif Kelas VI, IX, XII, XIII</li><li>19 Desember 2025: Pembagian Raport Semester 1</li><li>22-23 dan 29-31 Desember 2025: Libur Semester I</li><li>20-24 dan 27 April 2026: Penilaian Sumatif Kelas VI, IX, XII, XIII</li><li>26 Juni 2026: Pembagian Raport Semester 2</li><li>29-30 Juni 2026: Libur Semester II</li></ul><h3>Hari Besar dan Program Khusus</h3><ul><li>5 September 2025: Libur Hari Besar Maulid Nabi Muhammad SAW</li><li>25 Desember 2025: Hari Raya Natal</li><li>1 Januari 2026: Tahun Baru Masehi</li><li>16 Januari 2026: Isra Miraj</li><li>16, 18-20 Februari 2026: Libur Khusus Puasa (menyesuaikan)</li><li>17 Februari 2026: Tahun Baru Imlek</li><li>23-25 Februari 2026: Penguatan Pendidikan Karakter</li><li>19 Maret 2026: Hari Raya Nyepi</li><li>20 Maret 2026: Hari Raya Idul Fitri</li><li>3 April 2026: Jumat Agung</li><li>27 Mei 2026: Hari Raya Idul Adha</li><li>31 Mei 2026: Hari Raya Waisak</li><li>1 Juni 2026: Hari Lahir Pancasila</li></ul>",
      "en": "<p>A summary of the Central Kalimantan five-day school academic calendar for the 2025/2026 year as applied at SMAN 2 Pangkalan Bun.</p><h3>Main Schedule</h3><ul><li>1-4 July 2025: New student admissions</li><li>7-8 July 2025: Pre-MPLS orientation</li><li>9-11 July 2025: MPLS</li><li>1-5 and 8-12 December 2025: Summative assessments for grades VI, IX, XII, XIII</li><li>19 December 2025: Semester 1 report card distribution</li><li>22-23 and 29-31 December 2025: Semester I break</li><li>20-24 and 27 April 2026: Summative assessments for grades VI, IX, XII, XIII</li><li>26 June 2026: Semester 2 report card distribution</li><li>29-30 June 2026: Semester II break</li></ul><h3>Holidays and Special Programs</h3><ul><li>5 September 2025: Maulid Nabi holiday</li><li>25 December 2025: Christmas Day</li><li>1 January 2026: New Year</li><li>16 January 2026: Isra Miraj</li><li>16, 18-20 February 2026: Special fasting break (adjusted)</li><li>17 February 2026: Lunar New Year</li><li>23-25 February 2026: Character education strengthening</li><li>19 March 2026: Nyepi Day</li><li>20 March 2026: Eid al-Fitr</li><li>3 April 2026: Good Friday</li><li>27 May 2026: Eid al-Adha</li><li>31 May 2026: Vesak Day</li><li>1 June 2026: Pancasila Day</li></ul>"
    }
  }
}
$$, 'json', 'Smandapbun school info page', true, now())
    ON CONFLICT (tenant_id, key) DO UPDATE
      SET value = EXCLUDED.value,
          type = EXCLUDED.type,
          description = EXCLUDED.description,
          is_public = EXCLUDED.is_public,
          updated_at = now();
  END IF;
END $seed$;
