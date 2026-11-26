import { describe, expect, test } from "bun:test";
import {
  assertNoAdditions,
  buildFindings,
  createBaseline,
  diffBaseline,
  fatalEngineErrors,
  fingerprintOf,
  normalizeLine,
  normalizePath,
  normalizeRuleId,
  parseArgs,
  parseBaseline,
  tidyBaseline,
  type Baseline,
  type RawResult
} from "./opengrep-scan.ts";

const raw = (
  over: Partial<RawResult> & { line?: number; sev?: string } = {}
): RawResult => ({
  check_id: over.check_id ?? "a.b.tools.ci.sast.rules.javascript.x.regra",
  path: over.path ?? "src/a.ts",
  start: { line: over.line ?? 1, col: 1 },
  end: { line: over.line ?? 1, col: 10 },
  extra: { severity: over.sev ?? "ERROR", message: "pesan\nbaris dua" }
});

const src = (lines: string[]) => (_p: string, s: number, e: number) =>
  lines.slice(s - 1, e).join("\n");

describe("normalisasi", () => {
  test("whitespace dirapatkan", () => {
    expect(normalizeLine("  eval(  x )\t;\n ")).toBe("eval( x ) ;");
  });
  test("path", () => {
    expect(normalizePath("./src\\a.ts")).toBe("src/a.ts");
  });
  test("id aturan dibuang awalan direktori", () => {
    expect(
      normalizeRuleId("tmp.x.tools.ci.sast.rules.javascript.lang.eval")
    ).toBe("javascript.lang.eval");
    expect(normalizeRuleId("home.u.rules.typescript.aws.cdk.regra")).toBe(
      "typescript.aws.cdk.regra"
    );
    expect(normalizeRuleId("tools.ci.sast.rules.lokal.larang-eval")).toBe(
      "lokal.larang-eval"
    );
  });
});

describe("fingerprint", () => {
  test("stabil terhadap pergeseran nomor baris dan indentasi", () => {
    const a = buildFindings([raw({ line: 2 })], src(["x", "  eval(a)"]));
    const b = buildFindings(
      [raw({ line: 5 })],
      src(["", "", "", "", "      eval(a)"])
    );
    expect(a[0]!.fingerprint).toBe(b[0]!.fingerprint);
    expect(a[0]!.line).toBe(2);
    expect(b[0]!.line).toBe(5);
  });
  test("berubah bila teks, aturan, atau path berubah", () => {
    const base = fingerprintOf("r", "p", "eval(a)", 0);
    expect(fingerprintOf("r", "p", "eval(b)", 0)).not.toBe(base);
    expect(fingerprintOf("r2", "p", "eval(a)", 0)).not.toBe(base);
    expect(fingerprintOf("r", "p2", "eval(a)", 0)).not.toBe(base);
  });
  test("duplikat dalam satu berkas dibedakan lewat indeks kemunculan", () => {
    const f = buildFindings(
      [raw({ line: 1 }), raw({ line: 3 })],
      src(["eval(a)", "z", "eval(a)"])
    );
    expect(f[0]!.fingerprint).not.toBe(f[1]!.fingerprint);
  });
  test("urutan masukan tidak memengaruhi hasil", () => {
    const lines = ["eval(a)", "z", "eval(a)"];
    const f1 = buildFindings([raw({ line: 1 }), raw({ line: 3 })], src(lines));
    const f2 = buildFindings([raw({ line: 3 }), raw({ line: 1 })], src(lines));
    expect(f2.map((x) => x.fingerprint)).toEqual(f1.map((x) => x.fingerprint));
  });
  test("severity tak dikenal dianggap ERROR (gagal tertutup)", () => {
    expect(
      buildFindings([raw({ sev: "CRITICAL" })], src(["x"]))[0]!.severity
    ).toBe("ERROR");
  });
  test("pesan hanya baris pertama", () => {
    expect(buildFindings([raw()], src(["x"]))[0]!.message).toBe("pesan");
  });
});

const finding = (sev: string, text: string, path = "src/a.ts") =>
  buildFindings([raw({ sev, path })], src([text]))[0]!;

describe("diff baseline", () => {
  test("ERROR baru gagal, tercakup tidak, WARNING/INFO diabaikan gerbang", () => {
    const lama = finding("ERROR", "eval(lama)");
    const baru = finding("ERROR", "eval(baru)");
    const warn = finding("WARNING", "foo()");
    const b = createBaseline([lama], "2026-11-27");
    const d = diffBaseline([lama, baru, warn], b);
    expect(d.baru.map((f) => f.fingerprint)).toEqual([baru.fingerprint]);
    expect(d.tercakup).toHaveLength(1);
    expect(d.basi).toHaveLength(0);
  });
  test("entri basi terdeteksi", () => {
    const lama = finding("ERROR", "eval(lama)");
    const b = createBaseline([lama], "2026-11-27");
    expect(diffBaseline([], b).basi).toHaveLength(1);
  });
  test("createBaseline hanya ERROR dengan alasan adopsi", () => {
    const b = createBaseline(
      [finding("ERROR", "e(1)"), finding("WARNING", "w(1)")],
      "2026-11-27"
    );
    expect(b.entri).toHaveLength(1);
    expect(b.entri[0]!.alasan).toBe("temuan lama saat adopsi 2026-11-27");
  });
});

