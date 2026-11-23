import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BrandOverrideError,
  applyBrandOverrideToTokensCss,
  parseBrandOverride,
  renderBrandOverrideCss,
  resolveEffectiveThemes
} from "../src/lib/ui/brand-token-override";

const TOKENS = await Bun.file("src/styles/tokens.css").text();

describe("brand token override (#1355)", () => {
  test("no override: tokens.css passes through byte-for-byte", () => {
    expect(applyBrandOverrideToTokensCss(TOKENS, null)).toBe(TOKENS);
    const empty = parseBrandOverride({}, TOKENS);

    expect(renderBrandOverrideCss(empty)).toBe("");
    expect(applyBrandOverrideToTokensCss(TOKENS, empty)).toBe(TOKENS);
  });

  test("override changes the effective value in the schemes given", () => {
    const override = parseBrandOverride(
      {
        light: { "color-primary-strong": "#7c2d12" },
        dark: { "--color-primary": "#FDBA74" }
      },
      TOKENS
    );
    const css = renderBrandOverrideCss(override);

    expect(css).toContain(":root {\n  --color-primary-strong: #7c2d12;");
    expect(css).toContain(
      ':root[data-theme="dark"] {\n  --color-primary: #fdba74;'
    );

    const { light, dark } = resolveEffectiveThemes(TOKENS, override);
    const shipped = resolveEffectiveThemes(TOKENS, null);

    expect(light.get("color-primary-strong")).toBe("#7c2d12");
    expect(light.get("color-primary")).toBe(shipped.light.get("color-primary"));
    expect(dark.get("color-primary")).toBe("#fdba74");
    expect(
      applyBrandOverrideToTokensCss(TOKENS, override).startsWith(TOKENS)
    ).toBe(true);
  });

  test("unknown or non-allow-listed tokens, bad values and bad shapes are rejected together", () => {
    expect(() =>
      parseBrandOverride({ light: { "color-primary-nope": "#000000" } }, TOKENS)
    ).toThrow(/unknown token/);
    expect(() =>
      parseBrandOverride({ light: { "color-danger": "#000000" } }, TOKENS)
    ).toThrow(/not overridable/);
    expect(() =>
      parseBrandOverride({ light: { "color-primary": "red" } }, TOKENS)
    ).toThrow(/6-digit hex/);
    expect(() => parseBrandOverride({ sepia: {} }, TOKENS)).toThrow(
      /unknown top-level key/
    );
    expect(() => parseBrandOverride([], TOKENS)).toThrow(BrandOverrideError);

    try {
      parseBrandOverride(
        { light: { "color-danger": "#000000", "color-primary": "red" } },
        TOKENS
      );
    } catch (error) {
      expect((error as BrandOverrideError).problems).toHaveLength(2);
    }
  });

  test("the contrast gate measures EFFECTIVE values", () => {
    const dir = mkdtempSync(join(tmpdir(), "brand-"));

    try {
      mkdirSync(dir, { recursive: true });
      const run = (override: unknown) => {
        const file = join(dir, "o.json");

        writeFileSync(file, JSON.stringify(override));

        return Bun.spawnSync(
          ["bun", "scripts/design-token-contrast-check.ts", `--brand=${file}`],
          { stdout: "pipe", stderr: "pipe" }
        );
      };

      // pale solid fill under white text: fails AA
      const bad = run({ light: { "color-primary-strong": "#a5b4fc" } });

      expect(bad.exitCode).toBe(1);
      expect(bad.stderr.toString()).toContain("color-primary-strong");

      const invalid = run({ light: { "color-nope": "#000000" } });

      expect(invalid.exitCode).toBe(1);
      expect(invalid.stderr.toString()).toContain("not overridable");

      const good = run({ light: { "color-primary-strong": "#1e3a8a" } });

      expect(good.exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
