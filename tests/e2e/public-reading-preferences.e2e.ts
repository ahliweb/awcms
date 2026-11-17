/**
 * The public reading-preferences panel in a real browser (Issue #1369, ADR-0166).
 *
 * `tests/reading-preferences.test.ts` runs the storage contract and checks the
 * markup. What only a browser can say is covered here: focus (Esc and the close
 * button return it to the floating button), that a stored choice is applied
 * before the page is used, that the CSS really changes what it claims to, that
 * the panel is itself accessible with its own preferences switched on, and that
 * the largest text size does not push a 360 px page sideways.
 *
 * Needs no content fixture. The blog index of a tenant with no posts renders
 * `200` with a heading and "No posts yet." — the same property
 * `public-blog-locale-prefix.e2e.ts` relies on — and the panel does not depend on
 * what the page holds. The tenant is the one `ci.yml` bootstraps
 * (`tenantCode: "e2e"`). Everything the panel stores lives in the browser, so the
 * spec sends no request that changes tenant state, which is what its READ_WAVE
 * classification requires.
 */
import AxeBuilder from "@axe-core/playwright";

import { test, expect } from "./support/e2e-read-wave";
import type { Page } from "./support/e2e-read-wave";

const URL = "/en/blog/e2e";
const KEY = "awcms-a11y";

const SWITCHES = [
  { name: "contrast", attribute: "data-a11y-contrast", label: "High contrast" },
  { name: "mono", attribute: "data-a11y-mono", label: "Monochrome" },
  {
    name: "dyslexia",
    attribute: "data-a11y-dyslexia",
    label: "Dyslexia-friendly text"
  },
  {
    name: "underline",
    attribute: "data-a11y-underline",
    label: "Underline all links"
  },
  {
    name: "highlight",
    attribute: "data-a11y-highlight",
    label: "Highlight links"
  },
  { name: "motion", attribute: "data-a11y-motion", label: "Reduce motion" }
] as const;

async function openPanel(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Accessibility settings" }).click();
  await expect(
    page.getByRole("dialog", { name: "Accessibility settings" })
  ).toBeVisible();
}

function stored(page: Page): Promise<unknown> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  }, KEY);
}

async function preferenceAttributes(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.documentElement.attributes)
      .map((a) => a.name)
      .filter((n) => n.startsWith("data-a11y-") && n !== "data-a11y-ready")
      .sort()
  );
}

async function serious(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  return results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical"
  );
}

test.describe("reading preferences — without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the button stays hidden: no control that does nothing", async ({
    page
  }) => {
    await page.goto(URL);

    await expect(page.locator("#a11y-fab")).toHaveCount(1);
    await expect(page.locator("#a11y-fab")).toBeHidden();
    await expect(page.locator("#a11y-panel")).toBeHidden();
    await expect(page.locator("h1")).toContainText("Blog");
  });
});

