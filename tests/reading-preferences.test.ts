/**
 * The public reading-preferences panel (Issue #1369, ADR-0166).
 *
 * Three things are guarded here, none of which needs a browser:
 *
 * 1. **The storage contract**, executed. `public/js/a11y-early.js` is a classic
 *    script, so it is loaded the way a browser loads it — as source, run against
 *    a stand-in `window`/`document` — rather than imported. That keeps what is
 *    tested identical to what is shipped, and lets every failure mode a real
 *    browser has (storage blocked, storage throwing, invalid JSON, a stale
 *    version) be produced on demand.
 * 2. **The rendered markup**: language, labelling, no inline script or style,
 *    and that the surfaces that must carry the panel carry it.
 * 3. **That the CSS and the script cannot drift apart**: the attributes one sets
 *    are the attributes the other styles, in both directions.
 *
 * The behaviour that needs real focus, layout and pixels (Esc returning focus,
 * axe with the panel open, no horizontal overflow at 360 px) is
 * `tests/e2e/public-reading-preferences.e2e.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { renderPublicPageShell } from "../src/modules/blog-content/domain/public-page-rendering";
import { renderSearchPageDocument } from "../src/modules/site-search/domain/search-page-rendering";
import { DEFAULT_SEARCH_PAGE_LABELS } from "../src/modules/site-search/domain/search-page-rendering";
import {
  READING_PREFERENCES_EARLY_SCRIPT_SRC,
  READING_PREFERENCES_PANEL_SCRIPT_SRC,
  READING_PREFERENCES_STYLESHEET_HREF,
  renderReadingPreferencesHead,
  renderReadingPreferencesPanel,
  resolveReadingPreferencesLanguage
} from "../src/lib/ui/reading-preferences-panel";
import { PUBLIC_ASSET_AUDIENCE } from "../scripts/client-asset-budget";

const ROOT = path.resolve(import.meta.dir, "..");
const read = (relative: string): string =>
  readFileSync(path.join(ROOT, relative), "utf8");

const EARLY_SOURCE = read("public/js/a11y-early.js");
const PANEL_SOURCE = read("public/js/a11y-panel.js");
const CSS = read("public/css/public-a11y.css");

type Prefs = {
  v: number;
  text: string;
  contrast: boolean;
  mono: boolean;
  dyslexia: boolean;
  underline: boolean;
  highlight: boolean;
  motion: boolean;
};

type Api = {
  key: string;
  parse(raw: unknown): Prefs | null;
  defaults(): Prefs;
  read(): Prefs;
  apply(p: Prefs): void;
  set(p: unknown): Prefs;
  reset(): Prefs;
};

type Env = {
  api: Api;
  attrs: Map<string, string>;
  store: Map<string, string>;
  events: Array<{ type: string; detail: Prefs }>;
};

type EnvOptions = {
  /** The raw value already in storage under the key. */
  stored?: string;
  /** `window.localStorage` itself throws on access (blocked site data). */
  storageBlocked?: boolean;
  /** `getItem`/`setItem`/`removeItem` throw (quota, private mode). */
  storageThrows?: boolean;
  /** Media queries that match. */
  media?: Record<string, boolean>;
  /** `matchMedia` is missing or throws. */
  noMatchMedia?: boolean;
};

const KEY = "awcms-a11y";

/**
 * Every opening tag named `name`, found by scanning rather than by a tag-shaped
 * regular expression (CodeQL's js/bad-tag-filter flags those, rightly: they are
 * the wrong tool for HTML). Good enough here because the input is our own
 * server-rendered output, not arbitrary markup.
 */
function openingTags(html: string, name: string): string[] {
  const lower = html.toLowerCase();
  const needle = `<${name}`;
  const found: string[] = [];
  let at = lower.indexOf(needle);

  while (at !== -1) {
    const end = html.indexOf(">", at);

    found.push(html.slice(at, end + 1));
    at = lower.indexOf(needle, end);
  }

  return found;
}

