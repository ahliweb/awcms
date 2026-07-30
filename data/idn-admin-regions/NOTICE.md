# NOTICE — vendored third-party dataset

This directory contains files copied **verbatim** from a third-party project.
They are not AWCMS code and are not covered by the AWCMS licence.

## Upstream

| Field      | Value                                                                 |
| ---------- | --------------------------------------------------------------------- |
| Project    | `cahyadsn/wilayah` — <https://github.com/cahyadsn/wilayah>            |
| Source dir | <https://github.com/cahyadsn/wilayah/tree/master/db>                  |
| Licence    | MIT — full text in `upstream/cahyadsn-wilayah/LICENSE`                |
| Commit     | `cae306278e5be616c83ba2d8096b00767f45b5fe` (branch `master`)          |
| Copyright  | © 2025 cahya dsn (see the upstream LICENSE file for the exact notice) |

The upstream project describes its own data as:

> Kode dan Data Wilayah Administrasi Pemerintahan dan Kode Pulau Indonesia
> sesuai Kepmendagri.

The decree number differs per file and is recorded per file in
[`manifest.json`](manifest.json) — `db/wilayah.sql`, the only file this repo's
code imports, cites **Kepmendagri No 300.2.2-2138 Tahun 2025**.

## Official-reference caveat (do not remove)

This is a **third-party, community-packaged copy** of Indonesia administrative
region data — **not** an official Kementerian Dalam Negeri (Kemendagri) API or
export. AWCMS never claims to be the publisher of this data, and this dataset
does **not** replace an operator's own legal/compliance reference to the actual
Kemendagri decree where that matters.

The same caveat is carried in code
(`src/modules/idn-admin-regions/domain/source-provenance.ts`), returned by the
dataset metadata API, and shown on the admin screen. All of them read from that
one constant so they cannot drift apart.

## Integrity

`upstream/cahyadsn-wilayah/checksums.sha256` records the sha256 of every
vendored file. `tests/idn-admin-regions-vendor-manifest.test.ts` recomputes them
from the files on disk and cross-checks `manifest.json`, so a modified,
truncated, or swapped dataset fails the build rather than being imported and
served as if it were this one.
