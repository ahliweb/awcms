/**
 * Unit tests for the `idn_admin_regions` parsing/normalisation domain
 * (ADR-0046). No database: these pin the two places where a mistake would be
 * invisible in production — a parser that silently drops rows, and a normalizer
 * that invents facts upstream never stated.
 */
import { describe, expect, test } from "bun:test";

import { parseWilayahDump } from "../src/modules/idn-admin-regions/domain/wilayah-dump-parser";
import {
  normalizeRegionRow,
  normalizeRegionRows,
  RegionNormalizationError
} from "../src/modules/idn-admin-regions/domain/region-normalization";

const HEADER = [
  "/*",
  "BISMILLAAHIRRAHMAANIRRAHIIM",
  "note     : Data Kode Wilayah sesuai Kepmendagri No 300.2.2-2138 Tahun 2025",
  "================================================================================*/",
  "--",
  "-- Table structure for table wilayah",
  "--",
  "",
  "DROP TABLE IF EXISTS wilayah;",
  "CREATE TABLE IF NOT EXISTS wilayah (",
  "    kode varchar(13) NOT NULL,",
  "    nama varchar(100) NOT NULL,",
  "    PRIMARY KEY (kode)",
  ") ENGINE=MyISAM;",
  "",
  "INSERT INTO wilayah (kode, nama)",
  "VALUES"
].join("\n");

function dump(...valueLines: string[]): string {
  return `${HEADER}\n${valueLines.join("\n")}`;
}

describe("parseWilayahDump", () => {
  test("parses value rows and ignores header, comments, and multi-line DDL", () => {
    const result = parseWilayahDump(
      dump(
        "('11','Aceh'),",
        "('11.01','Kabupaten Aceh Selatan'),",
        "('11.01.01','Bakongan'),",
        "('11.01.01.2001','Keude Bakongan');"
      )
    );

    expect(result.unparsed).toEqual([]);
    expect(result.duplicateCodes).toEqual([]);
    expect(result.rows.map((row) => row.code)).toEqual([
      "11",
      "11.01",
      "11.01.01",
      "11.01.01.2001"
    ]);
  });

  // The regression this test exists for: an early version treated `VALUES` as
  // the start of a multi-line statement and swallowed every value row, then
  // reported a clean, successful parse of ZERO regions. Asserting a COUNT is
  // what catches that; asserting "no errors" does not.
  test("a dump whose values all parse yields a row per value line, never zero", () => {
    const result = parseWilayahDump(
      dump("('11','Aceh'),", "('12','Sumatera Utara');")
    );

    expect(result.rows).toHaveLength(2);
  });

  test("CRLF line endings parse identically (the vendored file is CRLF)", () => {
    const crlf = dump("('11','Aceh');").replace(/\n/g, "\r\n");
    const result = parseWilayahDump(crlf);

    expect(result.unparsed).toEqual([]);
    expect(result.rows[0]).toMatchObject({ code: "11", name: "Aceh" });
  });

  test("a malformed value line is REPORTED, never skipped", () => {
    const result = parseWilayahDump(
      dump(
        "('11','Aceh'),",
        "('12','Sumatera Utara'",
        "('13','Sumatera Barat');"
      )
    );

    expect(result.rows).toHaveLength(2);
    expect(result.unparsed).toHaveLength(1);
    expect(result.unparsed[0]?.content).toContain("Sumatera Utara");
  });

  test("a non-numeric code is unparsed rather than imported as a region", () => {
    const result = parseWilayahDump(dump("('11a','Aceh');"));

    expect(result.rows).toHaveLength(0);
    expect(result.unparsed).toHaveLength(1);
  });

  test("duplicate codes are reported and kept once", () => {
    const result = parseWilayahDump(dump("('11','Aceh'),", "('11','Aceh');"));

    expect(result.rows).toHaveLength(1);
    expect(result.duplicateCodes).toEqual(["11"]);
  });

  test("MySQL string escapes are decoded (upstream has none today; a future dump may)", () => {
    const result = parseWilayahDump(dump(String.raw`('73.09','Ma\'rang');`));

    expect(result.rows[0]?.name).toBe("Ma'rang");
  });
});

