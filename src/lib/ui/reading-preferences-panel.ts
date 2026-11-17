import { escapeHtml } from "../html/escape";

/**
 * The public reading-preferences panel (Issue #1369, ADR-0166): server-rendered
 * markup and head tags, shared by every public HTML surface.
 *
 * ## What this is, and what it is not
 *
 * A set of DISPLAY PREFERENCES a reader can choose — text size, high contrast,
 * monochrome, dyslexia-friendly spacing, link emphasis, reduced motion. It is
 * not an "accessibility overlay": it never rewrites content, never injects ARIA,
 * never loads third-party code and never claims conformance. The pages must
 * already meet WCAG 2.2 AA in their own markup; this is supplementary.
 *
 * ## Who calls it
 *
 * `renderPublicPageShell` (blog), `renderSearchPageDocument` (/search) and
 * `PublicThemeLayout.astro` (theme preview). It lives in `lib/ui` rather than in
 * a module's `domain/` because three modules need it and none of them may
 * import another's domain.
 *
 * ## Why the markup is rendered here and not built by the script
 *
 * The dialog's text is rendered by the server, in the page's language, with the
 * floating button `hidden`. Consequences, all intended:
 *
 * - No i18n runtime in the browser: the script carries no strings.
 * - Without JavaScript nothing visible changes — the button is only revealed by
 *   `js/a11y-panel.js`, so there is never a control that does nothing.
 * - Nothing here depends on the reader: the HTML is identical for everyone, so
 *   it is as cacheable as the page around it. Stored preferences live only in
 *   the visitor's `localStorage` and are applied client-side.
 *
 * ## CSP
 *
 * Unchanged. Two same-origin scripts and one same-origin stylesheet, no inline
 * script, no inline `style=""`, no new origin, no new hash
 * (`src/lib/security/security-headers.ts`, `tests/security-headers-csp.test.ts`).
 */

/** Same-origin assets under `public/`; all are `reader` weight (`scripts/client-asset-budget.ts`). */
export const READING_PREFERENCES_STYLESHEET_HREF = "/css/public-a11y.css";
export const READING_PREFERENCES_EARLY_SCRIPT_SRC = "/js/a11y-early.js";
export const READING_PREFERENCES_PANEL_SCRIPT_SRC = "/js/a11y-panel.js";

export type ReadingPreferencesLanguage = "id" | "en";

/**
 * English for `en` and its regional forms, Indonesian for everything else.
 * Indonesian is the product's primary reader language; the repo's supported
 * locales are `id` and `en` only (`lib/i18n/locales.ts`).
 */
export function resolveReadingPreferencesLanguage(
  locale: string | null | undefined
): ReadingPreferencesLanguage {
  return typeof locale === "string" && /^en(?:[-_]|$)/i.test(locale.trim())
    ? "en"
    : "id";
}

type SwitchKey =
  "contrast" | "mono" | "dyslexia" | "underline" | "highlight" | "motion";

type Strings = {
  fab: string;
  eyebrow: string;
  title: string;
  description: string;
  textSize: string;
  textNormal: string;
  textLarge: string;
  textXLarge: string;
  reset: string;
  close: string;
  note: string;
  switches: Record<SwitchKey, { label: string; description: string }>;
};

const STRINGS: Record<ReadingPreferencesLanguage, Strings> = {
  id: {
    fab: "Pengaturan aksesibilitas",
    eyebrow: "Ramah baca",
    title: "Pengaturan Aksesibilitas",
    description: "Sesuaikan tampilan halaman agar nyaman Anda baca.",
    textSize: "Ukuran teks",
    textNormal: "Normal",
    textLarge: "Besar",
    textXLarge: "Sangat besar",
    reset: "Reset ke standar",
    close: "Tutup pengaturan",
    note: "Tersimpan hanya di perangkat ini, tidak dikirim ke server.",
    switches: {
      contrast: {
        label: "Kontras tinggi",
        description: "Perjelas perbedaan teks, garis, dan foto"
      },
      mono: {
        label: "Mode monokrom",
        description: "Tampilan hitam-putih"
      },
      dyslexia: {
        label: "Teks ramah disleksia",
        description: "Huruf sans bersih dengan spasi lebar"
      },
      underline: {
        label: "Garis bawah semua tautan",
        description: "Tautan mudah dikenali tanpa bergantung pada warna"
      },
      highlight: {
        label: "Sorot tautan kontras tinggi",
        description: "Tandai tautan dengan warna kuning"
      },
      motion: {
        label: "Kurangi gerakan",
        description: "Hentikan animasi dan teks berjalan"
      }
    }
  },
  en: {
    fab: "Accessibility settings",
    eyebrow: "Reader friendly",
    title: "Accessibility settings",
    description: "Adjust how this page looks so it is comfortable to read.",
    textSize: "Text size",
    textNormal: "Normal",
    textLarge: "Large",
    textXLarge: "Extra large",
    reset: "Reset to defaults",
    close: "Close settings",
    note: "Saved on this device only, never sent to the server.",
    switches: {
      contrast: {
        label: "High contrast",
        description: "Sharpen the difference between text, lines and photos"
      },
      mono: {
        label: "Monochrome",
        description: "Black-and-white display"
      },
      dyslexia: {
        label: "Dyslexia-friendly text",
        description: "Clean sans-serif letters with wide spacing"
      },
      underline: {
        label: "Underline all links",
        description: "Links stand out without relying on colour"
      },
      highlight: {
        label: "Highlight links",
        description: "Mark links with a yellow background"
      },
      motion: {
        label: "Reduce motion",
        description: "Stop animation and moving text"
      }
    }
  }
};

