-- Migration: Seed smandapbun profile page and blogs
-- Created: 2026-02-01
-- Purpose: Seed profile page settings and blog posts for smandapbun.

INSERT INTO public.settings (tenant_id, key, value, type, description, is_public, updated_at)
SELECT id,
       'page_profile',
       $profile$
{
  "principalMessage": {
    "id": "principal-message",
    "slug": "sambutan-kepala-sekolah",
    "category": "Profile",
    "title": {
      "id": "Sambutan Kepala Sekolah",
      "en": "Principal's Welcome Message"
    },
    "content": {
      "id": "<p>Assalamu'alaikum Warahmatullahi Wabarakatuh</p><p>Selamat datang di SMA Negeri 2 Pangkalan Bun. Kami meneguhkan visi: \"Terwujudnya Generasi Pelajar yang Beriman, Cerdas, Berprestasi (BERDASI)\".</p><h3>Misi Sekolah</h3><ul><li>Membentuk peserta didik yang beriman dan bertaqwa kepada Tuhan Yang Maha Esa, taat menjalankan ibadah sesuai keyakinannya, menciptakan budaya toleransi kebhinekaan global dan berbudi pekerti luhur.</li><li>Membimbing peserta didik untuk selalu berinovasi, menguasai ilmu pengetahuan dan teknologi digital, santun, hormat kepada guru, orang lain dan menjadi teladan.</li><li>Membentuk peserta didik yang tangguh dan unggul dalam prestasi akademik dan non akademik, melalui pembelajaran yang kreatif berpusat pada siswa, berdiferensiasi mengembangkan kokurikuler dan ekstrakurikuler.</li></ul><h3>Tujuan Satuan Pendidikan</h3><ul><li>Dalam waktu satu tahun, 98% warga sekolah mampu menunjukkan karakter beriman dan bertaqwa kepada Tuhan Yang Maha Esa, taat menjalankan ibadah sesuai keyakinannya, menciptakan budaya toleransi kebhinekaan global dan berbudi pekerti luhur di lingkungan sekolah dan masyarakat.</li><li>Dalam waktu satu tahun, 98% peserta didik mampu menunjukkan capaian pengetahuan, keterampilan, dan sikap untuk menguasai ilmu pengetahuan dan teknologi digital, santun, hormat kepada guru, orang lain dan menjadi teladan.</li><li>Dalam waktu satu tahun, 98% peserta didik mampu menunjukkan potensi yang unggul dalam prestasi akademik dan non akademik, melalui pembelajaran kreatif, kolaboratif, dan komunikatif pada kegiatan intrakurikuler, kokurikuler, dan ekstrakurikuler.</li></ul><h3>Keselarasan Kompetensi Lulusan</h3><p>Standar kompetensi lulusan yang menjadi arah pembelajaran mencakup:</p><ul><li>Keimanan dan ketakwaan terhadap Tuhan Yang Maha Esa</li><li>Kewargaan</li><li>Penalaran kritis</li><li>Kreativitas</li><li>Kolaborasi</li><li>Kemandirian</li><li>Kesehatan</li><li>Komunikasi</li></ul><p>Kerangka kerja Pembelajaran Mendalam dijalankan melalui praktik pedagogis, lingkungan pembelajaran, kemitraan dalam pembelajaran, serta pemanfaatan digital yang konsisten pada intrakurikuler, kokurikuler, ekstrakurikuler, dan budaya sekolah.</p><p>Wassalamu'alaikum Warahmatullahi Wabarakatuh</p>",
      "en": "<p>Assalamu'alaikum Warahmatullahi Wabarakatuh</p><p>Welcome to SMA Negeri 2 Pangkalan Bun. We reaffirm the vision: \"To realize a generation of students who are faithful, intelligent, and achieving (BERDASI)\".</p><h3>School Mission</h3><ul><li>Form students who are faithful and devoted to God Almighty, obedient in worship according to their beliefs, fostering a culture of global diversity tolerance and noble character.</li><li>Guide students to continually innovate, master science and digital technology, be polite, respect teachers and others, and become role models.</li><li>Develop resilient students who excel in academic and non-academic achievement through creative, student-centered, differentiated learning that strengthens co-curricular and extracurricular activities.</li></ul><h3>School Goals</h3><ul><li>Within one year, 98% of the school community demonstrates faithful and devoted character toward God Almighty, obedient in worship according to their beliefs, fostering a culture of global diversity tolerance and noble character in school and society.</li><li>Within one year, 98% of students demonstrate achievements in knowledge, skills, and attitudes to master science and digital technology, be polite, respect teachers and others, and become role models.</li><li>Within one year, 98% of students demonstrate outstanding potential in academic and non-academic achievement through creative, collaborative, and communicative learning in intra-curricular, co-curricular, and extracurricular activities.</li></ul><h3>Graduate Competency Alignment</h3><p>The graduate competency standards guiding learning include:</p><ul><li>Faith and devotion to God Almighty</li><li>Citizenship</li><li>Critical reasoning</li><li>Creativity</li><li>Collaboration</li><li>Independence</li><li>Health</li><li>Communication</li></ul><p>The Deep Learning Framework is implemented through pedagogical practices, learning environments, learning partnerships, and digital utilization across intra-curricular, co-curricular, extracurricular, and school culture activities.</p><p>Wassalamu'alaikum Warahmatullahi Wabarakatuh</p>"
    },
    "author": "Fitriah, S.Pd.",
    "position": "Kepala Sekolah",
    "image": "/images/staff/teachers/teacher-01.webp"
  },
  "history": {
    "id": "history",
    "slug": "sejarah",
    "category": "Profile",
    "title": {
      "id": "Sejarah SMAN 2 Pangkalan Bun 1984-2026",
      "en": "History of SMAN 2 Pangkalan Bun 1984-2026"
    },
    "content": {
      "id": "<p>Sejarah SMAN 2 Pangkalan Bun mencatat perjalanan sejak berdiri pada 20 November 1984 hingga penguatan program di tahun 2026.</p><h3>1984-1989: Perintisan</h3><p>SMA Negeri 2 Pangkalan Bun berdiri pada 20 November 1984. Drs. M.M. Amrullah ditunjuk sebagai pejabat kepala sekolah pertama dengan 2 rombongan belajar, 16 guru, dan 6 staf tata usaha.</p><h3>1989-1993: Penguatan Awal</h3><p>Tahun 1989 kepemimpinan beralih kepada Masrin Unan, B.A. Selama 4 tahun, sekolah berkembang menjadi 5 rombongan belajar dengan 25 guru dan 7 staf tata usaha.</p><h3>1993-1995: Penambahan Fasilitas</h3><p>Pada 1993, H. Hasanuddin G.S. B.A. memimpin. Rombongan belajar bertambah menjadi 9 rombel dengan fasilitas perpustakaan, laboratorium IPA, dan mushalla. Jumlah tenaga pendidik meningkat menjadi 32 orang.</p><h3>1995-2000: Konsolidasi</h3><p>Soepono, B.A. menjabat sebagai kepala sekolah periode 1995-2000. Pada masa ini jumlah guru meningkat menjadi 36 orang.</p><h3>2000-2002: Pengembangan Sarana</h3><p>Mulai tahun 2000, H. Hasanuddin G.S. B.A. kembali memimpin selama dua tahun. Jumlah rombel meningkat menjadi 12, Mushalla Miftahul Ulum dan pagar sekolah diperluas, serta jumlah tenaga pendidik naik menjadi 39 orang.</p><h3>2002-2012: Transformasi Pembelajaran</h3><p>Sunari, S.Pd. menjadi pejabat sementara hingga 31 Maret 2003 dan menyerahkan tugas kepada Yudie, S.E., S.Pd. (2003-2012). Pada periode ini rombel berkembang menjadi 21, jurusan bertambah menjadi IPA, IPS, dan Bahasa, serta pembelajaran Moving Class diterapkan. Sarana pendidikan bertambah melalui ruang kelas baru, laboratorium komputer, laboratorium bahasa, dan laboratorium IPA yang terspesialisasi menjadi Fisika, Kimia, dan Biologi. Sarana olahraga juga berkembang dengan lapangan bulu tangkis dan bola basket. Jumlah guru mencapai 43 orang.</p><h3>2012-2017: Modernisasi Kelas</h3><p>Pada 1 Maret 2012, Khairil Anwar, S.Pd. mengambil alih kepemimpinan. Rombel menjadi 24 dengan 24 ruang kelas (21 di antaranya ber-LCD proyektor), penambahan WC, serta perluasan pagar sekolah. Jumlah tenaga pendidik 36 orang dan sistem Moving Class dihentikan kembali ke model konvensional.</p><h3>2017-2023: Penyegaran Infrastruktur</h3><p>September 2017, Dra. Siti Farida Oktaria, M.Pd. memimpin dan menambah ruang perpustakaan serta laboratorium komputer baru, disertai perbaikan pintu masuk gerbang sekolah.</p><h3>2023-2026: Penguatan Mutu</h3><p>Sejak 20 November 2023, kepemimpinan dilanjutkan oleh Fitriah, S.Pd. dengan jumlah tenaga pendidik 50 orang. Program peningkatan mutu meliputi gerakan sekolah sehat, peresmian SMANDA Water, Marching Band Simfoni Smanda Gemilang, rehabilitasi bangunan sekolah, pembangunan pintu masuk belakang, dan panggung kreasi SMANDA Gemilang. Pada tahun 2026 fokus utama diarahkan pada perbaikan kantin sekolah.</p>",
      "en": "<p>The history of SMAN 2 Pangkalan Bun traces its journey from its establishment on 20 November 1984 through the program focus in 2026.</p><h3>1984-1989: Founding</h3><p>SMAN 2 Pangkalan Bun was founded on 20 November 1984. Drs. M.M. Amrullah served as the first acting principal with 2 study groups, 16 teachers, and 6 administrative staff.</p><h3>1989-1993: Early Growth</h3><p>In 1989 leadership shifted to Masrin Unan, B.A. Over four years the school grew to 5 study groups with 25 teachers and 7 administrative staff.</p><h3>1993-1995: Facility Expansion</h3><p>In 1993 H. Hasanuddin G.S. B.A. led the school. Study groups increased to 9, with a library, science laboratory, and mushalla added. The teaching staff rose to 32.</p><h3>1995-2000: Consolidation</h3><p>Soepono, B.A. served as principal from 1995-2000, increasing the teacher count to 36.</p><h3>2000-2002: Infrastructure Growth</h3><p>Starting in 2000 H. Hasanuddin G.S. B.A. returned for two years. Study groups grew to 12, the Miftahul Ulum mushalla and the school fence were expanded, and teaching staff reached 39.</p><h3>2002-2012: Learning Transformation</h3><p>Sunari, S.Pd. served as interim principal until 31 March 2003 and handed leadership to Yudie, S.E., S.Pd. (2003-2012). During this period study groups expanded to 21, majors grew to Science, Social Studies, and Language, and a Moving Class system was implemented. Facilities expanded with new classrooms, a computer lab, a language lab, and specialized science labs for Physics, Chemistry, and Biology. Sports facilities also grew with badminton and basketball courts. The teaching staff reached 43.</p><h3>2012-2017: Classroom Modernization</h3><p>On 1 March 2012, Khairil Anwar, S.Pd. took over leadership. Study groups reached 24 with 24 classrooms (21 equipped with LCD projectors), additional restrooms, and expanded school fencing. Teaching staff totaled 36, and the Moving Class system was discontinued in favor of the conventional model.</p><h3>2017-2023: Infrastructure Refresh</h3><p>In September 2017 Dra. Siti Farida Oktaria, M.Pd. led the school, adding a new library room and computer laboratory and improving the main entrance gate.</p><h3>2023-2026: Quality Strengthening</h3><p>Since 20 November 2023 leadership has continued under Fitriah, S.Pd. with 50 teaching staff. Quality initiatives include the healthy school movement, the launch of SMANDA Water, the Simfoni Smanda Gemilang marching band, building rehabilitation, a new rear entrance, and the SMANDA Gemilang creative stage. In 2026 the main program focuses on improving the school canteen.</p>"
    },
    "milestones": [
      {
        "year": "1984",
        "event": {
          "id": "SMAN 2 Pangkalan Bun berdiri dengan kepemimpinan Drs. M.M. Amrullah.",
          "en": "SMAN 2 Pangkalan Bun was founded under Drs. M.M. Amrullah."
        }
      },
      {
        "year": "1989",
        "event": {
          "id": "Masrin Unan, B.A. memimpin dan rombel berkembang menjadi 5.",
          "en": "Masrin Unan, B.A. led as study groups grew to 5."
        }
      },
      {
        "year": "1993",
        "event": {
          "id": "H. Hasanuddin G.S. B.A. memperluas fasilitas perpustakaan, lab, dan mushalla.",
          "en": "H. Hasanuddin G.S. B.A. expanded the library, labs, and mushalla."
        }
      },
      {
        "year": "1995",
        "event": {
          "id": "Soepono, B.A. memimpin, jumlah guru meningkat menjadi 36 orang.",
          "en": "Soepono, B.A. led with 36 teachers on staff."
        }
      },
      {
        "year": "2000",
        "event": {
          "id": "Hasanuddin kembali memimpin, rombel menjadi 12 dan mushalla diperluas.",
          "en": "Hasanuddin returned, study groups reached 12 and the mushalla expanded."
        }
      },
      {
        "year": "2003",
        "event": {
          "id": "Yudie, S.E., S.Pd. memimpin, jurusan bertambah dan Moving Class diterapkan.",
          "en": "Yudie, S.E., S.Pd. led with new majors and Moving Class."
        }
      },
      {
        "year": "2012",
        "event": {
          "id": "Khairil Anwar, S.Pd. menambah ruang kelas dan fasilitas LCD.",
          "en": "Khairil Anwar, S.Pd. added classrooms and LCD facilities."
        }
      },
      {
        "year": "2017",
        "event": {
          "id": "Dra. Siti Farida Oktaria, M.Pd. menambah perpustakaan dan lab komputer.",
          "en": "Dra. Siti Farida Oktaria, M.Pd. added a library and computer lab."
        }
      },
      {
        "year": "2023",
        "event": {
          "id": "Fitriah, S.Pd. memimpin dan meluncurkan program peningkatan mutu sekolah.",
          "en": "Fitriah, S.Pd. led quality improvement programs for the school."
        }
      },
      {
        "year": "2026",
        "event": {
          "id": "Program utama diarahkan pada perbaikan kantin sekolah.",
          "en": "Primary programs focus on improving the school canteen."
        }
      }
    ]
  },
  "competencyAlignment": {
    "id": "competency-alignment",
    "slug": "keselarasan-standar-kompetensi",
    "category": "Profile",
    "title": {
      "id": "Keselarasan Standar Kompetensi",
      "en": "Competency Standards Alignment"
    },
    "subtitle": {
      "id": "Keselarasan Tujuan Pendidikan Nasional, Standar Kompetensi Lulusan, dan Kerangka Kerja Pembelajaran Mendalam",
      "en": "Alignment of National Education Goals, Graduate Competency Standards, and the Deep Learning Framework"
    },
    "nationalGoal": {
      "title": {
        "id": "Tujuan Pendidikan Nasional",
        "en": "National Education Goals"
      },
      "reference": {
        "id": "UU No 20 Tahun 2003 tentang Sistem Pendidikan Nasional, Pasal 3",
        "en": "Law No. 20 of 2003 on the National Education System, Article 3"
      },
      "description": {
        "id": "Mengembangkan potensi peserta didik agar menjadi manusia yang beriman dan bertakwa kepada Tuhan Yang Maha Esa, berakhlak mulia, sehat, berilmu, cakap, kreatif, mandiri, dan menjadi warga negara yang demokratis serta bertanggung jawab.",
        "en": "Develop students' potential to become individuals who are faithful and devoted to God Almighty, noble in character, healthy, knowledgeable, capable, creative, independent, and responsible democratic citizens."
      }
    },
    "graduateStandards": {
      "title": {
        "id": "Standar Kompetensi Lulusan",
        "en": "Graduate Competency Standards"
      },
      "reference": {
        "id": "Permendikdasmen No 10 Tahun 2025 tentang SKL, Pasal 4",
        "en": "Regulation No. 10 of 2025 on SKL, Article 4"
      },
      "items": {
        "id": [
          "Keimanan dan ketakwaan terhadap Tuhan Yang Maha Esa",
          "Kewargaan",
          "Penalaran kritis",
          "Kreativitas",
          "Kolaborasi",
          "Kemandirian",
          "Kesehatan",
          "Komunikasi"
        ],
        "en": [
          "Faith and devotion to God Almighty",
          "Citizenship",
          "Critical reasoning",
          "Creativity",
          "Collaboration",
          "Independence",
          "Health",
          "Communication"
        ]
      }
    },
    "learningFramework": {
      "title": {
        "id": "Kerangka Kerja Pembelajaran Mendalam",
        "en": "Deep Learning Framework"
      },
      "items": {
        "id": [
          "Praktik pedagogis",
          "Lingkungan pembelajaran",
          "Kemitraan dalam pembelajaran",
          "Pemanfaatan digital"
        ],
        "en": [
          "Pedagogical practices",
          "Learning environment",
          "Partnerships in learning",
          "Digital utilization"
        ]
      }
    },
    "implementation": {
      "title": {
        "id": "Implementasi Visi, Misi, dan Tujuan dalam Kegiatan Satuan Pendidikan",
        "en": "Implementation of Vision, Mission, and Goals in School Activities"
      },
      "subtitle": {
        "id": "Di SMAN 2 Pangkalan Bun",
        "en": "At SMAN 2 Pangkalan Bun"
      },
      "progressLabel": {
        "id": "Progres Pelaksanaan",
        "en": "Implementation Progress"
      },
      "items": [
        {
          "category": {
            "id": "Intrakurikuler",
            "en": "Intracurricular"
          },
          "progress": {
            "id": "Sering",
            "en": "Often"
          },
          "activities": {
            "id": [
              "Implementasi Pembelajaran Mendalam dengan menerapkan pembelajaran yang lebih kompleks dan berbasis masalah yang aktual dan kontekstual.",
              "Penggunaan dan pemanfaatan TV interaktif dalam pembelajaran.",
              "Pemanfaatan berbagai sumber belajar: Rumah Belajar dan berbagai aplikasi belajar berbasis online."
            ],
            "en": [
              "Implement deep learning by applying more complex, contextual, problem-based learning.",
              "Use interactive TV in learning activities.",
              "Utilize learning resources such as Rumah Belajar and various online learning applications."
            ]
          }
        },
        {
          "category": {
            "id": "Kokurikuler",
            "en": "Co-curricular"
          },
          "progress": {
            "id": "Sering",
            "en": "Often"
          },
          "activities": {
            "id": [
              "Pembelajaran berbasis projek dan pembelajaran berbasis masalah.",
              "Kokurikuler: Generasi Sehat dan Bugar, Peduli dan Berbagi, Aku Cinta Indonesia, Hidup Hemat dan Produktif, Berkarya untuk Sesama dan Bangsa, Hidup Berkelanjutan, serta Gerakan 7 Kebiasaan Anak Indonesia Hebat (G-7KAIH): makan sehat dan bergizi serta berolahraga."
            ],
            "en": [
              "Project-based learning and problem-based learning.",
              "Co-curricular programs: Healthy and Fit Generation, Caring and Sharing, I Love Indonesia, Thrifty and Productive Living, Creating for Community and Nation, Sustainable Living, and the 7 Habits of Great Indonesian Children (G-7KAIH): healthy eating and exercise."
            ]
          }
        },
        {
          "category": {
            "id": "Ekstrakurikuler",
            "en": "Extracurricular"
          },
          "progress": {
            "id": "Sering",
            "en": "Often"
          },
          "activities": {
            "id": [
              "Klub Sains SMANSA.",
              "Program ekstrakurikuler unggulan (LKBB, Marching Band, Tari Tradisional, Modern Dance, Sepak Bola/Futsal, Basket, Voli, Karate).",
              "Kepramukaan, Palang Merah Remaja, Konservasi, Klub Debat Bahasa Indonesia, Klub Debat Bahasa Inggris."
            ],
            "en": [
              "SMANSA Science Club.",
              "Flagship extracurricular programs (LKBB, Marching Band, Traditional Dance, Modern Dance, Soccer/Futsal, Basketball, Volleyball, Karate).",
              "Scouting, Youth Red Cross, Conservation, Indonesian Debate Club, English Debate Club."
            ]
          }
        },
        {
          "category": {
            "id": "Budaya Sekolah",
            "en": "School Culture"
          },
          "progress": {
            "id": "Sering",
            "en": "Often"
          },
          "activities": {
            "id": [
              "Budaya Positif 5 S.",
              "Gerakan Peduli Budaya Lingkungan Hidup Sekolah (GPBLHS).",
              "Program Jumat Berkarakter (Jumat Sehat, Bersih, Beriman, Kreatif)."
            ],
            "en": [
              "Positive culture with the 5 S values.",
              "School Environmental Culture Care Movement (GPBLHS).",
              "Character Friday program (Healthy, Clean, Faithful, Creative Friday)."
            ]
          }
        }
      ]
    },
    "signatory": {
      "placeDate": {
        "id": "Pangkalan Bun, 22 Oktober 2025",
        "en": "Pangkalan Bun, 22 October 2025"
      },
      "title": {
        "id": "Kepala Sekolah",
        "en": "Principal"
      },
      "name": "Fitriah, S.Pd.",
      "idNumber": "NIP 197111291997022003"
    }
  },
  "visionMission": {
    "id": "vision-mission",
    "slug": "visi-misi",
    "category": "Profile",
    "title": {
      "id": "Visi, Misi, dan Tujuan",
      "en": "Vision, Mission, and Goals"
    },
    "subtitle": {
      "id": "SMA Negeri 2 Pangkalan Bun Tahun 2025",
      "en": "SMA Negeri 2 Pangkalan Bun 2025"
    },
    "vision": {
      "id": "Terwujudnya Generasi Pelajar yang Beriman, Cerdas, Berprestasi (BERDASI).",
      "en": "To realize a generation of students who are faithful, intelligent, and achieving (BERDASI)."
    },
    "visionIndicators": [
      {
        "title": {
          "id": "Beriman",
          "en": "Faithful"
        },
        "description": {
          "id": "Bertakwa kepada Tuhan YME, mampu mengamalkan ajaran agamanya, berbudi pekerti luhur, bertanggung jawab, jujur, dan adil.",
          "en": "Devout to God Almighty, able to practice their religious teachings, with noble character, responsible, honest, and fair."
        }
      },
      {
        "title": {
          "id": "Cerdas",
          "en": "Intelligent"
        },
        "description": {
          "id": "Tercapai keseimbangan antara cerdas emosional, spiritual, dan intelektual yang unggul di berbagai bidang kehidupan.",
          "en": "Achieve balance between emotional, spiritual, and intellectual intelligence that excels across fields of life."
        }
      },
      {
        "title": {
          "id": "Berprestasi",
          "en": "Achieving"
        },
        "description": {
          "id": "Tangguh secara fisik dan mental, kompetitif dan tidak mudah menyerah menghadapi tantangan dalam meraih prestasi akademik maupun non akademik.",
          "en": "Resilient physically and mentally, competitive and not easily discouraged when facing challenges in achieving academic and non-academic accomplishments."
        }
      }
    ],
    "mission": {
      "id": [
        "Membentuk peserta didik yang beriman dan bertaqwa kepada Tuhan Yang Maha Esa, taat menjalankan ibadah sesuai keyakinannya, menciptakan budaya toleransi kebhinekaan global dan berbudi pekerti luhur.",
        "Membimbing peserta didik untuk selalu berinovasi, menguasai ilmu pengetahuan dan teknologi digital, santun, hormat kepada guru, orang lain dan menjadi teladan.",
        "Membentuk peserta didik yang tangguh dan unggul dalam prestasi akademik dan non akademik, melalui pembelajaran yang kreatif berpusat pada siswa, berdiferensiasi mengembangkan kokurikuler dan ekstrakurikuler."
      ],
      "en": [
        "Form students who are faithful and devoted to God Almighty, obedient in worship according to their beliefs, fostering a culture of global diversity tolerance and noble character.",
        "Guide students to continually innovate, master science and digital technology, be polite, respect teachers and others, and become role models.",
        "Develop resilient students who excel in academic and non-academic achievement through creative, student-centered, differentiated learning that strengthens co-curricular and extracurricular activities."
      ]
    },
    "goals": {
      "id": [
        "Dalam waktu satu tahun, 98% warga sekolah mampu menunjukkan karakter beriman dan bertaqwa kepada Tuhan Yang Maha Esa, taat menjalankan ibadah sesuai keyakinannya, menciptakan budaya toleransi kebhinekaan global dan berbudi pekerti luhur di lingkungan sekolah dan masyarakat.",
        "Dalam waktu satu tahun, 98% peserta didik mampu menunjukkan capaian pengetahuan, keterampilan, dan sikap untuk menguasai ilmu pengetahuan dan teknologi digital, santun, hormat kepada guru, orang lain dan menjadi teladan.",
        "Dalam waktu satu tahun, 98% peserta didik mampu menunjukkan potensi yang unggul dalam prestasi akademik dan non akademik, melalui pembelajaran kreatif, kolaboratif, dan komunikatif pada kegiatan intrakurikuler, kokurikuler, dan ekstrakurikuler."
      ],
      "en": [
        "Within one year, 98% of the school community demonstrates faithful and devoted character toward God Almighty, obedient in worship according to their beliefs, fostering a culture of global diversity tolerance and noble character in school and society.",
        "Within one year, 98% of students demonstrate achievements in knowledge, skills, and attitudes to master science and digital technology, be polite, respect teachers and others, and become role models.",
        "Within one year, 98% of students demonstrate outstanding potential in academic and non-academic achievement through creative, collaborative, and communicative learning in intra-curricular, co-curricular, and extracurricular activities."
      ]
    },
    "programs": {
      "studentAffairs": {
        "title": {
          "id": "Program Kesiswaan: Beriman",
          "en": "Student Affairs Programs: Faithful"
        },
        "items": {
          "id": [
            "Sholat Jumat dan Zuhur berjamaah.",
            "Literasi kitab suci.",
            "Peringatan hari besar keagamaan.",
            "Laporan orang tua siswa berupa rekap hasil jurnal 7 kebiasaan anak Indonesia hebat.",
            "Latihan Dasar Kepemimpinan Siswa (LDKS) OSIS."
          ],
          "en": [
            "Friday and Dhuhr congregational prayers.",
            "Scripture literacy.",
            "Religious holiday commemorations.",
            "Parent reports summarizing the 7 Habits of Great Indonesian Children journal.",
            "Student Leadership Basic Training (LDKS) for OSIS."
          ]
        }
      },
      "curriculum": {
        "title": {
          "id": "Program Kurikulum: Cerdas",
          "en": "Curriculum Programs: Intelligent"
        },
        "items": {
          "id": [
            "Peningkatan kompetensi guru melalui IHT, Kombel, dan pengelolaan kinerja guru.",
            "Pembelajaran Kecerdasan Koding dan Artifisial (KKA) melalui ekstrakurikuler.",
            "Bimbingan Tes Kemampuan Akademik (TKA).",
            "Bimbingan Olimpiade Sains Nasional (OSN).",
            "Bimbingan bakat-minat kelas XII melanjutkan pendidikan di Perguruan Tinggi.",
            "Sosialisasi pemilihan mata pelajaran pilihan kelas X ke kelas XI."
          ],
          "en": [
            "Improve teacher competence through IHT, Kombel, and teacher performance management.",
            "Coding and Artificial Intelligence (KKA) learning through extracurricular activities.",
            "Academic Ability Test (TKA) guidance.",
            "National Science Olympiad (OSN) guidance.",
            "Guidance on interests and talents for grade XII to continue to higher education.",
            "Socialization of elective subject selection from grade X to grade XI."
          ]
        }
      },
      "publicRelations": {
        "title": {
          "id": "Program Humas: Berprestasi",
          "en": "Public Relations Programs: Achieving"
        },
        "academic": {
          "title": {
            "id": "Bidang Akademik",
            "en": "Academic"
          },
          "items": {
            "id": [
              "Publikasi prestasi akademik melalui media sosial.",
              "Kerja sama dengan Lembaga Pendidikan dan kampus.",
              "Membuat rilis resmi siswa meraih prestasi akademik.",
              "Membuat profil inspiratif di media sosial dan web sekolah."
            ],
            "en": [
              "Publish academic achievements through social media.",
              "Collaboration with educational institutions and universities.",
              "Publish official releases on students' academic achievements.",
              "Create inspiring profiles on social media and the school website."
            ]
          }
        },
        "nonAcademic": {
          "title": {
            "id": "Bidang Non-Akademik",
            "en": "Non-Academic"
          },
          "items": {
            "id": [
              "Publikasi lomba seni, olahraga dan budaya.",
              "Mengadakan perlombaan ajang prestasi dalam rangka HUT Sekolah.",
              "Dokumentasi dan branding digital.",
              "Program penguatan citra sekolah.",
              "Kolaborasi dengan alumni sekolah.",
              "SMANDA News Room."
            ],
            "en": [
              "Publish arts, sports, and cultural competitions.",
              "Hold achievement competitions in celebration of the school's anniversary.",
              "Digital documentation and branding.",
              "School image strengthening program.",
              "Collaboration with school alumni.",
              "SMANDA News Room."
            ]
          }
        }
      }
    },
    "motto": {
      "id": "Beriman, Cerdas, Berprestasi (BERDASI)",
      "en": "Faithful, Intelligent, and Achieving (BERDASI)"
    }
  },
  "schoolCondition": {
    "id": "school-condition",
    "slug": "kondisi-sekolah",
    "category": "Profile",
    "title": {
      "id": "Kondisi Sekolah",
      "en": "School Condition"
    },
    "content": {
      "id": "<p>SMA Negeri 2 Pangkalan Bun terletak di lokasi strategis di pusat Kota Pangkalan Bun dengan luas area sekitar 2,5 hektar. Sekolah ini memiliki lingkungan yang asri dan hijau, mendukung program Adiwiyata yang telah dijalankan.</p><h3>Lokasi dan Aksesibilitas</h3><p>Sekolah mudah dijangkau dengan berbagai moda transportasi dan berada tidak jauh dari pusat kota. Lingkungan sekitar sekolah cukup kondusif untuk kegiatan belajar mengajar.</p><h3>Kondisi Bangunan</h3><p>Seluruh bangunan dalam kondisi baik dan terawat. Renovasi dan pemeliharaan dilakukan secara berkala untuk memastikan kenyamanan dan keamanan seluruh warga sekolah.</p>",
      "en": "<p>SMA Negeri 2 Pangkalan Bun is located in a strategic location in the center of Pangkalan Bun City with an area of approximately 2.5 hectares. The school has a beautiful and green environment, supporting the Adiwiyata program that has been implemented.</p><h3>Location and Accessibility</h3><p>The school is easily accessible by various modes of transportation and is not far from the city center. The environment around the school is quite conducive for teaching and learning activities.</p><h3>Building Condition</h3><p>All buildings are in good and well-maintained condition. Renovation and maintenance are carried out regularly to ensure the comfort and safety of all school members.</p>"
    },
    "statistics": {
      "landArea": "25,000 m²",
      "buildingArea": "8,500 m²",
      "greenArea": "10,000 m²",
      "parkingArea": "2,000 m²"
    }
  },
  "facilities": {
    "id": "facilities",
    "slug": "sarana-prasarana",
    "category": "Profile",
    "title": {
      "id": "Sarana & Prasarana",
      "en": "Facilities & Infrastructure"
    },
    "items": [
      {
        "name": {
          "id": "Ruang Kelas",
          "en": "Classrooms"
        },
        "count": 36,
        "condition": "Baik",
        "description": {
          "id": "Dilengkapi AC dan LCD Projector",
          "en": "Equipped with AC and LCD Projector"
        }
      },
      {
        "name": {
          "id": "Laboratorium IPA",
          "en": "Science Laboratory"
        },
        "count": 3,
        "condition": "Baik",
        "description": {
          "id": "Lab Fisika, Kimia, dan Biologi",
          "en": "Physics, Chemistry, and Biology Labs"
        }
      },
      {
        "name": {
          "id": "Laboratorium Komputer",
          "en": "Computer Laboratory"
        },
        "count": 2,
        "condition": "Baik",
        "description": {
          "id": "60 unit komputer dengan internet",
          "en": "60 computer units with internet"
        }
      },
      {
        "name": {
          "id": "Laboratorium Bahasa",
          "en": "Language Laboratory"
        },
        "count": 1,
        "condition": "Baik",
        "description": {
          "id": "40 booth dengan headset",
          "en": "40 booths with headsets"
        }
      },
      {
        "name": {
          "id": "Perpustakaan",
          "en": "Library"
        },
        "count": 1,
        "condition": "Baik",
        "description": {
          "id": "12,000+ koleksi buku",
          "en": "12,000+ book collection"
        }
      },
      {
        "name": {
          "id": "Masjid",
          "en": "Mosque"
        },
        "count": 1,
        "condition": "Baik",
        "description": {
          "id": "Kapasitas 500 jamaah",
          "en": "Capacity 500 worshippers"
        }
      },
      {
        "name": {
          "id": "Aula",
          "en": "Hall"
        },
        "count": 1,
        "condition": "Baik",
        "description": {
          "id": "Kapasitas 800 orang",
          "en": "Capacity 800 people"
        }
      },
      {
        "name": {
          "id": "Lapangan Olahraga",
          "en": "Sports Field"
        },
        "count": 3,
        "condition": "Baik",
        "description": {
          "id": "Basket, Voli, dan Futsal",
          "en": "Basketball, Volleyball, and Futsal"
        }
      },
      {
        "name": {
          "id": "Kantin",
          "en": "Canteen"
        },
        "count": 1,
        "condition": "Baik",
        "description": {
          "id": "Kantin sehat dan bersih",
          "en": "Healthy and clean canteen"
        }
      },
      {
        "name": {
          "id": "UKS",
          "en": "Health Room"
        },
        "count": 1,
        "condition": "Baik",
        "description": {
          "id": "Dilengkapi peralatan medis dasar",
          "en": "Equipped with basic medical equipment"
        }
      }
    ]
  },
  "adiwiyata": {
    "id": "adiwiyata",
    "slug": "adiwiyata",
    "category": "Profile",
    "title": {
      "id": "Program Adiwiyata",
      "en": "Adiwiyata Program"
    },
    "content": {
      "id": "<p>SMAN 2 Pangkalan Bun telah berhasil meraih penghargaan Sekolah Adiwiyata Nasional sebagai bentuk komitmen dalam menjaga dan melestarikan lingkungan hidup.</p><h3>Program Unggulan</h3><ul><li>Bank Sampah Sekolah</li><li>Taman Toga (Tanaman Obat Keluarga)</li><li>Greenhouse dan Kebun Sekolah</li><li>Program Hemat Energi</li><li>Kantin Bebas Plastik</li></ul>",
      "en": "<p>SMAN 2 Pangkalan Bun has successfully received the National Adiwiyata School award as a form of commitment to protecting and preserving the environment.</p><h3>Featured Programs</h3><ul><li>School Waste Bank</li><li>Medicinal Plant Garden</li><li>Greenhouse and School Garden</li><li>Energy Saving Program</li><li>Plastic-Free Canteen</li></ul>"
    },
    "awards": [
      {
        "year": "2019",
        "title": {
          "id": "Adiwiyata Tingkat Kabupaten",
          "en": "Regency Level Adiwiyata"
        }
      },
      {
        "year": "2020",
        "title": {
          "id": "Adiwiyata Tingkat Provinsi",
          "en": "Provincial Level Adiwiyata"
        }
      },
      {
        "year": "2022",
        "title": {
          "id": "Adiwiyata Nasional",
          "en": "National Adiwiyata"
        }
      }
    ]
  }
}
$profile$,
       'json',
       'Smandapbun profile page',
       true,
       now()
