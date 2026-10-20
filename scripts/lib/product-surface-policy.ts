/**
 * Product-surface policy (ADR-0146): which web/app technology each kind of
 * surface uses, and the structural rules that keep Lynx out of this repo.
 *
 * ## What this is
 *
 * ADR-0146 decides that persona apps PREFER Lynx (in their own consumer repos)
 * while every admin and every public web surface stays Astro. A decision that
 * lives only in prose is read differently by each agent, so the same six rows
 * are kept here as DATA, plus a classifier that turns a scenario descriptor into
 * a surface kind. `tests/product-surface-policy.test.ts` pins the seven issue
 * scenarios against the classifier and fails if the ADR's decision table and
 * this module drift apart.
 *
 * ## What this is NOT
 *
 * It is not a router, not a runtime dependency of anything under `src/`, and it
 * does not opt anything into Lynx. "Preferred candidate" in the ADR is a
 * recommendation to evaluate Lynx first, not an admission; the PoC gate in the
 * ADR decides adoption per product, in the consumer repo.
 *
 * ## The semantic rule the classifier encodes
 *
 * "App" is defined by persona FUNCTION, not by URL, device or installability.
 * So `installable`, a phone-sized layout and a `/app` path play NO part in
 * choosing a technology for a surface that manages the system: management wins
 * over everything, and an installable admin is `pwa-admin`, not a persona app.
 * Precedence is therefore ordered, and the order is the rule:
 *
 *   1. manages the system, or a person's own part of a site  -> an admin kind
 *   2. meant to be crawled and shared                        -> `public-web`
 *   3. a persona workflow                                    -> a persona-app kind
 *   4. none of the above                                     -> throws (not ready)
 *
 * Fail-closed on purpose: a surface the classifier cannot place is a surface
 * nobody has decided about, which the Definition of Ready (ADR-0146 §6) treats as
 * not ready, rather than one the classifier silently guesses a technology for.
 *
 * ## The structural gate
 *
 * `findLynxPackageReferences`, `findLynxImports` and `isLynxConfigFile` are the
 * pure detectors behind the test that fails if Lynx enters the system of record
 * (a dependency, an import under `src/`, or a `lynx.config.*`). They look at
 * dependency / import / build-config STRUCTURE, never at prose: documentation is
 * free to discuss Lynx, and a word detector would punish exactly that while
 * still missing a dependency spelled differently.
 *
 * Pure: no filesystem, no network. The test does the reading and injects it.
 */

/** The six surface kinds of ADR-0146 §1, in the order the ADR's table lists them. */
export const SURFACE_KINDS = [
  "system-admin",
  "user-admin",
  "public-web",
  "persona-app-native",
  "persona-app-web",
  "pwa-admin"
] as const;

export type SurfaceKind = (typeof SURFACE_KINDS)[number];

export type SurfacePolicy = {
  readonly kind: SurfaceKind;
  /** The technology cell of the ADR decision table, verbatim. */
  readonly technology: string;
  /** The home cell of the ADR decision table, verbatim. */
  readonly homeRepo: string;
  /** The rule cell of the ADR decision table, verbatim. */
  readonly rule: string;
  /** Whether a Lynx proof of concept must pass before this kind ships (ADR-0146 §5). */
  readonly requiresLynxPoc: boolean;
};

/**
 * One row per kind. The `technology`, `homeRepo` and `rule` strings are compared
 * VERBATIM with the cells of the ADR's §1 table, so editing either side without
 * the other turns `tests/product-surface-policy.test.ts` red.
 */
export const SURFACE_POLICIES: Readonly<Record<SurfaceKind, SurfacePolicy>> = {
  "system-admin": {
    kind: "system-admin",
    technology: "Astro SSR (SSG only where viable)",
    homeRepo: "ahliweb/awcms",
    rule: "Stays here under the admin shell; never migrated to Lynx.",
    requiresLynxPoc: false
  },
  "user-admin": {
    kind: "user-admin",
    technology: "Astro SSR when authenticated (SSG per route)",
    homeRepo: "ahliweb/awcms-astro",
    rule: "Stays in awcms-astro, only when the site declares permukaanAdmin (ADR-0070); owner is rejected there.",
    requiresLynxPoc: false
  },
  "public-web": {
    kind: "public-web",
    technology: "Astro SSG/SSR per route",
    homeRepo: "ahliweb/awcms or ahliweb/awcms-astro",
    rule: "Public URLs, SEO metadata, sitemap, canonical, accessibility and crawlability are preserved; never Lynx.",
    requiresLynxPoc: false
  },
  "persona-app-native": {
    kind: "persona-app-native",
    technology: "LynxJS + ReactLynx (preferred candidate)",
    homeRepo: "a separate consumer product repo",
    rule: "Own repo; official API contracts only; no Lynx in the admin or public shell.",
    requiresLynxPoc: true
  },
  "persona-app-web": {
    kind: "persona-app-web",
    technology: "Lynx for Web (only if the PoC passes)",
    homeRepo: "a separate consumer product repo",
    rule: "Only after the PoC gate passes; any fallback or alternative needs its own ADR.",
    requiresLynxPoc: true
  },
  "pwa-admin": {
    kind: "pwa-admin",
    technology: "Astro web app / PWA",
    homeRepo: "the repo of the admin it packages",
    rule: "A PWA is not a reason to replace admin UI with Lynx.",
    requiresLynxPoc: false
  }
};

