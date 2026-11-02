/**
 * The single-flight audit table (Issue #1224): one row per form / mutation
 * entry point under `src/pages/**`, `src/components/**` and `src/lib/ui/**`,
 * rendered into `docs/awcms/ui-single-flight-audit.md` (and its `.id.md`
 * mirror) between two markers.
 *
 * ## What is derived and what is recorded
 *
 * The scan (`single-flight-scan.ts`) sees the tree as it is NOW. After #1224
 * that is the "after" column and the idempotency column, so both are derived.
 *
 * The "before" column is history, and a scan of today's tree cannot recover it
 * for the entries #1224 touched. For every other entry the page's own
 * protection is unchanged by #1224, so the scan's reading of it IS the before
 * state; for the handful that were converted or whose protection was not a
 * lock, {@link RECORDED} says what they were, with the reason. A row that is
 * neither scanned as locked nor listed there is `none` — the default is the
 * pessimistic one.
 *
 * ## The allow-list lives here too
 *
 * {@link ALLOWED_DIRECT_BINDINGS} is the explicit allow-list of the source
 * contract: a binding outside the shared helpers is a failing test unless it is
 * listed here with a reason. It is data in this file (not in the test) so the
 * rendered table can say WHY a row is an exception.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "./repo-files";
import {
  HELPER_NAMES,
  scanEntryPoints,
  type EntryKind
} from "./single-flight-scan";

export const AUDIT_DOCS = {
  en: "docs/awcms/ui-single-flight-audit.md",
  id: "docs/awcms/ui-single-flight-audit.id.md"
} as const;

export const BEGIN = "<!-- BEGIN GENERATED: single-flight-audit -->";
export const END = "<!-- END GENERATED: single-flight-audit -->";

/**
 * Bindings that are NOT `onSubmit` / `onSubmitAll` / `onAction` and are allowed
 * to stay that way. `count` is exact: a second binding in the same file fails
 * the contract until somebody decides, and an entry that stopped existing fails
 * it too (a stale allow-list is a hole nobody can see).
 */
export const ALLOWED_DIRECT_BINDINGS: readonly {
  file: string;
  count: number;
  reason: string;
}[] = [
  {
    file: "src/lib/ui/mission-control/actions.ts",
    count: 2,
    reason:
      "Buttons CREATED by script inside the mission-control HUD (no form, no stable selector). Own `busy` flag + disabled while the POST is in flight, and a fresh `Idempotency-Key` per send."
  },
  {
    file: "src/lib/ui/reason-panel-client.ts",
    count: 1,
    reason:
      "The `<dialog>` confirm button of `ReasonPanel`, not a form. `lockElement` runs synchronously before the first await and the dialog closes on the same click, so a second click has no target."
  },
  {
    file: "src/lib/ui/blog-preview-overlay.ts",
    count: 1,
    reason:
      "Enter inside a `contenteditable` block of the preview overlay: a standalone bundle with no `<form>`. A `saving` flag now ignores a second Enter while the PATCH is in flight (found by this audit); the PATCH also converges on retry."
  }
];

type Before = "lock" | "own flag" | "none" | "n/a";

/**
 * Pre-#1224 facts the scan of today's tree cannot show: how the entry was
 * BOUND and how it was protected, for the entries #1224 changed or whose
 * protection was not a lock. Keyed `file|target`.
 */
const RECORDED: Record<
  string,
  { binding: string; before: Before; note: string }