test.describe("reading preferences — the panel", () => {
  test("opens with focus on its heading, as a NON-modal dialog", async ({
    page
  }) => {
    await page.goto(URL);
    const fab = page.getByRole("button", { name: "Accessibility settings" });

    await expect(fab).toHaveAttribute("aria-expanded", "false");
    await fab.click();

    const dialog = page.getByRole("dialog", { name: "Accessibility settings" });

    await expect(dialog).toBeVisible();
    await expect(fab).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#a11y-title")).toBeFocused();
    await expect(dialog).not.toHaveAttribute("aria-modal", /.*/);
    // Non-modal: the page behind it is still reachable.
    await expect(page.locator("h1")).toBeVisible();
  });

  test("Esc closes it and returns focus to the floating button", async ({
    page
  }) => {
    await page.goto(URL);
    await openPanel(page);
    await page.keyboard.press("Escape");

    await expect(page.locator("#a11y-panel")).toBeHidden();
    await expect(page.locator("#a11y-fab")).toBeFocused();
    await expect(page.locator("#a11y-fab")).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  test("the close button closes it and returns focus to the floating button", async ({
    page
  }) => {
    await page.goto(URL);
    await openPanel(page);
    await page.getByRole("button", { name: "Close settings" }).click();

    await expect(page.locator("#a11y-panel")).toBeHidden();
    await expect(page.locator("#a11y-fab")).toBeFocused();
  });

  test("a click outside closes it", async ({ page }) => {
    await page.goto(URL);
    await openPanel(page);
    // Empty page area to the right of the panel, which is anchored bottom-left.
    await page.mouse.click(1100, 300);

    await expect(page.locator("#a11y-panel")).toBeHidden();
  });

  test("the whole panel is reachable and operable by keyboard alone", async ({
    page
  }) => {
    await page.goto(URL);
    await page.locator("#a11y-fab").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#a11y-title")).toBeFocused();

    // Tab: close button, three text sizes (one stop for the radio group), six
    // switches, reset. Then a switch is flipped with Space.
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Close settings" })
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("radio", { name: "Normal" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("radio", { name: "Large", exact: true })
    ).toBeChecked();
    await expect(page.locator("html")).toHaveAttribute(
      "data-a11y-text",
      "large"
    );

    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("switch", { name: "High contrast" })
    ).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.locator("html")).toHaveAttribute(
      "data-a11y-contrast",
      ""
    );
  });
});

test.describe("reading preferences — each preference", () => {
  for (const { name, attribute, label } of SWITCHES) {
    test(`${name}: sets ${attribute}, persists across reload, and switches back off`, async ({
      page
    }) => {
      await page.goto(URL);
      await openPanel(page);

      const control = page.getByRole("switch", { name: label });

      await expect(control).not.toBeChecked();
      await control.click();

      await expect(control).toBeChecked();
      await expect(page.locator("html")).toHaveAttribute(
        attribute,
        name === "motion" ? "reduce" : ""
      );
      expect(await stored(page)).toMatchObject({ v: 1, [name]: true });

      await page.reload();
      // Applied by the early script, before anything is opened.
      await expect(page.locator("html")).toHaveAttribute(
        attribute,
        name === "motion" ? "reduce" : ""
      );
      await openPanel(page);
      await expect(page.getByRole("switch", { name: label })).toBeChecked();

      await page.getByRole("switch", { name: label }).click();
      await expect(page.locator("html")).not.toHaveAttribute(attribute, /.*/);
      expect(await stored(page)).toMatchObject({ v: 1, [name]: false });
    });
  }

  for (const [option, value] of [
    ["Large", "large"],
    ["Extra large", "x-large"]
  ] as const) {
    test(`text size ${value}: scales the root and persists`, async ({
      page
    }) => {
      await page.goto(URL);
      const before = await page.evaluate(() =>
        parseFloat(getComputedStyle(document.documentElement).fontSize)
      );

      await openPanel(page);
      await page
        .getByRole("radio", { name: option, exact: true })
        .check({ force: true });

      await expect(page.locator("html")).toHaveAttribute(
        "data-a11y-text",
        value
      );
      expect(await stored(page)).toMatchObject({ v: 1, text: value });
      const after = await page.evaluate(() =>
        parseFloat(getComputedStyle(document.documentElement).fontSize)
      );

      expect(after).toBeCloseTo(before * (value === "large" ? 1.2 : 1.4), 1);
      // The page text really follows: the heading is rem-based, not px.
      const h1 = await page
        .locator("h1")
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

      await page.reload();
      await expect(page.locator("html")).toHaveAttribute(
        "data-a11y-text",
        value
      );
      expect(
        await page
          .locator("h1")
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      ).toBeCloseTo(h1, 1);
    });
  }

  test("reset removes the key and every attribute", async ({ page }) => {
    await page.goto(URL);
    await openPanel(page);

    for (const { label } of SWITCHES) {
      await page.getByRole("switch", { name: label }).click();
    }
    await page
      .getByRole("radio", { name: "Large", exact: true })
      .check({ force: true });
    expect((await preferenceAttributes(page)).length).toBe(7);

    await page.getByRole("button", { name: "Reset to defaults" }).click();

    expect(await stored(page)).toBeNull();
    expect(await preferenceAttributes(page)).toEqual([]);
    await expect(page.getByRole("radio", { name: "Normal" })).toBeChecked();
    for (const { label } of SWITCHES) {
      await expect(page.getByRole("switch", { name: label })).not.toBeChecked();
    }
  });

  test("a change is announced to the page as awcms-a11y-change", async ({
    page
  }) => {
    await page.goto(URL);
    await page.evaluate(() => {
      (window as unknown as { __seen: unknown[] }).__seen = [];
      document.addEventListener("awcms-a11y-change", (e) =>
        (window as unknown as { __seen: unknown[] }).__seen.push(
          (e as CustomEvent).detail
        )
      );
    });
    await openPanel(page);
    await page.getByRole("switch", { name: "Reduce motion" }).click();

    const seen = await page.evaluate(
      () => (window as unknown as { __seen: unknown[] }).__seen
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ v: 1, motion: true });
  });

  test("invalid stored data is ignored: the page loads with defaults", async ({
    page
  }) => {
    await page.addInitScript(
      (key) => window.localStorage.setItem(key, "{broken"),
      KEY
    );
    await page.goto(URL);

    expect(await preferenceAttributes(page)).toEqual([]);
    await openPanel(page);
    await expect(page.getByRole("radio", { name: "Normal" })).toBeChecked();
  });
});

