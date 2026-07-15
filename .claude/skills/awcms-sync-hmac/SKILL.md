---
name: awcms-sync-hmac
description: Amankan sinkronisasi offline-online AWCMS dengan HMAC signature dan anti-replay. Gunakan saat implementasi sync push/pull, verifikasi request node, atau R2 object queue. Sesuai doc 08 & 10.
---

# AWCMS — Sync HMAC & Offline Sync

Ikuti `docs/awcms/08_sop_operasional_user_guide.md` dan `docs/awcms/10_template_kode_coding_standard.md`.

## Signature

```text
signature = HMAC(secret, "<timestamp>.<body>")
```

Header: `X-AWCMS-Node-ID`, `X-AWCMS-Timestamp`, `X-AWCMS-Signature`.

## Aturan validasi

1. Signature **wajib** ada; tolak jika kosong.
2. Timestamp valid; **max skew default 300 detik** (anti replay).
3. **Timing-safe compare** untuk signature.
4. Node inactive ditolak.
5. Duplicate event idempotent (tidak dobel) — lihat `awcms-idempotency`.
6. Posted transaction **immutable**; sync tidak menimpa transaksi posted.
7. HMAC secret & R2 credential hanya dari **environment**.

## Alur

```mermaid
sequenceDiagram
  participant N as Node
  participant S as Server
  N->>S: push (Node-ID + Timestamp + Signature + body)
  S->>S: cek node aktif · verifikasi HMAC · cek skew · idempotent
  S-->>N: ack + checkpoint (atau tolak)
  N->>S: pull update
  S-->>N: event baru
  Note over N,S: Conflict high-risk → resolusi manual + audit
```

## R2 object queue (opsional)

- File lokal disimpan dulu, masuk `awcms_object_sync_queue`.
- Upload saat online; **checksum diverifikasi**; retry aman.

## Verifikasi (test)

- HMAC valid diterima; invalid/expired ditolak.
- Duplicate batch idempotent; checkpoint updated.
- Conflict tercatat immutable + audit.
