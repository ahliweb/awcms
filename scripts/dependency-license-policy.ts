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
  "Python-2.0"
  // No copyleft license is allowed globally: each one is a reasoned, dated
  // `LICENSE_EXCEPTIONS` entry below, so a NEW MPL/LGPL package, runtime or
  // not, stops the gate instead of passing on a list written for another one.
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

/**
 * What redistribution means here: `Dockerfile.production` installs
 * `--production` dependencies and copies that `node_modules` into the runtime
 * image, so every runtime-reachable package below IS shipped in the image
 * (build-only ones are not). Each package keeps its own license text inside its
 * directory, which is how the image carries the notice these licenses require;
 * nothing is modified. Modifying any of them, or bundling one into our own
 * artefact, needs an ADR before it needs a new date here.
 */
export const LICENSE_EXCEPTIONS: readonly LicenseException[] = [
  {
    packageName: "@img/sharp-libvips-*",
    license: "LGPL-3.0-or-later",
    reason:
      "Prebuilt libvips binaries that `sharp` loads as an unmodified shared library, and they ARE " +
      "copied into the production image with `sharp` (runtime-reachable). LGPL obliges us to keep the " +
      "library replaceable and to carry its license, which a dynamically loaded, separately " +
      "versioned npm package with its own LICENSE file is; nothing in this repository links it " +
      "statically or patches it. A change to bundling the binary into our own artefact would need an ADR.",
    owner: "maintainer",
    reviewDate: "2027-05-14"
  },
  {
    packageName: "lightningcss*",
    license: "MPL-2.0",
    reason:
      "CSS transformer that Vite loads, reachable from the production dependencies (astro -> vite) and " +
      "therefore copied into the runtime image with its platform binaries. MPL-2.0 is file-level " +
      "copyleft: it obliges us only for the files of the package itself, which we ship unmodified with " +
      "its own LICENSE and whose source is public upstream. A patched copy would need an ADR.",
    owner: "maintainer",
    reviewDate: "2027-05-14"
  },
  {
    packageName: "axe-core",
    license: "MPL-2.0",
    reason:
      "Accessibility test engine, a development/test dependency that `--production` installs omit, so " +
      "it is not in the shipped image. File-level copyleft on its own files only; used unmodified.",
    owner: "maintainer",
    reviewDate: "2027-05-14"
  },
  {
    packageName: "@axe-core/playwright",
    license: "MPL-2.0",
    reason:
      "Playwright binding for axe-core, a development/test dependency omitted by `--production` " +
      "installs. File-level copyleft on its own files only; used unmodified.",
    owner: "maintainer",
    reviewDate: "2027-05-14"
  }
];
