/**
 * Trusted, code-only provenance for the vendored Indonesia administrative
 * region dataset (ADR-0046). ONE source of truth for the upstream identity, the
 * licence, and the official-reference caveat, so the module README, the dataset
 * metadata API response, and the admin screen can never drift apart from each
 * other or from `data/idn-admin-regions/manifest.json`.
 *
 * This is deliberately NOT the per-import metadata stored in
 * `awcms_idn_region_datasets` (commit SHA, checksum, row count of one specific
 * import). This file is static, repo-committed, and true of every import
 * regardless of which upstream commit it carried.
 */

/** Upstream GitHub repository this module's dataset is vendored from. */
export const IDN_ADMIN_REGIONS_SOURCE_REPOSITORY =
  "https://github.com/cahyadsn/wilayah";

/** Upstream folder within that repository holding the SQL dumps. */
export const IDN_ADMIN_REGIONS_SOURCE_PATH =
  "https://github.com/cahyadsn/wilayah/tree/master/db";

/** Upstream licence — preserved verbatim under `data/idn-admin-regions/upstream/`. */
export const IDN_ADMIN_REGIONS_SOURCE_LICENSE = "MIT";

/**
 * Repo-relative path of the ONE vendored file this module imports. The three
 * sibling files (islands/population/area) are vendored from the same commit but
 * read by nothing yet — see `data/idn-admin-regions/manifest.json`.
 */
export const IDN_ADMIN_REGIONS_DUMP_PATH =
  "data/idn-admin-regions/upstream/cahyadsn-wilayah/db/wilayah.sql";

/** Repo-relative path of the provenance manifest covering every vendored file. */
export const IDN_ADMIN_REGIONS_MANIFEST_PATH =
  "data/idn-admin-regions/manifest.json";

/**
 * Upstream's own description of what the dataset is. Recorded verbatim rather
 * than paraphrased so an operator can quote it directly.
 */
export const IDN_ADMIN_REGIONS_UPSTREAM_STATEMENT =
  "Kode dan Data Wilayah Administrasi Pemerintahan dan Kode Pulau Indonesia sesuai Kepmendagri.";

/**
 * The decree cited by the header of the file this module actually imports
 * (`db/wilayah.sql`).
 *
 * Recorded per FILE, not once for the whole dataset: upstream's sibling dumps
 * cite different decrees (`db/wilayah_pulau.sql` says 300.2.2-2430/2025), and
 * `awcms-mini` — where this module originated — recorded a single blanket
 * statement naming 2430 for everything, which is not what the imported file
 * says. The number an operator will be asked to justify in an audit is the one
 * on the file whose rows are being served, so that is the one this constant
 * carries and the importer stores on the dataset row.
 */
export const IDN_ADMIN_REGIONS_DUMP_DECREE_REFERENCE =
  "Kepmendagri No 300.2.2-2138 Tahun 2025";

/**
 * Official-reference caveat — MUST be surfaced wherever this dataset is shown to
 * an operator (module README, dataset metadata API, admin screen). This is a
 * third-party community packaging of the decree, not a feed from Kementerian
 * Dalam Negeri: AWCMS never claims to publish this data, and it does not replace
 * an operator's own legal/compliance reference to the decree itself.
 */
export const IDN_ADMIN_REGIONS_OFFICIAL_REFERENCE_CAVEAT =
  "This dataset is a third-party, community-packaged copy of Indonesia administrative region data (cahyadsn/wilayah, MIT License), not an official Kementerian Dalam Negeri (Kemendagri) API or export. It should not be treated as a substitute for an operator's own official legal/compliance reference.";

/** Everything the dataset metadata API and the admin screen need, in one object. */
export const IDN_ADMIN_REGIONS_PROVENANCE = {
  repository: IDN_ADMIN_REGIONS_SOURCE_REPOSITORY,
  sourcePath: IDN_ADMIN_REGIONS_SOURCE_PATH,
  license: IDN_ADMIN_REGIONS_SOURCE_LICENSE,
  dumpPath: IDN_ADMIN_REGIONS_DUMP_PATH,
  manifestPath: IDN_ADMIN_REGIONS_MANIFEST_PATH,
  upstreamStatement: IDN_ADMIN_REGIONS_UPSTREAM_STATEMENT,
  decreeReference: IDN_ADMIN_REGIONS_DUMP_DECREE_REFERENCE,
  officialReferenceCaveat: IDN_ADMIN_REGIONS_OFFICIAL_REFERENCE_CAVEAT
} as const;