> = {
  "src/pages/login.astro|login-form": {
    binding: "direct submit",
    before: "lock",
    note: "`lockElement` + `submitButton.disabled` check"
  },
  "src/pages/register.astro|register-form": {
    binding: "direct submit",
    before: "lock",
    note: "`lockElement` + `submitButton.disabled` check"
  },
  "src/pages/forgot-password.astro|forgot-form": {
    binding: "direct submit",
    before: "lock",
    note: "`lockElement` + `submitButton.disabled` check"
  },
  "src/pages/reset-password.astro|reset-form": {
    binding: "direct submit",
    before: "lock",
    note: "`lockElement` + `submitButton.disabled` check"
  },
  "src/pages/accept-invitation.astro|invitation-form": {
    binding: "direct submit",
    before: "lock",
    note: "`lockElement` + `submitButton.disabled` check"
  },
  "src/lib/ui/language-switcher-client.ts|.locale-switcher": {
    binding: "direct submit",
    before: "own flag",
    note: "`select.disabled`; the form had no other guard (Enter in the select)"
  },
  "src/pages/admin/media.astro|media-upload-form": {
    binding: "direct submit",
    before: "own flag",
    note: "`submit.disabled` + `fileInput.disabled`"
  },
  "src/pages/admin/media.astro|media-rights-fields": {
    binding: "direct submit",
    before: "lock",
    note: "`mutateAndReload`"
  },
  "src/pages/admin/omes/progres-hermes.astro|#repo-progress-config-clear": {
    binding: "direct click",
    before: "lock",
    note: "`mutateAndReload`"
  },
  "src/pages/admin/push-notifications.astro|#push-enable-button": {
    binding: "direct click",
    before: "own flag",
    note: "`button.disabled` in try/finally"
  },
  "src/pages/admin/push-notifications.astro|#push-disable-button": {
    binding: "direct click",
    before: "own flag",
    note: "`button.disabled` in try/finally"
  },
  "src/pages/admin/push-notifications.astro|#push-test-button": {
    binding: "direct click",
    before: "own flag",
    note: "`button.disabled` in try/finally"
  },
  "src/pages/admin/push-notifications.astro|button.push-cancel": {
    binding: "onAction",
    before: "own flag",
    note: "`button.disabled`, left set on success"
  },
  "src/lib/ui/admin-account-client.ts|account-mfa-start-form": {
    binding: "onSubmit",
    before: "own flag",
    note: "`submit.disabled` around the request"
  },
  "src/lib/ui/admin-account-client.ts|account-mfa-verify-form": {
    binding: "onSubmit",
    before: "own flag",
    note: "`submit.disabled` around the request"
  },
  "src/lib/ui/admin-account-client.ts|#account-mfa-codes": {
    binding: "onAction",
    before: "own flag",
    note: "`button.disabled` around the request"
  },
  "src/lib/ui/admin-account-client.ts|.account-sso-link": {
    binding: "onAction",
    before: "none",
    note: "no lock at all; navigates away on success. Each click minted a link request"
  },
  "src/pages/admin/inventory.astro|.js-reversal-form": {
    binding: "onSubmitAll",
    before: "none",
    note: "`mutateAndReload(null, …)`: the reason panel's hidden form has no button to lock; the `Idempotency-Key` was the only guard"
  },
  "src/pages/admin/procurement.astro|.js-document-reason-form": {
    binding: "onSubmitAll",
    before: "none",
    note: "`mutateAndReload(null, …)`: as above"
  },
  "src/lib/ui/mission-control/actions.ts|click": {
    binding: "direct click",
    before: "own flag",
    note: "`busy` flag + disabled"
  },
  "src/lib/ui/blog-preview-overlay.ts|keydown": {
    binding: "direct keydown",
    before: "none",
    note: "Enter re-fired `saveEditing` while the PATCH was pending"
  }
};

/** Mutating entries whose request the scan cannot see through. */
const MUTATES_OVERRIDE = new Set([
  "src/lib/ui/language-switcher-client.ts|.locale-switcher"
]);

export type AuditRow = {
  file: string;
  target: string;
  /** How it is bound NOW. */
  binding: string;
  mutates: boolean;
  /** How it was bound and protected BEFORE #1224. */
  bindingBefore: string;
  before: Before;
  beforeNote: string;
  /** `single-flight` (helper) or `exception`. */
  after: "single-flight" | "exception";
  /** Idempotency-Key sent by the client. */
  key: boolean;
  exceptionReason: string | null;
};

function bindingLabel(kind: EntryKind, target: string): string {
  if (kind === "direct-submit") return "direct submit";
  if (kind === "direct-event") return `direct ${target || "event"}`;

  return kind;
}