/**
 * What is true of a surface, stated as facts about FUNCTION. Deliberately has no
 * field for URL shape or screen size: those are not inputs to the decision, and a
 * field for them would invite exactly the argument the ADR closes.
 */
export type ScenarioDescriptor = {
  /** Changes something outside one site's content: modules, users, permissions, audit, tenants. */
  readonly managesSystem: boolean;
  /** A person doing their own part of one site: writing, submitting for review, their own profile. */
  readonly managesOwnPartOfSite: boolean;
  /** Meant to be crawled and shared: public URL, SEO metadata, sitemap. */
  readonly publicSeo: boolean;
  /** A persona workflow: transactional, interaction-intensive, or native-capability-bound. */
  readonly personaWorkflow: boolean;
  /** How the persona reaches it. Ignored unless the surface is a persona workflow. */
  readonly channel: "native-app" | "browser";
  /** Installable (Add to Home Screen / PWA). Never a reason to change technology. */
  readonly installable?: boolean;
};

/** Thrown for a descriptor that fits no row: the surface has not been decided. */
export class UnclassifiedSurfaceError extends Error {
  constructor() {
    super(
      "Surface is unclassified: it neither manages the system, nor is public/SEO, nor is a persona workflow. " +
        "Decide what it is before building it (ADR-0146 §6, Definition of Ready for a new product surface)."
    );
    this.name = "UnclassifiedSurfaceError";
  }
}

/**
 * Map a scenario to its surface kind, in the precedence documented at the top of
 * this file. A descriptor that is BOTH an admin and a persona workflow (a mobile
 * admin, say) is an admin: management wins.
 */
export function classifySurface(descriptor: ScenarioDescriptor): SurfaceKind {
  if (descriptor.managesSystem || descriptor.managesOwnPartOfSite) {
    if (descriptor.installable) return "pwa-admin";
    return descriptor.managesSystem ? "system-admin" : "user-admin";
  }

  if (descriptor.publicSeo) return "public-web";

  if (descriptor.personaWorkflow) {
    return descriptor.channel === "native-app"
      ? "persona-app-native"
      : "persona-app-web";
  }

  throw new UnclassifiedSurfaceError();
}

/* -------------------------------------------------------------------------- */
/*  Structural gate: keep Lynx out of the system of record (ADR-0146 §7)       */
/* -------------------------------------------------------------------------- */

/** The npm scope every Lynx package ships under. */
export const LYNX_PACKAGE_SCOPE = "@lynx-js/";

/**
 * The message every structural failure ends with. It names the ADR, says where
 * Lynx belongs, and says what changing the rule takes, so a failing PR author is
 * told the decision rather than left to guess why a green-looking change is red.
 */
export const LYNX_GATE_REMEDY =
  "ADR-0146: Lynx belongs in a persona-app CONSUMER repo, never in this system-of-record repo " +
  "(no @lynx-js/* dependency, no import from @lynx-js/ under src/, no lynx.config.*). " +
  "Changing this requires a superseding ADR.";

/**
 * Every place in a parsed `package.json` that names a Lynx package, as
 * `json.path: text`. Walks the WHOLE document, keys and string values, so a Lynx
 * package is found in `dependencies`, `devDependencies`, `peerDependencies`,
 * `optionalDependencies`, `overrides`, `resolutions`, `workspaces` and an
 * `npm:@lynx-js/...` alias alike. "Any section" is the point: checking the three
 * famous sections would let a Lynx package in through `overrides`.
 */
export function findLynxPackageReferences(
  packageJson: unknown,
  trail = "$"
): string[] {
  const found: string[] = [];

  if (typeof packageJson === "string") {
    if (packageJson.includes(LYNX_PACKAGE_SCOPE)) {
      found.push(`${trail}: ${packageJson}`);
    }
    return found;
  }

  if (Array.isArray(packageJson)) {
    packageJson.forEach((entry, index) => {
      found.push(...findLynxPackageReferences(entry, `${trail}[${index}]`));
    });
    return found;
  }

  if (packageJson !== null && typeof packageJson === "object") {
    for (const [key, value] of Object.entries(packageJson)) {
      if (key.includes(LYNX_PACKAGE_SCOPE)) {
        found.push(`${trail}.${key}`);
      }
      found.push(...findLynxPackageReferences(value, `${trail}.${key}`));
    }
  }

  return found;
}

/**
 * Module specifiers imported from the Lynx scope in one source file. Matches the
 * import SYNTAXES only (`from "…"`, bare `import "…"`, dynamic `import("…")`,
 * `require("…")`), so a comment or string that merely mentions the package is not
 * an import and does not trip the gate.
 */
export function findLynxImports(source: string): string[] {
  const pattern =
    /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](@lynx-js\/[^"']*)["']/g;
  return [...source.matchAll(pattern)].map((match) => match[1] ?? "");
}

/**
 * Whether a repo-relative path is a Lynx build config (`lynx.config.ts`,
 * `.js`, `.mjs`, `.json`, …) at any depth.
 */
export function isLynxConfigFile(relativePath: string): boolean {
  const base = relativePath.split("/").pop() ?? "";
  return /^lynx\.config\.[^/]+$/.test(base);
}
