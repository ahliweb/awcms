# `data/idn-admin-regions/` — vendored Indonesia administrative region dataset

Source data for the `idn_admin_regions` module ([ADR-0046](../../docs/adr/0046-idn-admin-regions-module-admission.md)).
It lives outside `src/` because these are third-party data files, not
TypeScript sources.

```text
data/idn-admin-regions/
├── README.md                 ← this file
├── NOTICE.md                 ← upstream attribution + licence + official-reference caveat
├── manifest.json             ← provenance: repo, commit, per-file sha256/bytes/decree
└── upstream/cahyadsn-wilayah/
    ├── LICENSE               ← upstream MIT licence, verbatim
    ├── checksums.sha256      ← sha256 of every vendored file
    └── db/
        ├── wilayah.sql       ← IMPORTED: 91,599 administrative regions
        ├── wilayah_pulau.sql ← vendored only (islands)
        ├── wilayah_penduduk.sql ← vendored only (population)
        └── wilayah_luas.sql  ← vendored only (area)
```

## Why the files are committed instead of downloaded

The import must be **deterministic and offline**: every gate in this repo runs
without network access, offline/LAN deployment is a supported class, and "which
region version is this build running?" has to be answerable from the commit
rather than from whatever the internet returned on the day someone ran the
import. The cost — about 4.2 MB, once — is accepted deliberately (ADR-0046 §6).

## Rules for changing anything here

1. **Never edit a vendored file.** Updating the dataset means vendoring a NEW
   upstream commit's files, refreshing `manifest.json` + `checksums.sha256`, and
   importing it as a new dataset version. The previous version's rows stay in
   the database untouched — that is what makes rollback possible.
2. **Recompute the checksums in the same commit.** They are verified by
   `tests/idn-admin-regions-vendor-manifest.test.ts`, which also asserts that a
   file's recorded decree number really appears in that file's own header.
3. **Keep the EOL bytes.** `.gitattributes` marks this subtree `binary`;
   `db/wilayah.sql` is CRLF upstream and normalising it would invalidate every
   checksum recorded here.
4. **Keep the caveat.** See `NOTICE.md` — this is a community packaging of the
   decree, not an official Kemendagri feed.

## Importing

```bash
bun run idn-regions:import            # dry run — parse, validate, report, write nothing
bun run idn-regions:import --commit   # write one new dataset version (status: validated)
```

Activation is a separate, audited admin action (API/admin screen), never a side
effect of importing — see the module's [README](../../src/modules/idn-admin-regions/README.md).