export function auditRows(root: string = REPO_ROOT): AuditRow[] {
  const { entries } = scanEntryPoints({ root });

  return entries.map((entry): AuditRow => {
    const key = `${entry.file}|${entry.target}`;
    const recorded = RECORDED[key];
    const mutates = entry.reachesRequest || MUTATES_OVERRIDE.has(key);
    const exception = ALLOWED_DIRECT_BINDINGS.find(
      (item) => item.file === entry.file && !isHelper(entry.kind)
    );
    const binding = bindingLabel(entry.kind, entry.target);

    let before: Before;

    if (recorded) before = recorded.before;
    else if (entry.guard === "lock") before = "lock";
    else before = mutates ? "none" : "n/a";

    return {
      file: entry.file,
      target: entry.target,
      binding,
      mutates,
      bindingBefore: recorded?.binding ?? binding,
      before,
      beforeNote: recorded?.note ?? "",
      after: exception ? "exception" : "single-flight",
      key: entry.idempotencyKey,
      exceptionReason: exception?.reason ?? null
    };
  });
}

function isHelper(kind: EntryKind): boolean {
  return (HELPER_NAMES as readonly string[]).includes(kind);
}

export type AuditSummary = {
  entryPoints: number;
  mutating: number;
  beforeLock: number;
  beforeOwn: number;
  beforeNone: number;
  noRequest: number;
  afterSingleFlight: number;
  exceptions: number;
  byBinding: Record<string, number>;
  files: number;
};

export function summarize(rows: readonly AuditRow[]): AuditSummary {
  const mutating = rows.filter((row) => row.mutates);
  const byBinding: Record<string, number> = {};

  for (const row of rows) {
    byBinding[row.binding] = (byBinding[row.binding] ?? 0) + 1;
  }

  return {
    entryPoints: rows.length,
    mutating: mutating.length,
    beforeLock: mutating.filter((row) => row.before === "lock").length,
    beforeOwn: mutating.filter((row) => row.before === "own flag").length,
    beforeNone: mutating.filter((row) => row.before === "none").length,
    noRequest: rows.length - mutating.length,
    afterSingleFlight: rows.filter((row) => row.after === "single-flight")
      .length,
    exceptions: rows.filter((row) => row.after === "exception").length,
    byBinding,
    files: new Set(rows.map((row) => row.file)).size
  };
}

type Language = "en" | "id";

const LABELS: Record<
  Language,
  {
    headers: string[];
    noRequest: string;
    key: string;
    afterSingle: string;
    afterException: string;
    summary: (s: AuditSummary) => string;
    exceptions: string;
  }
> = {
  en: {
    headers: [
      "File",
      "Target",
      "Bound as (now)",
      "Before #1224",
      "After #1224",
      "Idempotency-Key sent"
    ],
    noRequest: "no request",
    key: "yes",
    afterSingle: "single-flight (helper)",
    afterException: "exception (allow-list)",
    summary: (s) =>
      `${s.entryPoints} entry points in ${s.files} files; ${s.mutating} send a mutating request and ${s.noRequest} do not. Before #1224 those ${s.mutating} were protected by \`lockElement\`/\`mutateAndReload\` in ${s.beforeLock}, by a hand-rolled flag in ${s.beforeOwn}, and by nothing in ${s.beforeNone}. After: ${s.afterSingleFlight} of the ${s.entryPoints} are bound through the shared helpers (single flight by default); the other ${s.exceptions} are listed exceptions that keep their own reviewed guard.`,
    exceptions: "Allowed exceptions"
  },
  id: {
    headers: [
      "Berkas",
      "Target",
      "Dipasang sebagai (kini)",
      "Sebelum #1224",
      "Sesudah #1224",
      "Idempotency-Key dikirim"
    ],
    noRequest: "tanpa request",
    key: "ya",
    afterSingle: "single-flight (helper)",
    afterException: "pengecualian (allow-list)",
    summary: (s) =>
      `${s.entryPoints} titik masuk di ${s.files} berkas; ${s.mutating} mengirim request yang mengubah data dan ${s.noRequest} tidak. Sebelum #1224 ke-${s.mutating} itu dijaga \`lockElement\`/\`mutateAndReload\` pada ${s.beforeLock}, flag buatan sendiri pada ${s.beforeOwn}, dan tidak ada sama sekali pada ${s.beforeNone}. Sesudahnya: ${s.afterSingleFlight} dari ${s.entryPoints} dipasang lewat helper bersama (single flight secara bawaan); ${s.exceptions} sisanya adalah pengecualian terdaftar yang mempertahankan penjaganya sendiri yang sudah ditinjau.`,
    exceptions: "Pengecualian yang diizinkan"
  }
};