FROM public.tenants
WHERE slug = 'smandapbun'
ON CONFLICT (tenant_id, key) DO UPDATE
  SET value = EXCLUDED.value,
      type = EXCLUDED.type,
      description = EXCLUDED.description,
      is_public = EXCLUDED.is_public,
      updated_at = now();

WITH tenant AS (
  SELECT id FROM public.tenants WHERE slug = 'smandapbun'
)
INSERT INTO public.blogs (
  title,
  slug,
  content,
  excerpt,
  featured_image,
  published_at,
  status,
  tags,
  tenant_id,
  is_active,
  is_public,
  created_at,
  updated_at,
  workflow_state
)
SELECT * FROM (
  SELECT
    $$SMAN 2 Pangkalan Bun Raih Juara OSN Tingkat Provinsi$$ AS title,
    $$sman-2-pangkalan-bun-raih-juara-osn-tingkat-provinsi$$ AS slug,
    $$<p>Dengan bangga kami sampaikan bahwa siswa SMAN 2 Pangkalan Bun telah berhasil menorehkan prestasi gemilang dalam ajang Olimpiade Sains Nasional (OSN) tingkat Provinsi Kalimantan Tengah tahun 2024.</p><p>Muhammad Rizky Pratama, siswa kelas XII MIPA 1, berhasil meraih medali emas pada bidang Matematika dan akan mewakili Kalimantan Tengah di tingkat Nasional.</p><p>Selain itu, Putri Amelia Sari dari kelas XII MIPA 2 juga meraih medali perak pada bidang Biologi.</p>$$ AS content,
    $$Siswa SMAN 2 Pangkalan Bun berhasil meraih juara dalam ajang Olimpiade Sains Nasional tingkat Provinsi Kalimantan Tengah.$$ AS excerpt,
    $$/images/news/osn-2024.jpg$$ AS featured_image,
    '2024-04-15'::timestamptz AS published_at,
    'published'::text AS status,
    ARRAY[$$prestasi$$]::text[] AS tags,
    tenant.id AS tenant_id,
    true AS is_active,
    true AS is_public,
    '2024-04-15'::timestamptz AS created_at,
    '2024-04-15'::timestamptz AS updated_at,
    'published'::text AS workflow_state
  FROM tenant
  UNION ALL
  SELECT
    $$Kegiatan Masa Pengenalan Lingkungan Sekolah (MPLS) 2024$$ AS title,
    $$kegiatan-masa-pengenalan-lingkungan-sekolah$$ AS slug,
    $$<p>Masa Pengenalan Lingkungan Sekolah (MPLS) tahun 2024 telah berlangsung dengan sukses selama tiga hari, dari tanggal 15-17 Juli 2024.</p><p>Kegiatan ini diikuti oleh 420 siswa baru yang akan menempuh pendidikan di SMAN 2 Pangkalan Bun. Para siswa diperkenalkan dengan lingkungan sekolah, tata tertib, dan berbagai program unggulan yang ada.</p>$$ AS content,
    $$SMAN 2 Pangkalan Bun mengadakan kegiatan MPLS untuk menyambut siswa baru tahun ajaran 2024/2025.$$ AS excerpt,
    $$/images/news/mpls-2024.jpg$$ AS featured_image,
    '2024-07-18'::timestamptz AS published_at,
    'published'::text AS status,
    ARRAY[$$kegiatan$$]::text[] AS tags,
    tenant.id AS tenant_id,
    true AS is_active,
    true AS is_public,
    '2024-07-18'::timestamptz AS created_at,
    '2024-07-18'::timestamptz AS updated_at,
    'published'::text AS workflow_state
  FROM tenant
  UNION ALL
  SELECT
    $$Peringatan Hari Pendidikan Nasional 2024$$ AS title,
    $$peringatan-hari-pendidikan-nasional$$ AS slug,
    $$<p>Dalam rangka memperingati Hari Pendidikan Nasional yang jatuh pada tanggal 2 Mei, SMAN 2 Pangkalan Bun menggelar upacara bendera dan berbagai kegiatan lomba.</p>$$ AS content,
    $$SMAN 2 Pangkalan Bun memperingati Hari Pendidikan Nasional dengan berbagai kegiatan.$$ AS excerpt,
    $$/images/news/hardiknas-2024.jpg$$ AS featured_image,
    '2024-05-02'::timestamptz AS published_at,
    'published'::text AS status,
    ARRAY[$$kegiatan$$]::text[] AS tags,
    tenant.id AS tenant_id,
    true AS is_active,
    true AS is_public,
    '2024-05-02'::timestamptz AS created_at,
    '2024-05-02'::timestamptz AS updated_at,
    'published'::text AS workflow_state
  FROM tenant
) rows
ON CONFLICT (slug) DO NOTHING;
