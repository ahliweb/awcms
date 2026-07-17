/**
 * Unit test untuk logika murni pemeriksa dokumentasi
 * (`scripts/lib/docs-checks.mjs`). Dijalankan dengan `bun test`.
 */
import { describe, expect, test } from "bun:test";
import {
  MERMAID_TYPES,
  checkMermaid,
  slugify,
  headingSlugs,
  checkNaming,
  NAMING_EXEMPTIONS,
  checkKnownScripts,
  checkSqlMigrationReferences,
  SQL_REF_UNCHECKED_FILES,
  AUTHORITATIVE_SCRIPT_DOC_FILES,
  extractLinks,
  classifyLink,
  splitTarget,
  parseComposeServiceNames,
  checkComposeServiceNames
} from "../scripts/lib/docs-checks.mjs";

/** @param {string} s */
const lines = (s) => s.split("\n");

describe("checkMermaid", () => {
  test("blok valid (flowchart) tidak menghasilkan temuan", () => {
    const md = "```mermaid\nflowchart LR\n  A --> B\n```";
    expect(checkMermaid("f.md", lines(md))).toEqual([]);
  });

  test("menerima semua tipe diagram yang dikenal", () => {
    for (const type of MERMAID_TYPES) {
      const md = "```mermaid\n" + type + "\n```";
      expect(checkMermaid("f.md", lines(md))).toEqual([]);
    }
  });

  test("tipe diagram tak dikenal dilaporkan dengan nomor baris", () => {
    const md = "intro\n```mermaid\nbogus X\n```";
    const problems = checkMermaid("f.md", lines(md));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("bogus");
    expect(problems[0]?.line).toBe(3);
  });

  test("blok mermaid kosong dilaporkan", () => {
    const md = "```mermaid\n```";
    const problems = checkMermaid("f.md", lines(md));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("tanpa tipe diagram");
  });

  test("blok tidak ditutup dilaporkan", () => {
    const md = "```mermaid\nflowchart LR\n  A --> B";
    const problems = checkMermaid("f.md", lines(md));
    expect(problems.some((p) => p.message.includes("tidak ditutup"))).toBe(
      true
    );
  });

  test("dua blok, satu rusak satu valid", () => {
    const md = [
      "```mermaid",
      "flowchart LR",
      "A-->B",
      "```",
      "",
      "```mermaid",
      "nope",
      "```"
    ].join("\n");
    const problems = checkMermaid("f.md", lines(md));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("nope");
  });

  test("dokumen tanpa mermaid tidak menghasilkan temuan", () => {
    expect(checkMermaid("f.md", lines("# Judul\n\nteks biasa"))).toEqual([]);
  });
});

describe("slugify / headingSlugs", () => {
  test("slugify gaya GitHub", () => {
    expect(slugify("Arsitektur Tingkat Tinggi")).toBe(
      "arsitektur-tingkat-tinggi"
    );
    expect(slugify("Tata kelola & komunitas")).toBe("tata-kelola--komunitas");
    expect(slugify("RLS (ADR-0003)")).toBe("rls-adr-0003");
  });

  test("headingSlugs mengumpulkan semua level heading", () => {
    const md = "# Satu\n\n## Dua Tiga\n\n### Empat\n\nbukan heading";
    const slugs = headingSlugs(md);
    expect(slugs.has("satu")).toBe(true);
    expect(slugs.has("dua-tiga")).toBe(true);
    expect(slugs.has("empat")).toBe(true);
    expect(slugs.has("bukan-heading")).toBe(false);
  });

  test("heading dengan tanda baca ter-slug benar", () => {
    expect(headingSlugs("## Keamanan").has("keamanan")).toBe(true);
  });
});