const BEFORE_LABEL: Record<Language, Record<Before, string>> = {
  en: {
    lock: "`lockElement`/`mutateAndReload`",
    "own flag": "own flag",
    none: "**none**",
    "n/a": "n/a"
  },
  id: {
    lock: "`lockElement`/`mutateAndReload`",
    "own flag": "flag sendiri",
    none: "**tidak ada**",
    "n/a": "n/a"
  }
};

/** The generated block (markers included) for `language`. */
export function renderBlock(
  rows: readonly AuditRow[],
  language: Language
): string {
  const labels = LABELS[language];
  const summary = summarize(rows);
  const lines = [BEGIN, "", labels.summary(summary), ""];

  lines.push(`| ${labels.headers.join(" | ")} |`);
  lines.push(`| ${labels.headers.map(() => "---").join(" | ")} |`);

  for (const row of rows) {
    const before = row.mutates
      ? BEFORE_LABEL[language][row.before]
      : labels.noRequest;
    const beforeCell =
      row.bindingBefore !== row.binding
        ? `${row.bindingBefore}: ${before}`
        : before;
    const note = row.beforeNote ? ` (${row.beforeNote})` : "";

    lines.push(
      `| \`${row.file}\` | \`${row.target.replace(/\|/g, "\\|")}\` | ${row.binding} | ${beforeCell}${note} | ${
        row.after === "exception" ? labels.afterException : labels.afterSingle
      } | ${row.key ? labels.key : "—"} |`
    );
  }

  lines.push("", `**${labels.exceptions}**`, "");

  for (const item of ALLOWED_DIRECT_BINDINGS) {
    lines.push(`- \`${item.file}\` (${item.count}) — ${item.reason}`);
  }

  lines.push("", END);

  return lines.join("\n");
}

/**
 * Prettier pads table columns and rewrites the separator row, and wraps long
 * paragraphs; none of that is drift. Compared after collapsing all whitespace
 * and the separator dashes — the same rule `scripts-inventory.ts` documents.
 */
export function normalizeBlock(block: string): string {
  return block
    .replace(/\|\s*-+\s*(?=\|)/g, "|---")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractBlock(markdown: string): string | null {
  const start = markdown.indexOf(BEGIN);
  const end = markdown.indexOf(END);

  if (start === -1 || end === -1 || end < start) return null;

  return markdown.slice(start, end + END.length);
}

export function checkDocs(root: string = REPO_ROOT): string[] {
  const rows = auditRows(root);
  const problems: string[] = [];

  for (const language of ["en", "id"] as const) {
    const file = AUDIT_DOCS[language];
    let current: string | null;

    try {
      current = extractBlock(readFileSync(path.join(root, file), "utf8"));
    } catch {
      problems.push(`${file}: missing`);
      continue;
    }

    if (current === null) {
      problems.push(`${file}: no generated block (${BEGIN} … ${END})`);
    } else if (
      normalizeBlock(current) !== normalizeBlock(renderBlock(rows, language))
    ) {
      problems.push(
        `${file}: the audit table is out of date — run \`bun run ui:single-flight:audit --write\``
      );
    }
  }

  return problems;
}

export function writeDocs(root: string = REPO_ROOT): void {
  const rows = auditRows(root);

  for (const language of ["en", "id"] as const) {
    const file = path.join(root, AUDIT_DOCS[language]);
    const text = readFileSync(file, "utf8");
    const current = extractBlock(text);

    if (current === null) {
      throw new Error(
        `${AUDIT_DOCS[language]}: generated block markers missing`
      );
    }

    writeFileSync(
      file,
      text.replace(current, renderBlock(rows, language)),
      "utf8"
    );
  }
}