/** Runs the shipped early-apply script against a stand-in browser. */
function load(options: EnvOptions = {}): Env {
  const attrs = new Map<string, string>();
  const store = new Map<string, string>();
  const events: Env["events"] = [];

  if (options.stored !== undefined) store.set(KEY, options.stored);

  const root = {
    setAttribute: (name: string, value: string) => attrs.set(name, value),
    removeAttribute: (name: string) => attrs.delete(name)
  };

  const storage = {
    getItem: (key: string) => {
      if (options.storageThrows) throw new Error("storage unavailable");
      return store.has(key) ? store.get(key)! : null;
    },
    setItem: (key: string, value: string) => {
      if (options.storageThrows) throw new Error("quota exceeded");
      store.set(key, value);
    },
    removeItem: (key: string) => {
      if (options.storageThrows) throw new Error("storage unavailable");
      store.delete(key);
    }
  };

  class FakeCustomEvent {
    type: string;
    detail: Prefs;
    constructor(type: string, init: { detail: Prefs }) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  const win: Record<string, unknown> = {
    CustomEvent: FakeCustomEvent,
    matchMedia: options.noMatchMedia
      ? () => {
          throw new Error("no matchMedia");
        }
      : (query: string) => ({ matches: options.media?.[query] === true })
  };

  if (options.storageBlocked) {
    Object.defineProperty(win, "localStorage", {
      get() {
        throw new Error("SecurityError");
      }
    });
  } else {
    win.localStorage = storage;
  }

  const doc = {
    documentElement: root,
    dispatchEvent: (event: Env["events"][number]) => {
      events.push(event);
      return true;
    }
  };

  new Function("window", "document", EARLY_SOURCE)(win, doc);

  return { api: win.awcmsA11y as Api, attrs, store, events };
}

const OFF: Prefs = {
  v: 1,
  text: "normal",
  contrast: false,
  mono: false,
  dyslexia: false,
  underline: false,
  highlight: false,
  motion: false
};

describe("storage contract (js/a11y-early.js)", () => {
  test("the key is the documented one", () => {
    expect(load().api.key).toBe("awcms-a11y");
  });

  test("with nothing stored, attributes are the defaults and none is a preference", () => {
    const { attrs } = load();

    // `data-a11y-ready` is the only attribute: nothing is on.
    expect([...attrs.keys()]).toEqual(["data-a11y-ready"]);
  });

  test("a valid stored object is applied as attributes", () => {
    const { attrs } = load({
      stored: JSON.stringify({
        ...OFF,
        text: "x-large",
        contrast: true,
        mono: true,
        dyslexia: true,
        underline: true,
        highlight: true,
        motion: true
      })
    });

    expect(Object.fromEntries(attrs)).toEqual({
      "data-a11y-text": "x-large",
      "data-a11y-contrast": "",
      "data-a11y-mono": "",
      "data-a11y-dyslexia": "",
      "data-a11y-underline": "",
      "data-a11y-highlight": "",
      "data-a11y-motion": "reduce",
      "data-a11y-ready": ""
    });
  });

  test('text "large" and "normal" map to their attribute (normal = absent)', () => {
    expect(
      load({ stored: JSON.stringify({ ...OFF, text: "large" }) }).attrs.get(
        "data-a11y-text"
      )
    ).toBe("large");
    expect(
      load({ stored: JSON.stringify(OFF) }).attrs.has("data-a11y-text")
    ).toBe(false);
  });

  describe("anything unreadable is 'no stored preference'", () => {
    const cases: Array<[string, string]> = [
      ["invalid JSON", "{not json"],
      ["empty string", ""],
      ["JSON null", "null"],
      ["a JSON array", "[]"],
      ["a JSON string", '"large"'],
      ["a wrong version", JSON.stringify({ ...OFF, v: 2 })],
      ["a missing version", JSON.stringify({ ...OFF, v: undefined })],
      ["an unknown text size", JSON.stringify({ ...OFF, text: "huge" })],
      ["a non-boolean switch", JSON.stringify({ ...OFF, mono: "yes" })],
      ["a missing switch", JSON.stringify({ ...OFF, motion: undefined })]
    ];

    for (const [name, stored] of cases) {
      test(name, () => {
        const { api, attrs } = load({ stored });

        expect(api.read()).toEqual(api.defaults());
        expect([...attrs.keys()]).toEqual(["data-a11y-ready"]);
      });
    }

    test("parse() agrees and never throws", () => {
      const { api } = load();

      for (const [, stored] of cases) {
        expect(api.parse(stored)).toBeNull();
      }
      expect(api.parse(undefined)).toBeNull();
      expect(api.parse(null)).toBeNull();
    });

    test("extra unknown keys are ignored, not fatal", () => {
      const { api } = load();

      expect(
        api.parse(JSON.stringify({ ...OFF, text: "large", surprise: 1 }))
      ).toEqual({ ...OFF, text: "large" });
    });
  });

  describe("storage that is blocked or throws", () => {
    test("a blocked localStorage does not throw and falls back to defaults", () => {
      const { api, attrs } = load({ storageBlocked: true });

      expect(api.read()).toEqual(api.defaults());
      expect(attrs.has("data-a11y-ready")).toBe(true);
    });

    test("set() on blocked storage still applies to this page", () => {
      const { api, attrs, events } = load({ storageBlocked: true });

      const applied = api.set({ ...OFF, mono: true });

      expect(applied.mono).toBe(true);
      expect(attrs.has("data-a11y-mono")).toBe(true);
      expect(events).toHaveLength(1);
    });

    test("throwing getItem/setItem/removeItem never escape", () => {
      const { api, attrs } = load({ storageThrows: true });

      expect(() => api.set({ ...OFF, underline: true })).not.toThrow();
      expect(attrs.has("data-a11y-underline")).toBe(true);
      expect(() => api.reset()).not.toThrow();
      expect(attrs.has("data-a11y-underline")).toBe(false);
    });
  });

  describe("OS defaults when nothing is stored", () => {
    test("prefers-contrast: more turns high contrast on", () => {
      const { api, attrs } = load({
        media: { "(prefers-contrast: more)": true }
      });

      expect(api.read().contrast).toBe(true);
      expect(attrs.has("data-a11y-contrast")).toBe(true);
      expect(attrs.has("data-a11y-motion")).toBe(false);
    });

    test("prefers-reduced-motion: reduce turns reduced motion on", () => {
      const { api, attrs } = load({
        media: { "(prefers-reduced-motion: reduce)": true }
      });

      expect(api.read().motion).toBe(true);
      expect(attrs.get("data-a11y-motion")).toBe("reduce");
      expect(attrs.has("data-a11y-contrast")).toBe(false);
    });

    test("a stored choice beats the OS, including an explicit 'off'", () => {
      const { api, attrs } = load({
        stored: JSON.stringify(OFF),
        media: {
          "(prefers-contrast: more)": true,
          "(prefers-reduced-motion: reduce)": true
        }
      });

      expect(api.read()).toEqual(OFF);
      expect(attrs.has("data-a11y-contrast")).toBe(false);
      expect(attrs.has("data-a11y-motion")).toBe(false);
    });

    test("a missing or throwing matchMedia means 'no OS preference'", () => {
      const { api, attrs } = load({ noMatchMedia: true });

      expect(api.read()).toEqual(OFF);
      expect([...attrs.keys()]).toEqual(["data-a11y-ready"]);
    });
  });

  describe("set() and reset()", () => {
    test("set() stores the FULL object, applies it, and announces it once", () => {
      const { api, attrs, store, events } = load();

      api.set({ ...OFF, text: "large", highlight: true });

      expect(JSON.parse(store.get(KEY)!)).toEqual({
        ...OFF,
        text: "large",
        highlight: true
      });
      expect(attrs.get("data-a11y-text")).toBe("large");
      expect(attrs.has("data-a11y-highlight")).toBe(true);
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("awcms-a11y-change");
      expect(events[0]!.detail).toEqual({
        ...OFF,
        text: "large",
        highlight: true
      });
    });

    test("set() round-trips through a fresh page load", () => {
      const first = load();
      first.api.set({ ...OFF, dyslexia: true, text: "x-large" });

      const second = load({ stored: first.store.get(KEY) });

      expect(second.api.read()).toEqual({
        ...OFF,
        dyslexia: true,
        text: "x-large"
      });
      expect(second.attrs.has("data-a11y-dyslexia")).toBe(true);
    });

    test("set() with an invalid object falls back to defaults rather than storing junk", () => {
      const { api, store } = load();

      api.set({ v: 9, text: "huge" });

      expect(JSON.parse(store.get(KEY)!)).toEqual(OFF);
    });

    test("set() can switch a preference back off, removing its attribute", () => {
      const { api, attrs } = load();

      api.set({ ...OFF, mono: true });
      expect(attrs.has("data-a11y-mono")).toBe(true);
      api.set(OFF);
      expect(attrs.has("data-a11y-mono")).toBe(false);
    });

    test("reset() removes the key and every preference attribute", () => {
      const { api, attrs, store, events } = load();

      api.set({
        ...OFF,
        text: "large",
        contrast: true,
        mono: true,
        underline: true
      });
      api.reset();

      expect(store.has(KEY)).toBe(false);
      expect([...attrs.keys()]).toEqual(["data-a11y-ready"]);
      expect(events).toHaveLength(2);
    });

    test("reset() hands control back to the OS defaults", () => {
      const { api, attrs } = load({
        media: { "(prefers-reduced-motion: reduce)": true }
      });

      api.set({ ...OFF, motion: false });
      expect(attrs.has("data-a11y-motion")).toBe(false);
      api.reset();
      expect(attrs.get("data-a11y-motion")).toBe("reduce");
    });
  });
});

describe("language", () => {
  test("English for en and its regional forms; Indonesian for everything else", () => {
    expect(resolveReadingPreferencesLanguage("en")).toBe("en");
    expect(resolveReadingPreferencesLanguage("en-GB")).toBe("en");
    expect(resolveReadingPreferencesLanguage("EN_us")).toBe("en");
    expect(resolveReadingPreferencesLanguage("id")).toBe("id");
    expect(resolveReadingPreferencesLanguage("id-ID")).toBe("id");
    expect(resolveReadingPreferencesLanguage("fr")).toBe("id");
    expect(resolveReadingPreferencesLanguage("english")).toBe("id");
    expect(resolveReadingPreferencesLanguage("")).toBe("id");
    expect(resolveReadingPreferencesLanguage(null)).toBe("id");
    expect(resolveReadingPreferencesLanguage(undefined)).toBe("id");
  });
});

describe("panel markup", () => {
  const id = renderReadingPreferencesPanel("id", "Berita Kobar");
  const en = renderReadingPreferencesPanel("en", "Kobar News");

  test("is Indonesian by default, with the contract's strings", () => {
    expect(id).toContain('aria-label="Pengaturan aksesibilitas"');
    expect(id).toContain("Berita Kobar · Ramah baca");
    expect(id).toContain("Pengaturan Aksesibilitas");
    for (const text of [
      "Ukuran teks",
      "Normal",
      "Besar",
      "Sangat besar",
      "Kontras tinggi",
      "Mode monokrom",
      "Teks ramah disleksia",
      "Garis bawah semua tautan",
      "Sorot tautan kontras tinggi",
      "Kurangi gerakan",
      "Reset ke standar",
      "Tersimpan hanya di perangkat ini, tidak dikirim ke server."
    ]) {
      expect(id).toContain(text);
    }
  });

  test("is English for the en locale", () => {
    expect(en).toContain('aria-label="Accessibility settings"');
    expect(en).toContain("Kobar News · Reader friendly");
    for (const text of [
      "Text size",
      "Large",
      "Extra large",
      "High contrast",
      "Reduce motion",
      "Reset to defaults",
      "Saved on this device only, never sent to the server."
    ]) {
      expect(en).toContain(text);
    }
    expect(en).not.toContain("Pengaturan");
  });

  test("the eyebrow is just the label when there is no site name", () => {
    expect(renderReadingPreferencesPanel("id")).toContain(
      '<p class="a11y-eyebrow">Ramah baca</p>'
    );
    expect(renderReadingPreferencesPanel("id", "  ")).toContain(
      '<p class="a11y-eyebrow">Ramah baca</p>'
    );
  });

  test("escapes the site name", () => {
    const html = renderReadingPreferencesPanel("en", '<img src=x onerror="1">');

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  for (const [name, html] of [
    ["id", id],
    ["en", en]
  ] as const) {
    describe(`structure (${name})`, () => {
      test("the button and the dialog start hidden (progressive enhancement)", () => {
        expect(
          openingTags(html, "button").find((t) => t.includes('id="a11y-fab"'))
        ).toContain(" hidden");
        expect(
          openingTags(html, "div").find((t) => t.includes('id="a11y-panel"'))
        ).toContain(" hidden");
      });

      test("the button is wired to a NON-modal dialog", () => {
        expect(html).toContain('aria-expanded="false"');
        expect(html).toContain('aria-controls="a11y-panel"');
        expect(html).toContain('role="dialog"');
        expect(html).toContain('aria-labelledby="a11y-title"');
        expect(html).not.toContain("aria-modal");
      });

      test("every id is unique and every reference resolves", () => {
        const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!);

        expect(new Set(ids).size).toBe(ids.length);

        const refs = [
          ...[
            ...html.matchAll(
              /aria-(?:labelledby|describedby|controls)="([^"]+)"/g
            )
          ].map((m) => m[1]!),
          ...[...html.matchAll(/\bfor="([^"]+)"/g)].map((m) => m[1]!)
        ];

        for (const ref of refs) {
          expect(ids).toContain(ref);
        }
      });

      test("six switches, each a role=switch checkbox with a label and a description", () => {
        const switches = [
          ...html.matchAll(
            /<input type="checkbox" role="switch" id="([^"]+)" data-a11y-switch="([^"]+)" aria-describedby="([^"]+)"/g
          )
        ];

        expect(switches.map((m) => m[2])).toEqual([
          "contrast",
          "mono",
          "dyslexia",
          "underline",
          "highlight",
          "motion"
        ]);
        for (const [, controlId, , describedBy] of switches) {
          expect(html).toContain(`<label for="${controlId}">`);
          expect(html).toContain(`id="${describedBy}"`);
        }
      });

      test("text size is a three-option radio group under a legend", () => {
        expect(html).toContain("<fieldset");
        expect(html).toContain("<legend>");
        expect(
          [...html.matchAll(/name="a11y-text" value="([^"]+)"/g)].map(
            (m) => m[1]
          )
        ).toEqual(["normal", "large", "x-large"]);
      });

      test("no inline script, no inline style, no event-handler attribute", () => {
        expect(html.toLowerCase()).not.toContain("<script");
        expect(html.toLowerCase()).not.toContain("<style");
        expect(html).not.toMatch(/\sstyle=/i);
        expect(html).not.toMatch(/\son[a-z]+=/i);
      });
    });
  }
});