describe("larangan menambah dan rapikan", () => {
  const e1 = finding("ERROR", "e(1)");
  const e2 = finding("ERROR", "e(2)");
  const lama: Baseline = createBaseline([e1, e2], "2026-11-27");

  test("assertNoAdditions menolak entri baru", () => {
    const tambah: Baseline = {
      versi: 1,
      entri: [
        ...lama.entri,
        { rule: "r", path: "p", fingerprint: "zzz", alasan: "x" }
      ]
    };
    expect(() => assertNoAdditions(lama, tambah)).toThrow(
      /TIDAK BOLEH bertambah/
    );
    expect(() => assertNoAdditions(lama, lama)).not.toThrow();
  });
  test("tidy membuang basi, mempertahankan alasan hasil edit tangan", () => {
    const edit: Baseline = {
      versi: 1,
      entri: lama.entri.map((e) =>
        e.fingerprint === e1.fingerprint
          ? { ...e, alasan: "diterima: input terkontrol" }
          : e
      )
    };
    const { baseline, dibuang } = tidyBaseline(edit, [e1]);
    expect(dibuang.map((e) => e.fingerprint)).toEqual([e2.fingerprint]);
    expect(baseline.entri).toHaveLength(1);
    expect(baseline.entri[0]!.alasan).toBe("diterima: input terkontrol");
  });
  test("tidy tidak menambah walau ada ERROR baru", () => {
    const e3 = finding("ERROR", "e(3)");
    const { baseline } = tidyBaseline(lama, [e1, e2, e3]);
    expect(baseline.entri.map((e) => e.fingerprint).sort()).toEqual(
      [e1.fingerprint, e2.fingerprint].sort()
    );
  });
});

describe("parseBaseline", () => {
  test("menolak entri tanpa alasan", () => {
    expect(() =>
      parseBaseline({
        versi: 1,
        entri: [{ rule: "r", path: "p", fingerprint: "f", alasan: " " }]
      })
    ).toThrow(/alasan/);
  });
  test("menolak versi salah dan fingerprint ganda", () => {
    expect(() => parseBaseline({ versi: 2, entri: [] })).toThrow();
    const e = { rule: "r", path: "p", fingerprint: "f", alasan: "a" };
    expect(() => parseBaseline({ versi: 1, entri: [e, e] })).toThrow(/ganda/);
  });
  test("menerima baseline sah", () => {
    expect(parseBaseline({ versi: 1, entri: [] }).entri).toEqual([]);
  });
});

describe("parseArgs", () => {
  test("bawaan scan dengan baseline di root", () => {
    const o = parseArgs([], "/r");
    expect(o.command).toBe("scan");
    expect(o.baseline).toBe("/r/tools/ci/sast/baseline.json");
    expect(o.aturan).toBe("/r/tools/ci/sast/rules");
  });
  test("opsi bernilai, exclude berulang, bentuk = dan spasi", () => {
    const o = parseArgs(
      [
        "baseline",
        "--buat",
        "--root",
        "/x",
        "--baseline=b.json",
        "--exclude",
        "a",
        "--exclude=b"
      ],
      "/c"
    );
    expect(o.command).toBe("baseline");
    expect(o.buat).toBe(true);
    expect(o.root).toBe("/x");
    expect(o.baseline).toBe("/c/b.json");
    expect(o.exclude).toEqual(["a", "b"]);
  });
  test("opsi tak dikenal dan nilai hilang ditolak", () => {
    expect(() => parseArgs(["--aneh"])).toThrow();
    expect(() => parseArgs(["--root"])).toThrow();
  });
});

describe("galat mesin", () => {
  test("hanya galat aturan yang fatal", () => {
    expect(
      fatalEngineErrors([{ type: "PartialParsing" }, { type: "Lexical error" }])
    ).toHaveLength(0);
    expect(
      fatalEngineErrors([{ type: "InvalidRuleSchemaError" }])
    ).toHaveLength(1);
  });
});

describe("jobsFromEnv", () => {
  test("bawaan 5, ikut CI_LOKAL_CPUS bila valid", async () => {
    const { jobsFromEnv } = await import("./opengrep-scan.ts");
    expect(jobsFromEnv({})).toBe(5);
    expect(jobsFromEnv({ CI_LOKAL_CPUS: "3" })).toBe(3);
    expect(jobsFromEnv({ CI_LOKAL_CPUS: "x" })).toBe(5);
    expect(jobsFromEnv({ CI_LOKAL_CPUS: "0" })).toBe(5);
  });
});