test.describe("reading preferences — what the CSS really does", () => {
  test("the OS preferences are the default when nothing is stored", async ({
    page
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce", contrast: "more" });
    await page.goto(URL);

    await expect(page.locator("html")).toHaveAttribute(
      "data-a11y-motion",
      "reduce"
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-a11y-contrast",
      ""
    );
    expect(await stored(page)).toBeNull();
    await openPanel(page);
    await expect(
      page.getByRole("switch", { name: "Reduce motion" })
    ).toBeChecked();
    await expect(
      page.getByRole("switch", { name: "High contrast" })
    ).toBeChecked();
  });

  test("high contrast reaches 7:1 for body text, light and dark", async ({
    page
  }) => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(URL);
      await openPanel(page);
      await page.getByRole("switch", { name: "High contrast" }).click();

      const [text, bg] = await page.evaluate(() => {
        const cs = getComputedStyle(document.body);
        return [cs.color, cs.backgroundColor];
      });
      const ratio = contrast(text!, bg!);

      expect(ratio, `${scheme}: ${text} on ${bg}`).toBeGreaterThanOrEqual(7);
      await page.evaluate((key) => window.localStorage.removeItem(key), KEY);
    }
  });

  test("high contrast sets no palette under forced colours", async ({
    page
  }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto(URL);
    await openPanel(page);
    await page.getByRole("switch", { name: "High contrast" }).click();

    await expect(page.locator("html")).toHaveAttribute(
      "data-a11y-contrast",
      ""
    );
    const hc = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--hc-bg")
        .trim()
    );

    expect(hc).toBe("");
  });

  test("monochrome greys the page and the floating button stays fixed", async ({
    page
  }) => {
    await page.setViewportSize({ width: 360, height: 400 });
    await page.goto(URL);
    await openPanel(page);
    await page.getByRole("switch", { name: "Monochrome" }).click();
    await page.keyboard.press("Escape");

    expect(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).filter
      )
    ).toBe("grayscale(1)");
    expect(
      await page.evaluate(() => getComputedStyle(document.body).filter)
    ).toBe("none");

    const fab = page.locator("#a11y-fab");

    expect(await fab.evaluate((el) => getComputedStyle(el).position)).toBe(
      "fixed"
    );
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const box = (await fab.boundingBox())!;

    expect(box.y + box.height).toBeLessThanOrEqual(400);
    expect(box.y).toBeGreaterThanOrEqual(0);
  });

  test("dyslexia-friendly text applies the WCAG 1.4.12 spacing", async ({
    page
  }) => {
    await page.goto(URL);
    await openPanel(page);
    await page.getByRole("switch", { name: "Dyslexia-friendly text" }).click();

    const metrics = await page.locator("h1").evaluate((el) => {
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);

      return {
        letter: parseFloat(cs.letterSpacing) / size,
        word: parseFloat(cs.wordSpacing) / size,
        line: parseFloat(cs.lineHeight) / size
      };
    });

    expect(metrics.letter).toBeCloseTo(0.12, 2);
    expect(metrics.word).toBeCloseTo(0.16, 2);
    expect(metrics.line).toBeGreaterThanOrEqual(1.5);
  });

  test("underline and highlight apply to links", async ({ page }) => {
    await page.goto(URL);
    // A blog index with no posts has no card link, so one is added in the page
    // with the same markup a listing renders. `.posts article h2 a` is styled
    // `text-decoration: none`, which is what the preference has to beat.
    await page.evaluate(() => {
      document
        .querySelector("main")!
        .insertAdjacentHTML(
          "beforeend",
          '<section class="posts"><article><h2><a id="probe" href="/probe">Probe</a></h2></article></section>'
        );
    });
    const probe = page.locator("#probe");

    expect(
      await probe.evaluate((el) => getComputedStyle(el).textDecorationLine)
    ).toBe("none");

    await openPanel(page);
    await page.getByRole("switch", { name: "Underline all links" }).click();
    expect(
      await probe.evaluate((el) => getComputedStyle(el).textDecorationLine)
    ).toContain("underline");

    await page.getByRole("switch", { name: "Highlight links" }).click();
    expect(
      await probe.evaluate((el) => getComputedStyle(el).backgroundColor)
    ).toBe("rgb(255, 235, 59)");
    // `a` carries a short colour transition, so the value is awaited, not sampled.
    await expect(probe).toHaveCSS("color", "rgb(17, 17, 17)");
  });

  test("reduce motion removes animation and transition from every element", async ({
    page
  }) => {
    await page.goto(URL);
    await openPanel(page);
    await page.getByRole("switch", { name: "Reduce motion" }).click();

    const offenders = await page.evaluate(() =>
      Array.from(document.querySelectorAll("*"))
        .filter((el) => {
          const cs = getComputedStyle(el);

          return (
            cs.animationName !== "none" || parseFloat(cs.transitionDuration) > 0
          );
        })
        .map(
          (el) =>
            el.tagName.toLowerCase() + (el.className ? `.${el.className}` : "")
        )
    );

    expect(offenders).toEqual([]);
  });
});

