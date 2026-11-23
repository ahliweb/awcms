/**
 * Deployment-level product identity (Issue #1352): the ONE place that decides
 * what this deployment calls itself in the admin shell, the auth pages, the
 * installable-app manifest and the front door.
 *
 * ## Why it exists
 *
 * A product derived from this template ships under its own name. Before this,
 * changing the name meant patching `AdminLayout.astro`, `AuthBrandPanel.astro`,
 * five auth pages, the manifest and `index.astro` -- one merge conflict per file
 * at every upstream sync. Now each of those reads this resolver.
 *
 * ## Contract
 *
 * - **Opt-in, default unchanged.** With no `PRODUCT_*` variable set every field
 *   equals the string those files hard-coded before (`tests/product-identity.test.ts`
 *   pins this).
 * - **Deployment config, never request data.** Read from the environment, never
 *   from `Host` or a tenant row. Per-tenant branding is out of scope.
 * - **Plain text only.** Names are stripped of control/format characters and
 *   REJECTED (default used) if they contain `<`, `>`, `&`, quotes or backticks,
 *   so a value can never become markup even where a template forgets to escape.
 * - **Asset and redirect paths are same-origin absolute paths** (`/x/y.png`):
 *   no scheme, no `//`, no backslash, no `..`, no query/fragment, so
 *   a bad value can neither load a foreign asset (CSP is not loosened) nor
 *   make the front door an open redirect.
 * - **An invalid value falls back to the default** instead of throwing: a typo
 *   must not take the login page down.
 * - **The compatibility version is a different fact.** `version` here is
 *   display only (the shell footer). Module compatibility keeps reading
 *   `package.json` through `src/lib/semver` and the module registry.
 * - **Translations are untouched.** The identity supplies brand tokens; the
 *   sentences around them stay in the gettext catalogue.
 */
import packageJson from "../../package.json";

export const DEFAULT_PRODUCT_NAME = "AWCMS";

export interface ProductIdentity {
  /** Shell title suffix, auth page titles, wordmark default. */
  productName: string;
  /** Text mark shown beside the tile in the shell and auth pages. */
  wordmark: string;
  /** One letter shown inside the brand tile. */
  mark: string;
  /** Shown in the shell footer. NOT the module-compatibility version. */
  version: string;
  /** Same-origin path `/` redirects to (302), or null when `/` renders. */
  frontDoorPath: string | null;
  /** Same-origin paths for the installable-app icons; null = built-in. */
  icons: {
    icon192: string | null;
    icon512: string | null;
    iconMaskable512: string | null;
    appleTouch: string | null;
  };
}

type Env = Readonly<Record<string, string | undefined>>;

const FORBIDDEN_TEXT = /[<>&"'`]/;
const VERSION_TEXT = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$/;
const SAFE_PATH = /^\/[A-Za-z0-9._~\-/]*$/;

function cleanText(
  value: string | undefined,
  fallback: string,
  max: number
): string {
  // Cc (control) and Cf (format: bidi overrides, zero-width) out first.
  const trimmed = (value ?? "").replace(/[\p{Cc}\p{Cf}]/gu, "").trim();

  if (trimmed === "" || FORBIDDEN_TEXT.test(trimmed)) {
    return fallback;
  }

  // By code point so a surrogate pair is never split.
  return Array.from(trimmed).slice(0, max).join("");
}

/** A same-origin absolute path with no traversal, or null. */
export function cleanSameOriginPath(
  value: string | undefined,
  max = 200
): string | null {
  const trimmed = (value ?? "").trim();

  if (
    trimmed === "" ||
    trimmed.length > max ||
    !SAFE_PATH.test(trimmed) ||
    trimmed.startsWith("//") ||
    trimmed.split("/").some((segment) => segment === "..")
  ) {
    return null;
  }

  return trimmed;
}

export function resolveProductIdentity(env: Env): ProductIdentity {
  const productName = cleanText(env.PRODUCT_NAME, DEFAULT_PRODUCT_NAME, 60);
  // The wordmark follows the name unless set explicitly, so renaming the
  // product is one variable.
  const wordmark = cleanText(env.PRODUCT_WORDMARK, productName, 30);
  const version = (env.PRODUCT_VERSION ?? "").trim();
  const frontDoor = cleanSameOriginPath(env.PRODUCT_FRONT_DOOR_PATH);

  return {
    productName,
    wordmark,
    mark: Array.from(wordmark)[0]!.toUpperCase(),
    version: VERSION_TEXT.test(version) ? version : packageJson.version,
    // `/` pointing at `/` would loop.
    frontDoorPath: frontDoor === "/" ? null : frontDoor,
    icons: {
      icon192: cleanSameOriginPath(env.PWA_ICON_192_PATH),
      icon512: cleanSameOriginPath(env.PWA_ICON_512_PATH),
      iconMaskable512: cleanSameOriginPath(env.PWA_ICON_MASKABLE_512_PATH),
      appleTouch: cleanSameOriginPath(env.PWA_APPLE_TOUCH_ICON_PATH)
    }
  };
}
