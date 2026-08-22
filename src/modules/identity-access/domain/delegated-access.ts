/**
 * Akses terdelegasi — aturan MURNI (ADR-0090, Gelombang 8 PR 8.2 dari #423).
 *
 * Sebuah grant yang ditebus mencetak `awcms_tenant_users` biasa, jadi hampir
 * semua pertanyaan otorisasi sudah terjawab oleh mesin yang ada. Yang TIDAK
 * terjawab olehnya ada di file ini, dan semuanya berbentuk penolakan.
 */

/** Plafon TTL sebuah grant. Basis datanya memaksa 31 hari; ini aturannya. */
export const DELEGATED_ACCESS_MAX_TTL_DAYS = 30;

/** Umur kode penebusan sebelum ia mati tanpa pernah dipakai. */
export const DELEGATED_ACCESS_CODE_TTL_SEC = 60 * 60 * 24; // 24 jam

/**
 * Modul yang TIDAK BOLEH ditulis aktor terdelegasi, apa pun role yang dipilih
 * pelanggan.
 *
 * ## Kenapa satu modul dan bukan daftar aksi
 *
 * Kontrol utama atas seorang partner adalah role yang dipilih pelanggan
 * (ADR-0090). Ada satu hal yang pilihan role TIDAK BISA batasi dengan aman:
 * otoritas access-control. Sebuah aktor terdelegasi yang boleh memberi role,
 * membuat grup, atau menyetel kebijakan dapat menciptakan kuasa yang **hidup
 * melewati grantnya sendiri** — grantnya dicabut, tenant usernya mati, dan
 * baris yang ia berikan kepada orang lain tetap ada. Pencabutan berhenti
 * menjadi pencabutan.
 *
 * Karena itu bentuknya bukan daftar aksi (yang akan menua diam-diam setiap kali
 * `identity_access` menumbuhkan aktivitas baru) melainkan satu kalimat: di
 * modul ini, aktor terdelegasi hanya MEMBACA. Melebarkannya kelak menuntut
 * menyebut aksi mana dan mengapa aksi itu tidak bisa menciptakan persistensi.
 *
 * Kegagalannya juga berpihak dengan benar: terlalu ketat berarti pelanggan
 * mengerjakan sendiri satu langkah, bukan lubang keamanan.
 */
export const DELEGATED_WRITE_FORBIDDEN_MODULE_KEY = "identity_access";

/**
 * Satu-satunya aksi yang tetap boleh di modul itu. `read` saja — bukan
 * `read | list`, karena katalog aksi repo ini memakai `read` untuk keduanya.
 */
export const DELEGATED_ALLOWED_ACTION_IN_FORBIDDEN_MODULE = "read";

/** Jenis aktor yang dibawa baris `awcms_tenant_users`. */
export type PrincipalKind = "user" | "delegated";

/**
 * Deny-only. Mengembalikan `true` HANYA bila permintaan harus ditolak; ia tidak
 * pernah mengizinkan apa pun (aturan lintas-gelombang 3).
 */
export function isDelegatedWriteForbidden(input: {
  principalKind: PrincipalKind;
  moduleKey: string;
  action: string;
}): boolean {
  if (input.principalKind !== "delegated") return false;
  if (input.moduleKey !== DELEGATED_WRITE_FORBIDDEN_MODULE_KEY) return false;

  return input.action !== DELEGATED_ALLOWED_ACTION_IN_FORBIDDEN_MODULE;
}

/**
 * Deny-only. `true` HANYA untuk aktor terdelegasi yang grantnya sudah lewat
 * tanggalnya — atau yang tidak punya baris grant hidup sama sekali.
 *
 * ## Kenapa aturan ini ada di sini dan bukan di jobnya
 *
 * ADR-0090 menjanjikan pencabutan **dan kedaluwarsa** mematikan keanggotaan di
 * transaksi yang sama. Pencabutan punya pelaksana; kedaluwarsa tidak pernah
 * punya. Sebuah sapuan terjadwal — sebaik apa pun jadwalnya — meninggalkan
 * jendela antara detik `expires_at` dan detik timer berikutnya, dan jendela itu
 * PERSIS saat aksesnya seharusnya sudah berhenti. Preseden yang sama sudah
 * tertulis dua kali di repo ini: `isBusinessScopeAssignmentCurrentlyActive` dan
 * `isSoDConflictExceptionCurrentlyValid` keduanya menolak baris yang lewat
 * `effective_to` pada waktu keputusan, dan jobnya cuma membereskan `status`.
 *
 * ## Kenapa `grantLive` dan bukan `expiresAt`
 *
 * Perbandingannya dikerjakan basis data terhadap jamnya sendiri — jam yang sama
 * yang menulis `expires_at`. Membawa `Date` aplikasi ke sini akan membuat
 * gerbangnya bergantung pada dua jam yang sepakat, dan `now()` Postgres adalah
 * instant MULAI TRANSAKSI sehingga setiap keputusan dalam satu permintaan
 * membaca jam yang sama.
 *
 * Aktor biasa (`principalKind` absen atau `"user"`) mendapat `false` sebelum
 * `grantLive` dilihat sama sekali, jadi keputusannya tidak berubah.
 */
export function isDelegatedGrantNotInForce(input: {
  /** `undefined` dibaca sebagai `"user"` — lihat `TenantContext.principalKind`. */
  principalKind?: PrincipalKind;
  /** Dari `resolveDelegatedGrantState`: `expires_at > now()` di baris grantnya. */
  grantLive: boolean;
}): boolean {
  if (input.principalKind !== "delegated") return false;

  return !input.grantLive;
}

export type DelegatedGrantTtlProblem =
  | { ok: true }
  | { ok: false; reason: "expires_in_the_past" | "exceeds_max_ttl" };

/**
 * TTL diperiksa di aplikasi supaya pesannya bisa dibaca manusia, dan LAGI di
 * basis data supaya penulis kedua yang lupa tetap tertolak. Dua angkanya
 * berbeda satu hari dengan sengaja — lihat header `sql/117`.
 */
export function validateDelegatedGrantTtl(
  now: Date,
  expiresAt: Date
): DelegatedGrantTtlProblem {
  if (expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expires_in_the_past" };
  }

  const maxMs = DELEGATED_ACCESS_MAX_TTL_DAYS * 24 * 60 * 60 * 1000;
  if (expiresAt.getTime() - now.getTime() > maxMs) {
    return { ok: false, reason: "exceeds_max_ttl" };
  }

  return { ok: true };
}
