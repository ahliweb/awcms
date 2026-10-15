/**
 * CSV formula neutralisation (Issue #978, PS-18 (c); OWASP CSV injection).
 *
 * A cell beginning with `=`, `+`, `-`, `@`, TAB or CR is a formula to a
 * spreadsheet. Every CSV writer in the repository goes through
 * `src/lib/security/csv-formula.ts`; the last test scans `src/` so a writer
 * added later cannot quietly keep its own copy.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { listFilesRecursive, REPO_ROOT } from "../scripts/lib/repo-files";
import { stripComments } from "../scripts/lib/source-text";
import {
  csvCellForWrite,
  neutralizeCsvFormula,
  quoteCsvCell,
  restoreCsvCell,
  startsWithCsvFormulaLeader
} from "../src/lib/security/csv-formula";
import { createLocalArchiveAdapter } from "../src/modules/data-lifecycle/infrastructure/local-archive-adapter";
import {
  readLocalExportArtifact,
  writeLocalExportArtifact
} from "../src/modules/reporting/infrastructure/local-export-adapter";

const LEADERS: string[] = ["=", "+", "-", "@", "\t", "\r"];

describe("neutralizeCsvFormula", () => {
  test.each(LEADERS)(
    "a cell starting with %j gets one leading single quote",
    (leader) => {
      const text = `${leader}cmd|' /c calc'!A0`;

      expect(startsWithCsvFormulaLeader(text)).toBe(true);
      expect(neutralizeCsvFormula(text)).toBe(`'${text}`);
    }
  );

  test("the classic payloads are all defused", () => {
    for (const payload of [
      "=1+1",
      '=HYPERLINK("http://evil.example","click")',
      "+SUM(A1:A9)",
      "-2+3",
      "@SUM(1+1)*cmd|' /c calc'!A0",
      "=cmd|' /c calc'!A0"
    ]) {
      expect(neutralizeCsvFormula(payload).startsWith("'")).toBe(true);
    }
  });

  test("ordinary text, an interior leader and the empty string are untouched", () => {
    for (const text of [
      "",
      "hello",
      "a=b",
      "x+y",
      "name@example.test",
      "1-2",
      "'quoted"
    ]) {
      expect(neutralizeCsvFormula(text)).toBe(text);
    }
  });
});

describe("look-alike and padded triggers (audit L3)", () => {
  test.each([
    " =1+1",
    "  @SUM(1)",
    "\u00a0=1",
    "\u200b=1",
    "\ufeff+1",
    "\u2060-1",
    "＝1+1",
    "＋1",
    "－1",
    "＠SUM(1)"
  ])("%j is neutralised", (text) => {
    expect(neutralizeCsvFormula(text)).toBe(`'${text}`);
  });

  test("an ordinary leading space, or a zero-width then text, is not", () => {
    expect(neutralizeCsvFormula(" hello")).toBe(" hello");
    expect(neutralizeCsvFormula("\u200bhello")).toBe("\u200bhello");
  });
});

describe("csvCellForWrite", () => {
  test("nullish is an empty cell", () => {
    expect(csvCellForWrite(null)).toBe("");
    expect(csvCellForWrite(undefined)).toBe("");
  });

  test("a formula-leading string is neutralised BEFORE quoting, so the prefix is inside the quotes", () => {
    expect(csvCellForWrite("=1+1")).toBe("'=1+1");
    expect(csvCellForWrite('=A1,"x"')).toBe('"\'=A1,""x"""');
    expect(csvCellForWrite("\tcmd")).toBe("'\tcmd");
    expect(csvCellForWrite("\rcmd")).toBe('"\'\rcmd"');
  });

  test("RFC 4180 quoting is unchanged for ordinary cells", () => {
    expect(csvCellForWrite("a,b")).toBe('"a,b"');
    expect(csvCellForWrite('say "hi"')).toBe('"say ""hi"""');
    expect(csvCellForWrite("two\nlines")).toBe('"two\nlines"');
    expect(quoteCsvCell("plain")).toBe("plain");
  });

  test("a typed number is written as a number (negative included); a numeric STRING is not trusted", () => {
    expect(csvCellForWrite(-5)).toBe("-5");
    expect(csvCellForWrite(3.25)).toBe("3.25");
    expect(csvCellForWrite(10n)).toBe("10");
    expect(csvCellForWrite("-5")).toBe("'-5");
  });

  test("dates, booleans and objects serialise as before", () => {
    expect(csvCellForWrite(new Date("2026-10-15T00:00:00.000Z"))).toBe(
      "2026-10-15T00:00:00.000Z"
    );
    expect(csvCellForWrite(true)).toBe("true");
    expect(csvCellForWrite({ a: 1 })).toBe('"{""a"":1}"');
  });
});

describe("reversible mode (archives that are parsed back)", () => {
  const SAMPLES = [
    "",
    "plain",
    "=1+1",
    "'=1+1",
    "''=1+1",
    "'abc",
    "'",
    "-5",
    "+x",
    "@y",
    "\tTab",
    "\rCR",
    "a,b",
    '"=quoted"',
    "'-'",
    "''",
    "= with space",
    " =padded",
    "' =padded",
    "＝fullwidth",
    "\u200b=zw"
  ];

  test("restore is the exact inverse of write for every sample", () => {
    for (const text of SAMPLES) {
      const written = csvCellForWrite(text, { reversible: true });
      // The writer may quote; undo quoting the way a parser would.
      const unquoted =
        written.startsWith('"') && written.endsWith('"')
          ? written.slice(1, -1).replace(/""/g, '"')
          : written;

      expect(restoreCsvCell(unquoted)).toBe(text);
    }
  });

  test("a value that ALREADY looks neutralised is prefixed again so restore cannot eat a real quote", () => {
    expect(csvCellForWrite("'=1", { reversible: true })).toBe("''=1");
    expect(restoreCsvCell("''=1")).toBe("'=1");
    // ...and a plain apostrophe is never touched in either direction.
    expect(csvCellForWrite("'abc", { reversible: true })).toBe("'abc");
    expect(restoreCsvCell("'abc")).toBe("'abc");
  });

  test("a random fuzz of leader/quote prefixes round-trips", () => {
    const alphabet = [
      "'",
      "=",
      "+",
      "-",
      "@",
      "\t",
      "\r",
      "a",
      "1",
      ",",
      '"',
      " "
    ];
    let seed = 978;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };

    for (let i = 0; i < 2000; i += 1) {
      const length = next() % 7;
      const text = Array.from(
        { length },
        () => alphabet[next() % alphabet.length]!
      ).join("");
      const written = csvCellForWrite(text, { reversible: true });
      const unquoted =
        written.startsWith('"') && written.endsWith('"')
          ? written.slice(1, -1).replace(/""/g, '"')
          : written;

      expect(restoreCsvCell(unquoted)).toBe(text);
    }
  });
});

describe("the two CSV writers in the repository", () => {
  const directories: string[] = [];

  afterAll(async () => {
    for (const directory of directories) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  async function temporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "csv-formula-"));
    directories.push(directory);

    return directory;
  }

  test("reporting export: a hostile label is written neutralised, a negative metric stays numeric", async () => {
    const root = await temporaryDirectory();
    const written = await writeLocalExportArtifact(
      root,
      "00000000-0000-4000-8000-000000000001",
      "fixture.projection",
      "csv",
      [
        { metricKey: "=cmd", label: "@SUM(1+1)", value: -3 },
        { metricKey: "ok", label: "+evil,still", value: 7 }
      ]
    );
    const content = await readLocalExportArtifact(written.storagePath);
    const lines = content.split("\n");

    expect(lines[0]).toBe("metricKey,label,value");
    expect(lines[1]).toBe("'=cmd,'@SUM(1+1),-3");
    expect(lines[2]).toBe('ok,"\'+evil,still",7');
  });

  test("a LEGACY archive (no marker) restores byte for byte, a leading quote included", async () => {
    const root = await temporaryDirectory();
    const adapter = createLocalArchiveAdapter(root);
    const target = path.join(root, "legacy.csv");

    await Bun.write(target, "id,note\n1,'=kept\n2,'abc\n");

    expect(await adapter.read(target)).toEqual([
      { id: "1", note: "'=kept" },
      { id: "2", note: "'abc" }
    ]);
  });

  test("data-lifecycle archive: hostile values are neutralised in the file AND restored exactly by read()", async () => {
    const root = await temporaryDirectory();
    const adapter = createLocalArchiveAdapter(root);
    const rows = [
      { id: "1", name: "=1+1", note: "'=already", amount: "-50.00" },
      { id: "2", name: "plain", note: "a,b\nc", amount: "+7" },
      { id: "3", name: "\tTab", note: "@me", amount: "'abc" }
    ];

    const result = await adapter.write({
      tenantId: "00000000-0000-4000-8000-000000000001",
      descriptorKey: "fixture.table",
      format: "csv",
      schemaVersion: "1",
      rows,
      cursorRangeStart: new Date("2026-01-01T00:00:00.000Z"),
      cursorRangeEnd: new Date("2026-02-01T00:00:00.000Z")
    });
    const onDisk = await readFile(result.artifactLocation, "utf8");

    // On disk nothing begins with a formula leader at a cell boundary.
    expect(onDisk).toContain("'=1+1");
    expect(onDisk).toContain("'-50.00");
    expect(onDisk).not.toMatch(/(^|,)=1\+1/m);

    const restored = await adapter.read(result.artifactLocation);

    expect(restored).toEqual(rows);
  });
});

describe("no CSV writer in src/ keeps its own copy of the rule", () => {
  /**
   * A file that DEFINES a CSV cell writer (`function csv...(`, or a `.csv`
   * artifact written by hand) must import the shared helper. The download route
   * only serves a stored artifact and the admin screen only offers the format as
   * a choice, so they are listed with that reason.
   */
  const NOT_WRITERS: Record<string, string> = {
    "src/pages/api/v1/reports/exports/runs/[id]/download.ts":
      "serves an artifact that local-export-adapter already wrote",
    "src/pages/api/v1/reports/exports/index.ts":
      "validates the format name only",
    "src/pages/api/v1/reports/exports/trigger.ts":
      "validates the format name only",
    "src/pages/admin/reporting.astro": "offers the format as a choice",
    "src/modules/reporting/application/export-generation.ts":
      "chooses the format; the adapter writes",
    "src/modules/reporting/application/export-run-store.ts":
      "stores the format name",
    "src/modules/reporting/application/scheduled-export-store.ts":
      "stores the format name",
    "src/modules/data-lifecycle/application/manifest-store.ts":
      "stores the format name",
    "src/modules/data-lifecycle/domain/archive-port.ts":
      "declares the format type",
    "src/modules/data-lifecycle/domain/subject-data-plan.ts": "prose only",
    "src/modules/_shared/module-contract.ts": "declares the format type",
    "src/lib/i18n/catalogs/id.generated.ts": "generated catalogue"
  };

  /** A function whose name says CSV, or a `text/csv` response. */
  const definesCsvWriter = (code: string): boolean =>
    /function\s+\w*csv\w*\s*\(/i.test(code) || /text\/csv/.test(code);

  const files = listFilesRecursive("src", {
    extensions: [".ts", ".astro"],
    relativeTo: REPO_ROOT
  });

  test("the scan finds the two known writers (so it is not vacuous)", async () => {
    const writers: string[] = [];

    for (const file of files) {
      const code = stripComments(
        await readFile(path.join(REPO_ROOT, file), "utf8")
      );

      if (definesCsvWriter(code)) {
        writers.push(file);
      }
    }

    expect(writers).toContain(
      "src/modules/reporting/infrastructure/local-export-adapter.ts"
    );
    expect(writers).toContain(
      "src/modules/data-lifecycle/infrastructure/local-archive-adapter.ts"
    );
  });

  test("every file that writes CSV cells imports the shared helper and defines no escape of its own", async () => {
    const offenders: string[] = [];

    for (const file of files) {
      if (file === "src/lib/security/csv-formula.ts") continue;
      if (Object.hasOwn(NOT_WRITERS, file)) continue;

      const code = stripComments(
        await readFile(path.join(REPO_ROOT, file), "utf8")
      );
      if (!definesCsvWriter(code)) continue;

      if (!code.includes("lib/security/csv-formula")) {
        offenders.push(
          `${file}: writes CSV without importing src/lib/security/csv-formula.ts`
        );
      }

      if (/function\s+csvEscape\s*\(/.test(code)) {
        offenders.push(`${file}: defines its own csvEscape`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