/** Order matches the contract (§5): the six switches below the text-size group. */
const SWITCH_ORDER: readonly SwitchKey[] = [
  "contrast",
  "mono",
  "dyslexia",
  "underline",
  "highlight",
  "motion"
];

/**
 * Stylesheet + scripts for `<head>`. The first script is a classic BLOCKING
 * script on purpose: it must put a saved preference on `<html>` before first
 * paint, and a `defer`red one would flash the default and re-flow. The second
 * is `defer` and only reveals and wires the panel.
 */
export function renderReadingPreferencesHead(): string {
  return `<link rel="stylesheet" href="${READING_PREFERENCES_STYLESHEET_HREF}" />
<script src="${READING_PREFERENCES_EARLY_SCRIPT_SRC}"></script>
<script src="${READING_PREFERENCES_PANEL_SCRIPT_SRC}" defer></script>`;
}

const ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm8 6.5-5.5.5V22h-2v-6h-1v6h-2V9L4 8.5V6.5l8 1 8-1v2z"/></svg>';

/**
 * The floating button and the dialog. Both start `hidden`; `js/a11y-panel.js`
 * reveals the button and toggles the dialog.
 *
 * Switches are native checkboxes with `role="switch"`: the browser supplies the
 * keyboard behaviour and the checked state, and each label and description is
 * associated through `for` / `aria-describedby`, not by proximity.
 */
export function renderReadingPreferencesPanel(
  locale: string | null | undefined,
  siteName?: string | null
): string {
  const s = STRINGS[resolveReadingPreferencesLanguage(locale)];
  const name = typeof siteName === "string" ? siteName.trim() : "";
  const eyebrow = name ? `${name} · ${s.eyebrow}` : s.eyebrow;

  const radio = (value: string, label: string): string =>
    `<label><input type="radio" name="a11y-text" value="${value}" /><span>${escapeHtml(label)}</span></label>`;

  const rows = SWITCH_ORDER.map((key) => {
    const { label, description } = s.switches[key];
    return `<li class="a11y-row">
<label for="a11y-sw-${key}">${escapeHtml(label)}</label>
<span class="a11y-sub" id="a11y-sw-${key}-d">${escapeHtml(description)}</span>
<input type="checkbox" role="switch" id="a11y-sw-${key}" data-a11y-switch="${key}" aria-describedby="a11y-sw-${key}-d" />
</li>`;
  }).join("\n");

  return `<button type="button" class="a11y-fab" id="a11y-fab" aria-label="${escapeHtml(s.fab)}" aria-expanded="false" aria-controls="a11y-panel" hidden>${ICON}<span class="a11y-vh">${escapeHtml(s.fab)}</span></button>
<div class="a11y-panel" id="a11y-panel" role="dialog" aria-labelledby="a11y-title" aria-describedby="a11y-desc" hidden>
<div class="a11y-head">
<div>
<p class="a11y-eyebrow">${escapeHtml(eyebrow)}</p>
<h2 class="a11y-title" id="a11y-title" tabindex="-1">${escapeHtml(s.title)}</h2>
</div>
<button type="button" class="a11y-close" id="a11y-close" aria-label="${escapeHtml(s.close)}"><span aria-hidden="true">&times;</span></button>
</div>
<p class="a11y-desc" id="a11y-desc">${escapeHtml(s.description)}</p>
<fieldset class="a11y-group">
<legend>${escapeHtml(s.textSize)}</legend>
<div class="a11y-seg">
${radio("normal", s.textNormal)}
${radio("large", s.textLarge)}
${radio("x-large", s.textXLarge)}
</div>
</fieldset>
<ul class="a11y-list">
${rows}
</ul>
<button type="button" class="a11y-reset" id="a11y-reset">${escapeHtml(s.reset)}</button>
<p class="a11y-note">${escapeHtml(s.note)}</p>
</div>`;
}
