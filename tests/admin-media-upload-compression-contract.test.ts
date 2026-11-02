/**
 * The `/admin/media` uploader's compression wiring (Issue #1221), pinned at the
 * source level because the screen's client script cannot run under `bun test`.
 * The behaviour itself is in `media-image-compression-*.test.ts` and
 * `media-upload-client.test.ts`; this file holds the page to the promises the
 * issue made about it:
 *
 * - the cap shown, and the cap the client compresses to, are the server's;
 * - the compressing state is announced through a live region;
 * - the translated messages the client shows are the ones the server rendered,
 *   and every one of them has an English fallback that says the same thing;
 * - nothing the compressor does needs a CSP exemption (no inline script or
 *   style, no `blob:` URL);
 * - the planner and the orchestrator stay free of browser APIs, so they remain
 *   testable without a browser.
 *
 * Pure — no database, no browser. Runs in `quality` on every PR.
 */
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import { DEFAULT_COMPRESSION_MESSAGES } from "../src/lib/ui/media-upload-client";

const PAGE = readFileSync("src/pages/admin/media.astro", "utf8");
const UPLOAD_CLIENT = readFileSync("src/lib/ui/media-upload-client.ts", "utf8");
const PLAN = readFileSync("src/lib/ui/media-image-compression-plan.ts", "utf8");
const RUNNER = readFileSync("src/lib/ui/media-image-compression.ts", "utf8");
const ADAPTER = readFileSync(
  "src/lib/ui/media-image-compression-browser.ts",
  "utf8"
);

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The uploader `<section>` of the page, from its heading to the form's end. */
function uploaderMarkup(): string {
  const start = PAGE.indexOf('aria-labelledby="media-upload-title"');
  const end = PAGE.indexOf("</form>", start);
  return PAGE.slice(start, end);
}

describe("the uploader's cap", () => {
  test("the form carries the server's cap as data-max-bytes, not a number typed into the page", () => {
    expect(uploaderMarkup()).toContain("data-max-bytes={uploadMaxBytes}");
    expect(PAGE).toContain(
      "const uploadMaxBytes = uploadConfig.maxUploadBytes;"
    );
  });

  test("the hint states the cap in binary units and says what happens to each type", () => {
    const markup = uploaderMarkup();
    expect(markup).toContain("max: uploadMaxLabel");
    expect(markup).toContain("compressed in your browser");
    expect(markup).toContain("A GIF is never changed");
  });

  test("the client compresses through uploadMediaFile, never the bare byte uploader", () => {
    const script = PAGE.slice(PAGE.lastIndexOf("<script>"));
    expect(script).toContain("uploadMediaFile(");
    expect(script).not.toContain("uploadMediaBytes(");
    expect(script).toContain("createBrowserImagePorts");
  });

  test("an unreadable cap means the server decides, not that the client invents one", () => {
    const script = PAGE.slice(PAGE.lastIndexOf("<script>"));
    expect(script).toContain("Number(uploadForm.dataset.maxBytes)");
    expect(script).toMatch(
      /Number\.isInteger\(capAttribute\) && capAttribute > 0\s*\? capAttribute\s*: null/
    );
  });
});

describe("accessibility", () => {
  test("the compressing state and the upload progress are each a polite live region", () => {
    const markup = uploaderMarkup();

    for (const id of ["media-upload-compression", "media-upload-progress"]) {
      const element = markup.slice(markup.indexOf(`id="${id}"`));
      const tag = element.slice(0, element.indexOf(">"));

      expect(tag).toContain('role="status"');
      expect(tag).toContain('aria-live="polite"');
    }
  });

  test("the status lines are cleared, not toggled with `hidden`, so they hold their space", () => {
    const markup = uploaderMarkup();
    expect(markup).not.toMatch(
      /id="media-upload-(compression|progress)"[^>]*\bhidden\b/
    );
    expect(markup).toContain('class="media-upload-status"');

    const css = readFileSync("src/styles/admin-screens.css", "utf8");
    expect(css).toMatch(/\.media-upload-status\s*\{[^}]*min-block-size/);
  });

  test("the file input and the submit button are locked while the image is being compressed", () => {
    const script = PAGE.slice(PAGE.lastIndexOf("<script>"));
    // Issue #1224: the submit button is locked (and a second submit ignored) by
    // the shared `onSubmit` helper for the WHOLE handler, compression included,
    // so the upload must run inside `onSubmit` and the form must not bind its
    // own listener any more. The file input is this page's to lock.
    const bind = script.indexOf('onSubmit("media-upload-form"');
    const call = script.indexOf("await uploadMediaFile(");

    expect(bind).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(bind);
    expect(script).not.toContain("uploadForm.addEventListener(");
    expect(script).toContain("fileInput.disabled = true");
  });
});

