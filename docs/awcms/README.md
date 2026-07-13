# Paket Dokumen Teknis AWCMS

Folder ini akan berisi paket dokumen teknis detail (PRD, SRS, ERD/data dictionary, kontrak OpenAPI/AsyncAPI, coding standard, runbook operasional) untuk platform ERP AWCMS — setara dengan `docs/awcms-mini/` di repo [awcms-mini](https://github.com/ahliweb/awcms-mini), namun untuk skop modul ERP dan integrasi bisnis repo ini.

## Status

Repo ini baru pada tahap fondasi ulang (lihat [ADR-0001](../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)) — belum ada modul ERP yang diimplementasikan. Dokumen di folder ini akan ditambahkan **bertahap, mengikuti modul yang benar-benar dibangun**, bukan ditulis di muka untuk modul yang belum ada. Ini untuk menghindari dokumentasi yang cepat basi dan tidak sinkron dengan kode.

## Rencana struktur (mengikuti pola awcms-mini)

| Dokumen                                   | Isi                                                                 | Status        |
| ------------------------------------------ | -------------------------------------------------------------------- | ------------- |
| `01_canvas_induk.md`                      | Ringkasan produk, arsitektur tingkat tinggi, prinsip utama          | Belum ditulis |
| `02_prd_detail_per_modul.md`               | PRD per modul ERP (finance, inventory, procurement, dst.)           | Belum ditulis |
| `03_srs_detail_per_modul.md`               | SRS/kebutuhan teknis per modul                                       | Belum ditulis |
| `04_erd_data_dictionary.md`                | ERD & kamus data per modul                                           | Belum ditulis |
| `05_openapi_asyncapi_detail.md`             | Detail kontrak API/event per modul                                   | Belum ditulis |
| `06_github_issues_detail.md`               | Backlog issue implementasi                                           | Belum ditulis |
| `07_sprint_testing_production_readiness.md` | Strategi test & kesiapan produksi                                    | Belum ditulis |
| `10_template_kode_coding_standard.md`      | Coding standard (mengikuti dasar awcms-mini + penyesuaian ERP)       | Belum ditulis |

Dokumen ditambahkan satu per satu saat modul terkait mulai dikerjakan — lihat [`AGENTS.md`](../../AGENTS.md) untuk alur kerja wajib setiap task.
