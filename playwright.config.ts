import { defineConfig, devices } from "@playwright/test";

/**
 * E2E browser test config (Playwright + Bun). See skill
 * `.claude/skills/awcms-browser-test/SKILL.md` for the full setup rationale,
 * conventions, and known Bun/Playwright gotchas. Ported from awcms-mini's
 * harness (mini-first flow, `docs/awcms/alur-pengembangan-mini-first.md`) and
 * adapted to this repo.
 *
 * Naming: specs use `*.e2e.ts` (not `.spec.ts`/`.test.ts`) so `bun test`'s own
 * recursive discovery — which matches `*.test.*`/`*_test.*`/`*.spec.*`/
 * `*_spec.*` by default — never picks these files up and tries to run them as
 * `bun:test` files (they use `@playwright/test`'s own `test`/`expect`, a
 * different runtime context entirely). Verify: `bun test tests/e2e` reports
 * "did not match any test files".
 *
 * This suite assumes an already-running app (`bun run dev` or `bun run
 * build && bun run start`, with `DATABASE_URL` set) at `E2E_BASE_URL` — the
 * same "you provide the environment" convention `tests/integration/*` uses for
 * `DATABASE_URL`. Playwright's own `webServer` auto-start is intentionally NOT
 * used: this app's server needs a live Postgres connection to boot at all,
 * which `webServer` has no way to provision.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4321",
    headless: true,
    trace: "retain-on-failure",
    // Root-less sandboxes (no `apt-get`, so `playwright install --with-deps`
    // can't run) can point this at a pre-installed system browser instead of
    // Playwright's own bundled Chromium — e.g.
    // `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome`. Leave unset
    // wherever `bun run test:e2e:install` succeeds normally (dev machines, CI
    // with `--with-deps`).
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}
  },
  projects: [
    // Logs the owner in ONCE and saves the session; see `tests/e2e/auth.setup.ts`
    // for why (eleven parallel argon2id verifications is what made this suite
    // intermittently take four minutes and fail at the login step).
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        // Specs that authenticate as somebody else — or as nobody, which is
        // `login.e2e.ts`'s whole subject — override this per file with
        // `test.use({ storageState: ... })`.
        storageState: "playwright/.auth/owner.json"
      }
    }
  ]
});