describe("checkNaming", () => {
  test("mendeteksi sisa penamaan awcms_mini_ / AWCMS_MINI_ (belum diadaptasi ke awcms_/AWCMS_)", () => {
    const md = "tabel `awcms_mini_tenants` dan env `AWCMS_MINI_NODE_ID`";
    const problems = checkNaming("f.md", lines(md));
    expect(problems).toHaveLength(1); // satu baris, satu temuan
    expect(problems[0]?.line).toBe(1);
  });

  test("mendeteksi varian hyphen-lalu-underscore (awcms-mini_x)", () => {
    const md = "baris1\nbaris2 `awcms-mini_offices`\nbaris3";
    const problems = checkNaming("f.md", lines(md));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.line).toBe(2);
  });

  test("tidak menandai penamaan repo ini yang benar (awcms_/AWCMS_)", () => {
    const md =
      "`awcms_tenants`, `AWCMS_SYNC_ENABLED`, skill `awcms-new-migration`";
    expect(checkNaming("f.md", lines(md))).toEqual([]);
  });

  test("nama skill/paket/path kebab-case (awcms-mini-..., docs/awcms-mini/) tidak salah tangkap", () => {
    const md =
      "lihat `awcms-mini-new-migration` dan `docs/awcms-mini/README.md`, atau sebutan bare `awcms-mini`";
    expect(checkNaming("f.md", lines(md))).toEqual([]);
  });

  test("exemption berbasis konten (file::identifier) tidak dilaporkan, di baris mana pun", () => {
    const exemptKey = Array.from(NAMING_EXEMPTIONS)[0];
    if (!exemptKey) throw new Error("NAMING_EXEMPTIONS kosong");
    const [file, identifier] = exemptKey.split("::");
    if (!file || !identifier) throw new Error("format exemption tak terduga");
    // Identifier ter-exempt boleh muncul di baris mana pun — tidak lagi
    // dikunci nomor baris. Sisipkan di baris ke-3 (bukan baris tertentu)
    // untuk membuktikan kekebalan terhadap pergeseran baris.
    const md = [
      "baris1",
      "baris2",
      `referensi historis \`${identifier}\``
    ].join("\n");
    expect(checkNaming(file, lines(md))).toEqual([]);
  });

  test("identifier ter-exempt di SATU file tidak meng-exempt file lain", () => {
    const exemptKey = Array.from(NAMING_EXEMPTIONS)[0];
    if (!exemptKey) throw new Error("NAMING_EXEMPTIONS kosong");
    const identifier = exemptKey.split("::")[1];
    if (!identifier) throw new Error("format exemption tak terduga");
    const problems = checkNaming(
      "file-lain.md",
      lines(`teks \`${identifier}\``)
    );
    expect(problems).toHaveLength(1);
  });

  test("prefix AWCMS_MINI_ telanjang (tanpa suffix) tidak ditandai", () => {
    const md = "sebutan sejarah `AWCMS_MINI_` tanpa suffix apa pun";
    expect(checkNaming("f.md", lines(md))).toEqual([]);
  });
});

describe("checkKnownScripts", () => {
  const known = new Set(["check", "db:migrate", "api:spec:check"]);

  test("melaporkan rujukan bun run yang tidak ada di package.json", () => {
    const md = "Jalankan `bun run repo:inventory:check` sebelum PR.";
    const problems = checkKnownScripts("README.md", lines(md), known);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.line).toBe(1);
    expect(problems[0]?.message).toContain("repo:inventory:check");
  });

  test("membiarkan rujukan bun run yang terdaftar", () => {
    const md = "Validasi dengan `bun run check` dan `bun run db:migrate`.";
    expect(checkKnownScripts("AGENTS.md", lines(md), known)).toEqual([]);
  });

  test("mendeteksi beberapa rujukan pada satu baris", () => {
    const md = "`bun run ghost:one` lalu `bun run ghost:two`.";
    const problems = checkKnownScripts("README.md", lines(md), known);
    expect(problems).toHaveLength(2);
  });

  test("daftar berkas current-state berisi README dan AGENTS", () => {
    expect(AUTHORITATIVE_SCRIPT_DOC_FILES.has("README.md")).toBe(true);
    expect(AUTHORITATIVE_SCRIPT_DOC_FILES.has("AGENTS.md")).toBe(true);
    expect(AUTHORITATIVE_SCRIPT_DOC_FILES.has("docs/awcms/README.md")).toBe(
      false
    );
  });
});