test.describe("reading preferences — the panel is itself accessible", () => {
  test("axe: no serious or critical violation with the panel open", async ({
    page
  }) => {
    await page.goto(URL);
    await openPanel(page);

    expect(await serious(page)).toEqual([]);
  });

  test("axe: ... with every preference on, light and dark", async ({
    page
  }) => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(URL);
      await openPanel(page);
      for (const { label } of SWITCHES) {
        const control = page.getByRole("switch", { name: label });

        if (!(await control.isChecked())) await control.click();
      }
      await page
        .getByRole("radio", { name: "Extra large" })
        .check({ force: true });

      expect(await serious(page), scheme).toEqual([]);
      await page.evaluate((key) => window.localStorage.removeItem(key), KEY);
    }
  });

  test("axe: ... with high contrast on and the panel closed", async ({
    page
  }) => {
    await page.goto(URL);
    await openPanel(page);
    await page.getByRole("switch", { name: "High contrast" }).click();
    await page.keyboard.press("Escape");

    expect(await serious(page)).toEqual([]);
  });

  test("targets are at least 24 px (the button 44 px)", async ({ page }) => {
    await page.goto(URL);
    const fab = (await page.locator("#a11y-fab").boundingBox())!;

    expect(Math.min(fab.width, fab.height)).toBeGreaterThanOrEqual(44);
    await openPanel(page);
    for (const locator of [
      page.getByRole("button", { name: "Close settings" }),
      page.getByRole("button", { name: "Reset to defaults" }),
      ...SWITCHES.map((s) => page.getByRole("switch", { name: s.label }))
    ]) {
      const box = (await locator.boundingBox())!;

      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(box.height).toBeGreaterThanOrEqual(24);
    }
  });
});

test.describe("reading preferences — reflow (WCAG 1.4.10)", () => {
  for (const [width, height] of [
    [360, 740],
    [320, 568]
  ] as const) {
    test(`no horizontal overflow at ${width}px with extra-large text and the panel open`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto(URL);
      await openPanel(page);
      await page
        .getByRole("radio", { name: "Extra large" })
        .check({ force: true });
      await page
        .getByRole("switch", { name: "Dyslexia-friendly text" })
        .click();

      const overflow = await page.evaluate(() => ({
        page:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        panelRight: document
          .getElementById("a11y-panel")!
          .getBoundingClientRect().right,
        panelLeft: document
          .getElementById("a11y-panel")!
          .getBoundingClientRect().left
      }));

      expect(overflow.page).toBeLessThanOrEqual(0);
      expect(overflow.panelLeft).toBeGreaterThanOrEqual(0);
      expect(overflow.panelRight).toBeLessThanOrEqual(width);

      // Closed, the page itself must still fit.
      await page.keyboard.press("Escape");
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth
        )
      ).toBeLessThanOrEqual(0);
    });
  }

  test("the panel scrolls inside itself when the viewport is short", async ({
    page
  }) => {
    await page.setViewportSize({ width: 360, height: 360 });
    await page.goto(URL);
    await openPanel(page);

    const m = await page.locator("#a11y-panel").evaluate((el) => {
      const r = el.getBoundingClientRect();

      return {
        top: r.top,
        bottom: r.bottom,
        scrolls: el.scrollHeight > el.clientHeight
      };
    });

    expect(m.top).toBeGreaterThanOrEqual(0);
    expect(m.bottom).toBeLessThanOrEqual(360);
    expect(m.scrolls).toBe(true);
  });
});

/** WCAG relative-luminance contrast of two `rgb()/rgba()` strings. */
function contrast(a: string, b: string): number {
  const lum = (css: string): number => {
    const [r, g, bl] = (css.match(/[\d.]+/g) ?? ["0", "0", "0"])
      .slice(0, 3)
      .map((n) => {
        const v = Number(n) / 255;

        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });

    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);

  return (hi! + 0.05) / (lo! + 0.05);
}