describe("translated messages", () => {
  const rendered = [
    ...PAGE.matchAll(/"data-msg-([a-z-]+)":\s*t\(\s*"([^"]*)"\s*\)/g)
  ].map(([, name, text]) => ({
    key: (name as string).replace(/-([a-z])/g, (_, c: string) =>
      c.toUpperCase()
    ),
    text: text as string
  }));

  test("the page renders exactly the messages the client reads, no more and no fewer", () => {
    expect(rendered.map((entry) => entry.key).sort()).toEqual(
      Object.keys(DEFAULT_COMPRESSION_MESSAGES).sort()
    );
  });

  test("each rendered message is the same sentence as its English fallback", () => {
    const fallbacks: Record<string, string> = DEFAULT_COMPRESSION_MESSAGES;

    for (const { key, text } of rendered) {
      expect(text, key).toBe(fallbacks[key] as string);
    }
  });

  test("the form spreads them as data attributes the client reads off `dataset`", () => {
    expect(uploaderMarkup()).toContain("{...uploadMessageAttributes}");
    expect(UPLOAD_CLIENT).toContain("msgCompressing");
  });
});

describe("no CSP exemption is needed", () => {
  const compressionSources = { PLAN, RUNNER, ADAPTER, UPLOAD_CLIENT };

  test("no blob: URL and no <img>: createImageBitmap reads the File directly", () => {
    for (const [name, source] of Object.entries(compressionSources)) {
      const code = withoutComments(source);
      expect(code, name).not.toContain("createObjectURL");
      // A `blob:` URL scheme in a string, not the TypeScript `blob: Blob` field.
      expect(code, name).not.toMatch(/["'`]blob:/);
      expect(code, name).not.toMatch(
        /new Image\(|createElement\(\s*["']img["']/
      );
    }
  });

  test("no inline style attribute and no inline script in the uploader", () => {
    const markup = uploaderMarkup();
    expect(markup).not.toMatch(/\sstyle=/);
    expect(markup).not.toMatch(/<script/);
  });

  test("the script imports from the lib, so Astro emits an external file", () => {
    const script = PAGE.slice(PAGE.lastIndexOf("<script>"));
    expect(script).toContain('from "../../lib/ui/media-upload-client"');
    expect(script).toContain(
      'from "../../lib/ui/media-image-compression-browser"'
    );
  });
});

describe("what stays free of browser APIs", () => {
  test("the planner and the orchestrator name no DOM global (they are tested without a browser)", () => {
    for (const [name, source] of Object.entries({ PLAN, RUNNER })) {
      const code = withoutComments(source);
      expect(code, name).not.toMatch(
        /\b(document|window|OffscreenCanvas|createImageBitmap|HTMLCanvasElement|navigator)\b/
      );
    }
  });

  test("the browser adapter reaches the DOM only through its injected env or globalThis", () => {
    const code = withoutComments(ADAPTER);
    expect(code).not.toMatch(/\bwindow\./);
    // `document` is read through `globals.document`, never as a bare global.
    expect(code).not.toMatch(/(^|[^.\w])document\./m);
  });

  test("the server cap and the compressor are decoupled: this module reads no env", () => {
    for (const source of [PLAN, RUNNER, ADAPTER]) {
      expect(withoutComments(source)).not.toMatch(
        /process\.env|import\.meta\.env/
      );
    }
  });
});