describe("checkSqlMigrationReferences", () => {
  // Isi `sql/` tiruan: hanya 001, 014, 017 (bernama penuh) yang "ada".
  const sqlFiles = new Set([
    "001_awcms_foundation_schema.sql",
    "014_awcms_email_schema.sql",
    "017_awcms_enforce_rls_force.sql"
  ]);

  test("melaporkan rujukan nomor hantu (sql/020 tak ada)", () => {
    const md = "INSERT ke `awcms_email_messages` (`sql/020`) di transaksi.";
    const problems = checkSqlMigrationReferences(
      ".claude/skills/x/SKILL.md",
      lines(md),
      sqlFiles
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.line).toBe(1);
    expect(problems[0]?.message).toContain("sql/020");
  });

  test("melaporkan nama berkas penuh hantu (nomor ada, nama beda/mini)", () => {
    // 014 ADA tapi dengan nama email; nama tenant-domain di 014 = hantu.
    const md = "lihat `sql/014_awcms_tenant_domain_permissions.sql`";
    const problems = checkSqlMigrationReferences(
      "docs/x.md",
      lines(md),
      sqlFiles
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain(
      "sql/014_awcms_tenant_domain_permissions.sql"
    );
  });

  test("membiarkan rujukan nomor yang ADA (sql/014)", () => {
    const md = "seed di `sql/014` sudah benar.";
    expect(
      checkSqlMigrationReferences("docs/x.md", lines(md), sqlFiles)
    ).toEqual([]);
  });

  test("membiarkan nama berkas penuh yang PERSIS ada", () => {
    const md = "diperbaiki `sql/017_awcms_enforce_rls_force.sql`.";
    expect(
      checkSqlMigrationReferences("docs/x.md", lines(md), sqlFiles)
    ).toEqual([]);
  });

  test("mengabaikan tanda baca kalimat setelah nama berkas (.sql. di akhir)", () => {
    const md = "diperbaiki `sql/017_awcms_enforce_rls_force.sql`.";
    // titik penutup kalimat tidak boleh menurunkan kelas jadi cek-nomor.
    expect(
      checkSqlMigrationReferences(
        "docs/x.md",
        lines(md.replace("`.", ".")),
        sqlFiles
      )
    ).toEqual([]);
  });

  test("penanda file-level `sql-refs: awcms-mini` mematikan cek untuk seluruh berkas", () => {
    const md = [
      "<!-- sql-refs: awcms-mini — modul belum di-port -->",
      "tabel di `sql/053_awcms_social_publishing_schema.sql` dan `sql/999`."
    ].join("\n");
    expect(
      checkSqlMigrationReferences(
        ".claude/skills/x/SKILL.md",
        lines(md),
        sqlFiles
      )
    ).toEqual([]);
  });

  test("berkas di SQL_REF_UNCHECKED_FILES dilewati sepenuhnya", () => {
    const unchecked = Array.from(SQL_REF_UNCHECKED_FILES)[0];
    if (!unchecked) throw new Error("SQL_REF_UNCHECKED_FILES kosong");
    const md = "rujukan `sql/033` dan `sql/999_hantu.sql`.";
    expect(checkSqlMigrationReferences(unchecked, lines(md), sqlFiles)).toEqual(
      []
    );
  });

  test("beberapa rujukan hantu pada baris berbeda dilaporkan masing-masing", () => {
    const md =
      "baris `sql/031`\nlain `sql/066_awcms_document_infrastructure_schema.sql`";
    const problems = checkSqlMigrationReferences(
      "docs/x.md",
      lines(md),
      sqlFiles
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]?.line).toBe(1);
    expect(problems[1]?.line).toBe(2);
  });
});

describe("extractLinks", () => {
  test("mengekstrak target dan nomor baris", () => {
    const md = "teks [a](./x.md) lalu\n[b](../y.md#sec)";
    const links = extractLinks(md);
    expect(links.map((l) => l.target)).toEqual(["./x.md", "../y.md#sec"]);
    expect(links[0]?.line).toBe(1);
    expect(links[1]?.line).toBe(2);
  });

  test("membersihkan pembungkus sudut <...>", () => {
    const links = extractLinks("[x](<https://a.b/c d>)");
    expect(links[0]?.target).toBe("https://a.b/c d");
  });

  test("dokumen tanpa tautan menghasilkan array kosong", () => {
    expect(extractLinks("tanpa tautan sama sekali")).toEqual([]);
  });
});

