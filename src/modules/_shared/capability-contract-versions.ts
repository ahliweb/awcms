/**
 * Global capability contract version registry (Issue #741, epic #738
 * `platform-evolution`, Wave 1, ADR-0015).
 *
 * `ModuleCapabilityContract.provides`/`.consumes` (`module-contract.ts`,
 * Issue #681/ADR-0011) name capabilities as plain strings with NO version
 * — sufficient for the in-monolith ports-and-adapters pattern ADR-0011
 * defines, where a source-boundary test
 * (`tests/unit/module-boundary.test.ts`) is enough to keep provider and
 * consumer in sync, because both sides always ship in the same build. A
 * derived repository's compatibility manifest (ADR-0015) needs something
 * ADR-0011 deliberately doesn't: a way to declare "I was written against
 * version X of capability Y" and have that checked against a NEWER base
 * release that might have changed the port's shape — the two sides no
 * longer ship in the same build once a derived repository vendors an
 * older base checkout.
 *
 * This is a FIFTH independent versioning scheme (see `module-
 * contract.ts`'s own `MODULE_CONTRACT_VERSION` doc comment for the first
 * four: package release, REST contract, event contract, module descriptor
 * contract — all ADR-0008/#741 precedent) — one SemVer per capability
 * KEY, bumped only when that capability's own port interface
 * (`_shared/ports/*.ts`) shape changes:
 *
 * - **MAJOR** — the port interface's method signature changes in a
 *   breaking way (parameter removed/retyped, return shape changed).
 * - **MINOR** — a new optional method/field is added to the port
 *   interface, backward-compatible for existing adapters.
 * - **PATCH** — documentation-only clarification.
 *
 * Every capability a BASE module `provides` today is listed here at
 * `1.0.0` — a first declaration (same "not a stability milestone, just
 * the first assigned number" framing `MODULE_CONTRACT_VERSION` documents
 * for itself), not a claim these ports have reached some maturity bar.
 * Adding a new base capability: add one entry here in the SAME PR that
 * adds the `provides` string to the owning module's `module.ts` — this
 * registry is intentionally a flat, hand-maintained map (mirrors
 * `ALLOWED_PUBLIC_OPERATIONS`/`ROUTE_PARITY_EXEMPTIONS` in
 * `scripts/api-spec-check.ts`: one reviewed list everyone sees in the
 * diff, not an implicit convention).
 *
 * A derived repository's OWN capabilities (things it `provides` from its
 * own contributed modules, e.g. the fixture's `example_crm_directory`)
 * are NOT expected to appear here — this registry only versions
 * capabilities the BASE repository provides. A derived repository's
 * compatibility manifest declares versions for its OWN capabilities
 * directly (self-consistency, checked against the manifest's own
 * `capabilities.provides` list) — see
 * `src/modules/module-management/domain/extension-compatibility.ts`.
 */
export const CAPABILITY_CONTRACT_VERSIONS: Readonly<Record<string, string>> =
  Object.freeze({
    // profile_identity provides (Issue #748, epic #738 platform-evolution
    // Wave 2) — no in-repo consumer yet, same "port defined ahead of
    // consumer wiring" precedent as `legal-hold-guard-port.ts`. This is the
    // only capability in this base whose OWNING module (`profile_identity`)
    // actually ships here.
    //
    // The content capabilities `news_media`/`public_content`/`social_publishing`
    // that awcms-mini carries were REMOVED (Issue #183 F4): their owning CMS
    // modules (news_portal/blog_content/social_publishing) are excluded from the
    // base by the `no-content-website-modules` divergence (ADR-0022), so listing
    // their per-capability versions here made this base's "what I provide"
    // contract dishonest (see the family compatibility manifest). A derived
    // content application declares those in its OWN compatibility manifest.
    party_directory: "1.0.0"
  });
