/**
 * License policy for `bun run deps:license:check` (Issue #1173).
 *
 * Two lists, both reviewed in the same PR that changes them:
 *
 * - `ALLOWED_LICENSES` — SPDX identifiers the repository accepts in its
 *   dependency tree without a conversation.
 * - `LICENSE_EXCEPTIONS` — one package (or a family, trailing `*`) whose license
 *   is outside the allow-list, with the reason it is acceptable, who owns that
 *   call, and a date by which it is re-justified or removed.
 *
 * An exception that matches nothing is stale and fails the gate, exactly like
 * `dependency-audit-exceptions.ts`: a list of "things we put up with" must not
 * outlive the thing.
 *
 * A downstream workspace that embeds this repository keeps its own pair in a
 * file of the same shape and passes it with `--policy <path>`; it does not edit
 * this one.
 */
export const ALLOWED_LICENSES: readonly string[] = [
  "MIT",
  "MIT-0",
  "ISC",
  "0BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "CC-BY-4.0",
  "Unlicense",
  "Zlib",
  "Python-2.0",
  // Weak (file-level) copyleft. Accepted because every use here is an
  // unmodified build/test tool (`lightningcss`, `axe-core`) that is not
  // redistributed in the shipped image: MPL-2.0 obliges only the files of the
  // package itself. A modified copy would need an ADR.
  "MPL-2.0"
];

export type LicenseException = {
  /** Exact package name, or a prefix ending in `*`. */
  packageName: string;
  /** The license the package declares (so a CHANGE of license re-opens the question). */
  license: string;
  reason: string;
  owner: string;
  /** ISO date (YYYY-MM-DD). */
  reviewDate: string;
};

export const LICENSE_EXCEPTIONS: readonly LicenseException[] = [
  {
    packageName: "@img/sharp-libvips-*",
    license: "LGPL-3.0-or-later",
    reason:
      "Prebuilt libvips binaries that `sharp` loads as an unmodified shared library. LGPL obliges " +
      "us only to keep the library replaceable, which a dynamically loaded, separately versioned " +
      "npm package is; nothing in this repository links it statically or patches it. A change " +
      "to bundling the binary into our own artefact would need re-review.",
    owner: "maintainer",
    reviewDate: "2027-05-14"
  }
];