describe("classifyLink", () => {
  test("klasifikasi tipe tautan", () => {
    expect(classifyLink("https://example.com")).toBe("external");
    expect(classifyLink("mailto:a@b.c")).toBe("external");
    expect(classifyLink("#bagian")).toBe("anchor");
    expect(classifyLink("./doc.md")).toBe("relative");
    expect(classifyLink("../adr/README.md#x")).toBe("relative");
    expect(classifyLink("")).toBe("empty");
  });
});

describe("splitTarget", () => {
  test("memisahkan path dan anchor", () => {
    expect(splitTarget("./a/b.md#bagian")).toEqual({
      path: "./a/b.md",
      hash: "bagian"
    });
    expect(splitTarget("./a/b.md")).toEqual({
      path: "./a/b.md",
      hash: undefined
    });
  });
});

describe("parseComposeServiceNames", () => {
  test("mengekstrak service dari blok services: saja", () => {
    const yaml = [
      "services:",
      "  db:",
      "    image: postgres:18.4",
      "  app:",
      "    build: .",
      "volumes:",
      "  awcms-db-data:",
      "networks:",
      "  default:"
    ].join("\n");
    expect(parseComposeServiceNames(yaml)).toEqual(new Set(["db", "app"]));
  });

  test("tidak salah tangkap key top-level lain sebagai service", () => {
    const yaml = ["volumes:", "  db-data:", "services:", "  app:"].join("\n");
    expect(parseComposeServiceNames(yaml)).toEqual(new Set(["app"]));
  });
});

describe("checkComposeServiceNames", () => {
  const services = new Set(["db", "app", "pgbouncer"]);

  test("service benar (fenced block) tidak menghasilkan temuan", () => {
    const md = ["```bash", "docker compose up -d db", "```"].join("\n");
    expect(checkComposeServiceNames("f.md", md, services)).toEqual([]);
  });

  test("service salah dilaporkan dengan nomor baris", () => {
    const md = ["```bash", "docker compose up -d postgres", "```"].join("\n");
    const problems = checkComposeServiceNames("f.md", md, services);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.line).toBe(2);
    expect(problems[0]?.message).toContain("postgres");
  });

  test("baris komentar penuh (# di awal) tetap divalidasi", () => {
    const md = ["```bash", "# docker compose up -d postgres", "```"].join("\n");
    const problems = checkComposeServiceNames("f.md", md, services);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("postgres");
  });

  test("komentar shell trailing di akhir baris diabaikan (bukan argumen)", () => {
    const md = [
      "```bash",
      "docker compose up --build           # app + db saja",
      "```"
    ].join("\n");
    expect(checkComposeServiceNames("f.md", md, services)).toEqual([]);
  });

  test("exec/run: hanya token pertama divalidasi sebagai service", () => {
    const ok = "`docker compose exec -T app bun run email:dispatch`";
    expect(checkComposeServiceNames("f.md", ok, services)).toEqual([]);

    const bad = "`docker compose exec -T postgres bun run email:dispatch`";
    const problems = checkComposeServiceNames("f.md", bad, services);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("postgres");
  });

  test("subcommand tanpa semantik service (config) tidak divalidasi", () => {
    const md = "bukan hanya `docker compose config`: catatan lain di sini";
    expect(checkComposeServiceNames("f.md", md, services)).toEqual([]);
  });

  test("prosa narasi setelah span kode pada baris yang sama tidak ikut tertelan", () => {
    const md =
      "diverifikasi lewat `docker compose config` di atas issue ini adalah backlog";
    expect(checkComposeServiceNames("f.md", md, services)).toEqual([]);
  });

  test("dokumen tanpa docker compose menghasilkan array kosong", () => {
    expect(
      checkComposeServiceNames("f.md", "teks biasa saja", services)
    ).toEqual([]);
  });

  test("logs -f: -f berarti --follow (boolean), bukan file value — service sesudahnya tetap divalidasi", () => {
    const ok = "`docker compose logs -f app`";
    expect(checkComposeServiceNames("f.md", ok, services)).toEqual([]);

    const bad = "`docker compose logs -f totallyfakeservice`";
    const problems = checkComposeServiceNames("f.md", bad, services);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("totallyfakeservice");
  });

  test("build --env-file: -f override tetap khusus subcommand logs, tidak bocor ke subcommand lain", () => {
    const md = "`docker compose build --env-file .env.ci app`";
    expect(checkComposeServiceNames("f.md", md, services)).toEqual([]);
  });
});