describe("head tags and CSP", () => {
  const head = renderReadingPreferencesHead();

  test("one stylesheet, a BLOCKING early script, a deferred panel script", () => {
    expect(head).toContain(
      `<link rel="stylesheet" href="${READING_PREFERENCES_STYLESHEET_HREF}" />`
    );
    // No `defer`/`async`: the early script must run before first paint.
    expect(head).toContain(
      `<script src="${READING_PREFERENCES_EARLY_SCRIPT_SRC}"></script>`
    );
    expect(head).toContain(
      `<script src="${READING_PREFERENCES_PANEL_SCRIPT_SRC}" defer></script>`
    );
  });

  test("every asset is a same-origin absolute path — no origin, no inline body", () => {
    const urls = [...head.matchAll(/(?:href|src)="([^"]+)"/g)].map(
      (m) => m[1]!
    );

    expect(urls).toHaveLength(3);
    for (const url of urls) {
      expect(url).toMatch(/^\/(?!\/)/);
      expect(url).not.toMatch(/^[a-z]+:/i);
    }
    // Every <script> has a src (no inline body) — which is what keeps the CSP's
    // `script-src 'self' <one hash>` untouched.
    for (const script of openingTags(head, "script")) {
      expect(script).toContain(" src=");
    }
    expect(head.toLowerCase()).not.toContain("<style");
  });

  test("every asset exists under public/ and is declared as reader weight", () => {
    for (const url of [
      READING_PREFERENCES_STYLESHEET_HREF,
      READING_PREFERENCES_EARLY_SCRIPT_SRC,
      READING_PREFERENCES_PANEL_SCRIPT_SRC
    ]) {
      expect(() => read(`public${url}`)).not.toThrow();
      expect(PUBLIC_ASSET_AUDIENCE[url.slice(1)]).toBe("reader");
    }
  });

  test("the shipped files make no network call and name no third-party origin", () => {
    for (const source of [EARLY_SOURCE, PANEL_SOURCE, CSS]) {
      expect(source).not.toMatch(/https?:\/\//i);
      expect(source).not.toMatch(
        /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|import\()/
      );
    }
    // The panel never touches storage itself — the early script is its only owner.
    expect(PANEL_SOURCE).not.toMatch(
      /localStorage|sessionStorage|document\.cookie|indexedDB/
    );
  });
});