describe("normalizeRegionRow", () => {
  const row = (code: string, name: string) => ({ code, name, lineNumber: 1 });

  test("derives tier, parent, and code forms from the dotted code", () => {
    expect(
      normalizeRegionRow(row("11.01.01.2001", "Keude Bakongan"))
    ).toMatchObject({
      level: 4,
      regionType: "village",
      parentCode: "11.01.01",
      codeCompact: "11010120 01".replace(" ", ""),
      provinceCode: "11",
      regencyCode: "11.01",
      districtCode: "11.01.01",
      villageCode: "11.01.01.2001"
    });
  });

  test("village term comes from the fourth segment's leading digit, including desa adat", () => {
    expect(normalizeRegionRow(row("11.01.01.1001", "Suprau")).localTerm).toBe(
      "Kelurahan"
    );
    expect(
      normalizeRegionRow(row("11.01.01.2001", "Krueng Batee")).localTerm
    ).toBe("Desa");
    // 14 of these exist in the vendored dump. A `digit === "1" ? … : "Desa"`
    // shortcut would label every one of them "Desa" — wrong, and invisible.
    expect(
      normalizeRegionRow(row("91.03.01.3007", "Desa Adat Yoboi")).localTerm
    ).toBe("Desa Adat");
  });

  test("an unknown village digit yields null rather than a guess", () => {
    expect(
      normalizeRegionRow(row("11.01.01.9001", "Anomali")).localTerm
    ).toBeNull();
  });

  test("regency term is read from the name, longest variant first", () => {
    expect(
      normalizeRegionRow(row("11.01", "Kabupaten Aceh Selatan"))
    ).toMatchObject({
      localTerm: "Kabupaten",
      metadata: { shortName: "Aceh Selatan", segments: 2 }
    });
    expect(
      normalizeRegionRow(row("31.71", "Kota Administrasi Jakarta Pusat"))
    ).toMatchObject({
      localTerm: "Kota Administrasi",
      metadata: { shortName: "Jakarta Pusat", segments: 2 }
    });
  });

  // Upstream ships bare district names. "Kecamatan" would be wrong for the
  // provinces that call the tier "Distrik", so the column stays null.
  test("district term is null — upstream states none", () => {
    expect(
      normalizeRegionRow(row("11.01.01", "Bakongan")).localTerm
    ).toBeNull();
  });

  test("trailing whitespace in an upstream name is trimmed", () => {
    const normalized = normalizeRegionRow(
      row("31.72", "Kota Administrasi Jakarta Utara ")
    );

    expect(normalized.officialName).toBe("Kota Administrasi Jakarta Utara");
    expect(normalized.normalizedName).toBe("kota administrasi jakarta utara");
  });

  test("a code the scheme cannot describe throws instead of importing", () => {
    expect(() =>
      normalizeRegionRow(row("11.01.01.2001.5", "Too deep"))
    ).toThrow(RegionNormalizationError);
    expect(() => normalizeRegionRow(row("11..01", "Empty segment"))).toThrow(
      RegionNormalizationError
    );
  });
});

describe("normalizeRegionRows", () => {
  const rows = [
    { code: "11", name: "Aceh", lineNumber: 1 },
    { code: "11.01", name: "Kabupaten Aceh Selatan", lineNumber: 2 },
    { code: "11.01.01", name: "Bakongan", lineNumber: 3 },
    { code: "11.01.01.2001", name: "Keude Bakongan", lineNumber: 4 }
  ];

  test("resolves ancestor paths in breadcrumb order", () => {
    const { regions, orphanCodes } = normalizeRegionRows(rows);
    const village = regions.find((region) => region.level === 4);

    expect(orphanCodes).toEqual([]);
    expect(village?.fullPathName).toBe(
      "Aceh, Kabupaten Aceh Selatan, Bakongan, Keude Bakongan"
    );
    // "/" not "." — every code already contains dots, and joining with one
    // would produce a string that looks like a code and is not.
    expect(village?.fullPathCode).toBe("11/11.01/11.01.01/11.01.01.2001");
  });

  test("a region whose parent is missing is reported as an orphan", () => {
    const { orphanCodes } = normalizeRegionRows([
      rows[0]!,
      rows[2]!, // 11.01.01 with its parent 11.01 absent
      rows[3]!
    ]);

    expect(orphanCodes).toContain("11.01.01");
  });
});
