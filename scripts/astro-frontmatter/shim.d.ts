/**
 * The shims that make an extracted `.astro` frontmatter compile on its own
 * (`check:astro-frontmatter:check`, closing standards finding C4).
 *
 * Each one is a deliberate loss of coverage, so each is named here rather than
 * discovered later by someone wondering why a real error did not fire.
 *
 * Excluded from the root `tsconfig.json` — nothing but the frontmatter project
 * may see these declarations, or `declare module "*.astro"` would start
 * answering for real imports in the main typecheck.
 *
 * ## This file has NO top-level `import` or `export`, deliberately
 *
 * That keeps it an ambient SCRIPT. A `.d.ts` with either becomes a module, and
 * `declare module "*.astro"` inside a module is read as *augmentation* of an
 * existing module rather than a wildcard declaration — so every `.astro` import
 * still fails to resolve, and the gate reports 53 phantom TS2307s instead of
 * the real defects. Use inline `import("…")` types below instead of an import
 * statement.
 */

/**
 * 1. `.astro` component imports.
 *
 * `tsc` cannot parse `.astro`, so `import AdminLayout from "./AdminLayout.astro"`
 * has no type to resolve. Declared as an opaque component value.
 *
 * **What this costs:** a component's `Props` are NOT checked at its call sites.
 * Passing a misspelled prop, or omitting a required one, still compiles. That
 * is the one thing `astro check` does which this cannot, and it is why the
 * `astro-files-not-type-checked` divergence is narrowed rather than removed.
 */
declare module "*.astro" {
  const component: unknown;
  export default component;
}

declare module "*.astro?raw" {
  const contents: string;
  export default contents;
}

/**
 * 2. The `Astro` global.
 *
 * Inside a real `.astro` file the compiler injects this. In an extracted `.ts`
 * it is a free identifier, so `tsc` reports `Astro` as a namespace used as a
 * value — 201 times across this repo.
 *
 * `App.Locals` still applies (`src/env.d.ts`), so `Astro.locals.ssrContext` and
 * `Astro.locals.locale` ARE checked, which covers the frontmatter code that
 * actually reads request state.
 *
 * **What this costs:** `Astro.props` is the generic record rather than the
 * page's own `Props` interface, because an extracted file cannot tell `tsc`
 * which interface belongs to the component. Destructuring a field `Props` does
 * not declare still compiles.
 */
declare const Astro: import("astro").AstroGlobal;