describe("surfaces that carry the panel", () => {
  const shell = renderPublicPageShell({
    title: "T",
    description: "d",
    canonicalUrl: null,
    bodyHtml: "<h1>Blog</h1>",
    locale: "en",
    siteName: "Kobar News"
  });

  test("the blog shell links the assets in <head> and renders the panel after <main>", () => {
    const headEnd = shell.indexOf("</head>");

    expect(shell.indexOf(READING_PREFERENCES_EARLY_SCRIPT_SRC)).toBeGreaterThan(
      0
    );
    expect(shell.indexOf(READING_PREFERENCES_EARLY_SCRIPT_SRC)).toBeLessThan(
      headEnd
    );
    expect(shell.indexOf('id="a11y-fab"')).toBeGreaterThan(
      shell.indexOf("</main>")
    );
    expect(shell.indexOf('id="a11y-panel"')).toBeLessThan(
      shell.indexOf("</body>")
    );
    expect(shell).toContain("Kobar News · Reader friendly");
  });

  test("the blog shell takes the panel language from the page locale", () => {
    const id = renderPublicPageShell({
      title: "T",
      description: "d",
      canonicalUrl: null,
      bodyHtml: "",
      locale: "id"
    });

    expect(id).toContain("Pengaturan Aksesibilitas");
    expect(shell).toContain("Accessibility settings");
  });

  test("the blog shell still has no inline script of its own", () => {
    // The only <script> elements are the two same-origin files.
    const scripts = openingTags(shell, "script");

    expect(scripts).toHaveLength(2);
    for (const script of scripts) expect(script).toContain(" src=");
  });

  test("the search page carries it too", () => {
    const html = renderSearchPageDocument({
      locale: "id",
      siteName: "Berita Kobar",
      query: "",
      minQueryLength: 2,
      items: [],
      nextCursor: null,
      labels: DEFAULT_SEARCH_PAGE_LABELS
    });

    expect(html).toContain(READING_PREFERENCES_EARLY_SCRIPT_SRC);
    expect(html).toContain('id="a11y-panel"');
    expect(html.indexOf('id="a11y-fab"')).toBeGreaterThan(
      html.indexOf("</main>")
    );
    expect(openingTags(html, "script").every((s) => s.includes(" src="))).toBe(
      true
    );
  });

  test("the theme preview layout renders the same head and the same panel", () => {
    const layout = read("src/layouts/PublicThemeLayout.astro");

    expect(layout).toContain("renderReadingPreferencesHead()");
    expect(layout).toContain(
      "renderReadingPreferencesPanel(lang, model.themeName)"
    );
  });
});

describe("CSS and script agree", () => {
  const SET_BY_SCRIPT = [
    "data-a11y-text",
    "data-a11y-contrast",
    "data-a11y-mono",
    "data-a11y-dyslexia",
    "data-a11y-underline",
    "data-a11y-highlight",
    "data-a11y-motion",
    "data-a11y-ready"
  ];

  test("every attribute the script sets is styled, and the CSS invents none", () => {
    const inScript = new Set(
      [...EARLY_SOURCE.matchAll(/"(data-a11y-[a-z-]+)"/g)].map((m) => m[1]!)
    );
    const inCss = new Set(
      [...CSS.matchAll(/\[(data-a11y-[a-z-]+)/g)].map((m) => m[1]!)
    );

    expect([...inScript].sort()).toEqual([...SET_BY_SCRIPT].sort());
    expect([...inCss].sort()).toEqual([...SET_BY_SCRIPT].sort());
  });

  test("every preference rule hangs off an attribute, so non-users see no change", () => {
    // Strip comments and `@media`/`@font` wrappers, then look at what each
    // top-level selector starts with: either an attribute selector on <html>, an
    // `html:not([data-a11y-ready])` fallback, a token block, or the panel's own
    // `.a11y-` classes. A bare `body {` or `a {` here would restyle every page.
    const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [
      ...stripped.matchAll(/(?:^|[}\n])\s*([^@{}\n][^{}]*)\{/g)
    ]
      // A comma inside `:is(...)` does not start a new selector.
      .flatMap((m) => m[1]!.replace(/:is\([^)]*\)/g, ":is()").split(","))
      .map((s) => s.trim())
      .filter((s) => s !== "" && !s.startsWith("@"));

    expect(selectors.length).toBeGreaterThan(20);
    for (const selector of selectors) {
      expect(selector).toMatch(/^(html\b|\.a11y-)/);
    }
    // A bare `html {` is allowed in exactly one place: the custom-property
    // palette tokens, which no element reads until a preference maps them.
    const bare = selectors.filter((s) => s === "html");
    expect(bare).toHaveLength(1);
  });

  test("monochrome filters the ROOT only (a filter on body would break position: fixed)", () => {
    const code = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const filters = [
      ...code.matchAll(/([^{}]+)\{[^}]*filter:\s*grayscale\(1\)/g)
    ];

    expect(filters).toHaveLength(1);
    expect(filters[0]![1]!.trim()).toBe("html[data-a11y-mono]");
  });

  test("high contrast sets no colours under forced-colors", () => {
    const forcedNone = CSS.indexOf("@media (forced-colors: none)");
    const firstPalette = CSS.indexOf("--hc-bg:");
    const mapping = CSS.indexOf("html[data-a11y-contrast] {");

    expect(forcedNone).toBeGreaterThan(-1);
    expect(firstPalette).toBeGreaterThan(forcedNone);
    expect(mapping).toBeGreaterThan(forcedNone);
    // And the opposite block never assigns a page colour token.
    const forcedActive = CSS.slice(
      CSS.indexOf("@media (forced-colors: active)")
    );
    expect(forcedActive).not.toMatch(/--color-/);
  });

  test("the OS defaults are also honoured through CSS alone, gated on the script not having run", () => {
    expect(CSS).toMatch(
      /@media \(prefers-contrast: more\)\s*\{\s*html:not\(\[data-a11y-ready\]\)/
    );
    expect(CSS).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*html:not\(\[data-a11y-ready\]\)/
    );
  });

  test("the contract's declared effects are all present", () => {
    expect(CSS).toMatch(/\[data-a11y-text="large"\]\s*\{\s*font-size:\s*120%/);
    expect(CSS).toMatch(
      /\[data-a11y-text="x-large"\]\s*\{\s*font-size:\s*140%/
    );
    expect(CSS).toContain("letter-spacing: 0.12em");
    expect(CSS).toContain("word-spacing: 0.16em");
    expect(CSS).toContain("margin-block-end: 2em");
    expect(CSS).toMatch(/text-align:\s*start/);
    expect(CSS).toContain("text-underline-offset: 0.15em");
    expect(CSS).toContain("#ffeb3b");
    expect(CSS).toContain("#111");
    expect(CSS).toMatch(/animation:\s*none !important/);
    expect(CSS).toMatch(/transition:\s*none !important/);
    expect(CSS).toMatch(/scroll-behavior:\s*auto !important/);
    expect(CSS).toContain("system-ui");
    // No bundled "dyslexia font": no @font-face, no font file.
    expect(CSS).not.toContain("@font-face");
  });

  test("the panel is hidden in print and its targets are at least 44 px", () => {
    expect(CSS).toMatch(
      /@media print\s*\{[^}]*\.a11y-fab[^}]*display:\s*none !important/
    );
    expect(CSS).toMatch(
      /\.a11y-fab\s*\{[^}]*width:\s*48px;[^}]*height:\s*48px/
    );
    expect(CSS).toMatch(
      /\.a11y-close\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/
    );
    expect(CSS).toMatch(/\.a11y-reset\s*\{[^}]*min-height:\s*44px/);
  });

  test("[hidden] wins over the display the panel classes set", () => {
    expect(CSS).toMatch(
      /\.a11y-fab\[hidden\],\s*\.a11y-panel\[hidden\]\s*\{\s*display:\s*none/
    );
  });
});

describe("text size has something to scale", () => {
  test("public-content.css font-size tokens are rem, not px", () => {
    const publicCss = read("public/css/public-content.css");
    const tokens = [...publicCss.matchAll(/--fs-[a-z0-9]+:\s*([^;]+);/g)].map(
      (m) => m[1]!
    );

    expect(tokens.length).toBe(7);
    for (const value of tokens) {
      expect(value).toMatch(/rem$/);
    }
    // And no other `font-size: <n>px` that the root size would not reach.
    expect(publicCss).not.toMatch(/font-size:\s*\d+(?:\.\d+)?px/);
  });

  test("the rem values equal the old px values at the default 16px root", () => {
    const publicCss = read("public/css/public-content.css");
    const get = (name: string) =>
      Number(new RegExp(`--fs-${name}:\\s*([0-9.]+)rem`).exec(publicCss)![1]) *
      16;

    expect([
      get("sm"),
      get("base"),
      get("md"),
      get("lg"),
      get("xl"),
      get("2xl"),
      get("3xl")
    ]).toEqual([14, 16, 18, 20, 24, 32, 40]);
  });
});
