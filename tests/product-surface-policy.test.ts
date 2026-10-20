/**
 * ADR-0146: persona apps prefer Lynx in their own consumer repos; every admin
 * and every public web surface stays Astro.
 *
 * ## Why this is a test and not a sentence
 *
 * The rule has to survive a well-meant PR. The realistic way it erodes is not a
 * hostile one; it is an `@lynx-js/react` added to this repo's `package.json` for
 * a quick prototype, or an admin screen "modernised" because it can be installed
 * on a phone. A paragraph in `AGENTS.md` is read by whoever reads it; this file
 * is read by CI.
 *
 * ## Three jobs, and one thing it refuses to be
 *
 * 1. **Pin the seven scenarios** of Issue #1133 to the classification the ADR
 *    states, three ways round: the test's own table, the classifier in
 *    `scripts/lib/product-surface-policy.ts`, and the ADR's scenario table.
 * 2. **Parity**: the ADR's §1 decision table (English source AND its Indonesian
 *    mirror) must agree with the policy module row for row. Neither side can be
 *    edited alone; the failure names the row and the cell.
 * 3. **Structural gate**: Lynx must not enter THIS repository (the system of
 *    record) as a dependency, an import under `src/`, or a `lynx.config.*`.
 *
 * It is deliberately NOT a word detector. The ADR, `AGENTS.md` and the skills
 * must be free to discuss Lynx; scanning prose for the word would punish the
 * documentation this decision asks for and still miss a dependency spelled
 * differently. The gate reads dependency, import and build-config STRUCTURE.
 *
 * Every assertion below has been proven able to fail: the pure detectors are fed
 * the defect they exist to catch, and the repo-level scans were mutated and
 * observed red before this file was committed (the evidence is in the PR).
 *
 * No database, no network.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { parseInventoryRows } from "../scripts/lib/markdown-table";
import {
  LYNX_GATE_REMEDY,
  SURFACE_KINDS,
  SURFACE_POLICIES,
  UnclassifiedSurfaceError,
  classifySurface,
  findLynxImports,
  findLynxPackageReferences,
  isLynxConfigFile,
  type ScenarioDescriptor,
  type SurfaceKind
} from "../scripts/lib/product-surface-policy";
import { listFilesRecursive } from "../scripts/lib/repo-files";

const REPO_ROOT = process.cwd();

const ADR_BASENAME =
  "0146-persona-apps-prefer-lynx-in-consumer-repos-astro-keeps-admin-and-public-web";
const ADR_EN = path.join(REPO_ROOT, "docs/adr", `${ADR_BASENAME}.md`);
const ADR_ID = path.join(REPO_ROOT, "docs/adr", `${ADR_BASENAME}.id.md`);

/** Fail with ONE readable message listing every problem, rather than the first. */
function expectNoProblems(problems: string[], header: string): void {
  if (problems.length === 0) return;
  throw new Error(`${header}\n  - ${problems.join("\n  - ")}`);
}

/* -------------------------------------------------------------------------- */
/*  1. The seven scenarios                                                     */
/* -------------------------------------------------------------------------- */

const base: ScenarioDescriptor = {
  managesSystem: false,
  managesOwnPartOfSite: false,
  publicSeo: false,
  personaWorkflow: false,
  channel: "browser"
};

/**
 * Issue #1133's list, by its own numbering. Each scenario is one or more
 * SURFACES, because scenario 1 is genuinely three: a native customer app, a
 * private web app, and the catalogue that must stay crawlable. Its heading says
 * "five scenarios" while it lists seven; the list is the authority.
 */
const SCENARIOS: readonly {
  readonly id: number;
  readonly title: string;
  readonly surfaces: readonly {
    readonly name: string;
    readonly descriptor: ScenarioDescriptor;
    readonly expected: SurfaceKind;
  }[];
}[] = [
  {
    id: 1,
    title: "Customer app on Android/iOS and a private web app",
    surfaces: [
      {
        name: "customer native app",
        descriptor: { ...base, personaWorkflow: true, channel: "native-app" },
        expected: "persona-app-native"
      },
      {
        name: "private customer web app",
        descriptor: { ...base, personaWorkflow: true, channel: "browser" },
        expected: "persona-app-web"
      },
      {
        name: "SEO catalogue",
        descriptor: { ...base, publicSeo: true },
        expected: "public-web"
      }
    ]
  },
  {
    id: 2,
    title: "Driver app with location and notifications",
    surfaces: [
      {
        name: "driver app",
        descriptor: { ...base, personaWorkflow: true, channel: "native-app" },
        expected: "persona-app-native"
      }
    ]
  },
  {
    id: 3,
    title: "Courier app with proof of delivery and camera",
    surfaces: [
      {
        name: "courier app",
        descriptor: { ...base, personaWorkflow: true, channel: "native-app" },
        expected: "persona-app-native"
      }
    ]
  },
  {
    id: 4,
    title: "Partner or agent app with orders and commission",
    surfaces: [
      {
        name: "partner app",
        descriptor: { ...base, personaWorkflow: true, channel: "native-app" },
        expected: "persona-app-native"
      }
    ]
  },
  {
    id: 5,
    title: "Warehouse or field staff app: barcode scanning and sync",
    surfaces: [
      {
        name: "warehouse app",
        descriptor: { ...base, personaWorkflow: true, channel: "native-app" },
        expected: "persona-app-native"
      }
    ]
  },
  {
    id: 6,
    title: "Managing modules, users, permissions, audit and tenants",
    surfaces: [
      {
        name: "system administration",
        descriptor: { ...base, managesSystem: true },
        expected: "system-admin"
      }
    ]
  },
  {
    id: 7,
    title: "News, blog and landing portal",
    surfaces: [
      {
        name: "public portal",
        descriptor: { ...base, publicSeo: true },
        expected: "public-web"
      }
    ]
  }
];

describe("ADR-0146 §4: the seven scenarios classify as the issue says", () => {
  test("there are exactly seven, numbered 1..7", () => {
    expect(SCENARIOS.map((scenario) => scenario.id)).toEqual([
      1, 2, 3, 4, 5, 6, 7
    ]);
  });

  for (const scenario of SCENARIOS) {
    for (const surface of scenario.surfaces) {
      test(`scenario ${scenario.id} (${surface.name}) -> ${surface.expected}`, () => {
        expect(classifySurface(surface.descriptor)).toBe(surface.expected);
      });
    }
  }
});

describe("ADR-0146 §1: 'app' is defined by function, not URL, device or installability", () => {
  test("an installable admin is pwa-admin, not a persona app", () => {
    expect(
      classifySurface({ ...base, managesSystem: true, installable: true })
    ).toBe("pwa-admin");
    expect(
      classifySurface({
        ...base,
        managesOwnPartOfSite: true,
        installable: true
      })
    ).toBe("pwa-admin");
  });

  test("an admin reached through a native wrapper is still an admin", () => {
    expect(
      classifySurface({
        ...base,
        managesSystem: true,
        personaWorkflow: true,
        channel: "native-app"
      })
    ).toBe("system-admin");
  });

  test("a user admin is user-admin", () => {
    expect(classifySurface({ ...base, managesOwnPartOfSite: true })).toBe(
      "user-admin"
    );
  });

  test("installability does not turn a public page into a persona app", () => {
    expect(
      classifySurface({ ...base, publicSeo: true, installable: true })
    ).toBe("public-web");
  });

  test("a surface that is nothing decided is rejected, not guessed", () => {
    expect(() => classifySurface(base)).toThrow(UnclassifiedSurfaceError);
    expect(() => classifySurface({ ...base, installable: true })).toThrow(
      UnclassifiedSurfaceError
    );
  });
});

describe("ADR-0146 §1: the policy data itself", () => {
  test("six kinds, unique, and every row keyed by its own kind", () => {
    expect(SURFACE_KINDS.length).toBe(6);
    expect(new Set(SURFACE_KINDS).size).toBe(6);
    for (const kind of SURFACE_KINDS) {
      expect(SURFACE_POLICIES[kind].kind).toBe(kind);
    }
  });

  test("every admin and public kind is Astro; only persona kinds name Lynx", () => {
    for (const kind of [
      "system-admin",
      "user-admin",
      "public-web",
      "pwa-admin"
    ] as const) {
      expect(SURFACE_POLICIES[kind].technology.startsWith("Astro")).toBe(true);
      expect(SURFACE_POLICIES[kind].technology.toLowerCase()).not.toContain(
        "lynx"
      );
      expect(SURFACE_POLICIES[kind].requiresLynxPoc).toBe(false);
    }
    for (const kind of ["persona-app-native", "persona-app-web"] as const) {
      expect(SURFACE_POLICIES[kind].technology).toContain("Lynx");
      expect(SURFACE_POLICIES[kind].requiresLynxPoc).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  2. Parity with the ADR                                                     */
/* -------------------------------------------------------------------------- */

/** Contiguous runs of table lines, each as parsed rows (header first). */
function tablesOf(markdown: string): string[][][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of markdown.split("\n")) {
    if (line.trim().startsWith("|")) {
      current.push(line);
    } else if (current.length > 0) {
      blocks.push(current);
      current = [];
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks.map((block) => parseInventoryRows(block.join("\n")));
}

/** `` `a`, `b` `` -> ["a", "b"]. */
function backticked(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");
}

function stripTicks(cell: string): string {
  return cell.replace(/`/g, "").trim();
}

/** The ADR §1 table: the one whose body rows carry a backticked kind id in column 2. */
function decisionTable(markdown: string): string[][] | undefined {
  return tablesOf(markdown).find((rows) =>
    rows.slice(1).some((row) => /^`[a-z-]+`$/.test(row[1] ?? ""))
  );
}

/** The ADR §4 table: body rows start with a bare number. */
function scenarioTable(markdown: string): string[][] | undefined {
  return tablesOf(markdown).find((rows) =>
    rows.slice(1).some((row) => /^\d+$/.test(row[0] ?? ""))
  );
}

/**
 * Compare a decision table against the policy module. `checkRule` is true only
 * for the English source: the Indonesian mirror translates the rule text, but
 * kind ids, technology names and repos are proper nouns that must match.
 */
function decisionTableProblems(
  rows: string[][] | undefined,
  label: string,
  checkRule: boolean
): string[] {
  if (!rows) return [`${label}: no §1 decision table found`];

  const problems: string[] = [];
  const body = rows.slice(1);
  const ids = body.map((row) => stripTicks(row[1] ?? ""));

  if (JSON.stringify(ids) !== JSON.stringify([...SURFACE_KINDS])) {
    problems.push(
      `${label}: kind ids [${ids.join(", ")}] != SURFACE_KINDS [${SURFACE_KINDS.join(", ")}]`
    );
  }

  for (const row of body) {
    const id = stripTicks(row[1] ?? "") as SurfaceKind;
    const policy = SURFACE_POLICIES[id];
    if (!policy) continue;

    const technology = (row[2] ?? "").trim();
    const home = (row[3] ?? "").trim();
    const rule = (row[4] ?? "").trim();

    if (technology !== policy.technology) {
      problems.push(
        `${label}: row ${id}: technology "${technology}" != module "${policy.technology}"`
      );
    }
    if (home !== policy.homeRepo) {
      problems.push(
        `${label}: row ${id}: home "${home}" != module "${policy.homeRepo}"`
      );
    }
    if (checkRule && rule !== policy.rule) {
      problems.push(
        `${label}: row ${id}: rule "${rule}" != module "${policy.rule}"`
      );
    }
  }

  return problems;
}

function scenarioTableProblems(
  rows: string[][] | undefined,
  label: string
): string[] {
  if (!rows) return [`${label}: no §4 scenario table found`];

  const problems: string[] = [];
  const byId = new Map(
    rows.slice(1).map((row) => [Number(row[0]), backticked(row[2] ?? "")])
  );

  for (const scenario of SCENARIOS) {
    const expected = scenario.surfaces.map((surface) => surface.expected);
    const actual = byId.get(scenario.id);
    if (!actual) {
      problems.push(`${label}: scenario ${scenario.id} is missing`);
      continue;
    }
    // Same MEMBERS regardless of order: the ADR lists them as prose reads.
    if (
      JSON.stringify([...actual].sort()) !==
      JSON.stringify([...expected].sort())
    ) {
      problems.push(
        `${label}: scenario ${scenario.id} classifies as [${actual.join(", ")}], the classifier says [${expected.join(", ")}]`
      );
    }
  }

  if (byId.size !== SCENARIOS.length) {
    problems.push(
      `${label}: ${byId.size} scenarios listed, expected ${SCENARIOS.length}`
    );
  }

  return problems;
}

describe("ADR-0146 parity: the decision table and the module cannot drift", () => {
  test("the ADR and its Indonesian mirror both exist (non-vacuous)", () => {
    expect(existsSync(ADR_EN)).toBe(true);
    expect(existsSync(ADR_ID)).toBe(true);
  });

  test("English §1 table matches the module row for row (kind, technology, home, rule)", () => {
    const rows = decisionTable(readFileSync(ADR_EN, "utf8"));
    expectNoProblems(
      decisionTableProblems(rows, "ADR-0146 (en)", true),
      "ADR-0146 §1 and scripts/lib/product-surface-policy.ts disagree. Edit both together:"
    );
  });

  test("Indonesian mirror §1 table matches kind ids, technology and home", () => {
    const rows = decisionTable(readFileSync(ADR_ID, "utf8"));
    expectNoProblems(
      decisionTableProblems(rows, "ADR-0146 (id)", false),
      "The Indonesian mirror of ADR-0146 §1 disagrees with the module:"
    );
  });

  test("English and Indonesian scenario tables classify like the classifier", () => {
    expectNoProblems(
      [
        ...scenarioTableProblems(
          scenarioTable(readFileSync(ADR_EN, "utf8")),
          "ADR-0146 (en)"
        ),
        ...scenarioTableProblems(
          scenarioTable(readFileSync(ADR_ID, "utf8")),
          "ADR-0146 (id)"
        )
      ],
      "ADR-0146 §4 scenario table disagrees with the classifier:"
    );
  });

  // Mutation proof: the parity check must be able to fail, on each cell it reads.
  describe("the parity check can fail", () => {
    // A synthetic table built from the module itself: it agrees by construction,
    // so each test below mutates exactly one cell and expects exactly that cell
    // to be reported. It does not depend on the wording of the real ADR.
    const syntheticDecisionRows = (): string[][] => [
      ["Surface", "Kind id", "Technology", "Home", "Rule"],
      ...SURFACE_KINDS.map((kind) => [
        kind,
        `\`${kind}\``,
        SURFACE_POLICIES[kind].technology,
        SURFACE_POLICIES[kind].homeRepo,
        SURFACE_POLICIES[kind].rule
      ])
    ];

    const syntheticScenarioRows = (): string[][] => [
      ["#", "Scenario", "Classification"],
      ...SCENARIOS.map((scenario) => [
        String(scenario.id),
        scenario.title,
        scenario.surfaces.map((surface) => `\`${surface.expected}\``).join(", ")
      ])
    ];

    const withCell = (
      rows: string[][],
      kind: SurfaceKind,
      column: number,
      value: string
    ): string[][] =>
      rows.map((row) =>
        row[1] === `\`${kind}\``
          ? row.map((cell, i) => (i === column ? value : cell))
          : row
      );

    test("an unmutated table reports nothing (the check can pass)", () => {
      expect(decisionTableProblems(syntheticDecisionRows(), "s", true)).toEqual(
        []
      );
      expect(scenarioTableProblems(syntheticScenarioRows(), "s")).toEqual([]);
    });

    test("a changed technology cell is reported by row", () => {
      const problems = decisionTableProblems(
        withCell(
          syntheticDecisionRows(),
          "system-admin",
          2,
          "LynxJS + ReactLynx"
        ),
        "s",
        true
      );
      expect(
        problems.some((p) => p.includes("row system-admin: technology"))
      ).toBe(true);
    });

    test("a changed home cell is reported by row", () => {
      const problems = decisionTableProblems(
        withCell(
          syntheticDecisionRows(),
          "user-admin",
          3,
          "ahliweb/awcms-lynx"
        ),
        "s",
        true
      );
      expect(problems.some((p) => p.includes("row user-admin: home"))).toBe(
        true
      );
    });

    test("a changed rule cell is reported by row, but only for the source language", () => {
      const rows = withCell(
        syntheticDecisionRows(),
        "pwa-admin",
        4,
        "A PWA may be replaced by Lynx."
      );
      expect(
        decisionTableProblems(rows, "s", true).some((p) =>
          p.includes("row pwa-admin: rule")
        )
      ).toBe(true);
      // The Indonesian mirror translates the rule, so it is not compared.
      expect(decisionTableProblems(rows, "s", false)).toEqual([]);
    });

    test("a renamed kind is reported", () => {
      const rows = syntheticDecisionRows().map((row) =>
        row[1] === "`pwa-admin`"
          ? [row[0] ?? "", "`pwa-lynx`", ...row.slice(2)]
          : row
      );
      expect(
        decisionTableProblems(rows, "s", true).some((p) =>
          p.includes("kind ids")
        )
      ).toBe(true);
    });

    test("a missing table is reported, not skipped", () => {
      expect(decisionTableProblems(undefined, "s", true)).not.toEqual([]);
      expect(scenarioTableProblems(undefined, "s")).not.toEqual([]);
    });

    test("a scenario reclassified is reported by number", () => {
      const rows = syntheticScenarioRows().map((row) =>
        row[0] === "6" ? [row[0], row[1] ?? "", "`persona-app-native`"] : row
      );
      expect(
        scenarioTableProblems(rows, "s").some((p) => p.includes("scenario 6"))
      ).toBe(true);
    });

    test("a dropped scenario is reported", () => {
      const rows = syntheticScenarioRows().filter((row) => row[0] !== "3");
      expect(
        scenarioTableProblems(rows, "s").some((p) => p.includes("scenario 3"))
      ).toBe(true);
    });
  });
});

/* -------------------------------------------------------------------------- */
/*  3. The structural gate                                                     */
/* -------------------------------------------------------------------------- */

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".astro"
] as const;

/** Directories no file of ours lives in, by NAME at any depth. */
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", ".git", ".astro"]);

/** The one path-shaped exclusion: other sessions' full checkouts live here. */
const WORKTREES = path.join(".claude", "worktrees");

/** Every repo-relative file path, skipping vendored/built trees and worktrees. */
function listRepoFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name) || relative === WORKTREES)
          continue;
        walk(absolute);
      } else if (entry.isFile()) {
        found.push(relative.split(path.sep).join("/"));
      }
    }
  };
  walk(root);
  return found;
}

function packageJsonProblems(packageJson: unknown): string[] {
  return findLynxPackageReferences(packageJson).map(
    (reference) => `package.json declares a Lynx package at ${reference}`
  );
}

function srcImportProblems(
  files: readonly { readonly file: string; readonly source: string }[]
): string[] {
  return files.flatMap(({ file, source }) =>
    findLynxImports(source).map(
      (specifier) => `${file} imports from "${specifier}"`
    )
  );
}

function configFileProblems(relativePaths: readonly string[]): string[] {
  return relativePaths
    .filter(isLynxConfigFile)
    .map((relative) => `${relative} is a Lynx build config`);
}

describe("ADR-0146 §7: Lynx stays out of the system of record", () => {
  test("package.json declares no @lynx-js/* package in any section", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
    ) as unknown;
    expectNoProblems(packageJsonProblems(packageJson), LYNX_GATE_REMEDY);
  });

  test("no file under src/ imports from @lynx-js/", () => {
    const sourceRoot = path.join(REPO_ROOT, "src");
    const files = listFilesRecursive(sourceRoot, {
      extensions: SOURCE_EXTENSIONS,
      skipDirectories: [...SKIP_DIRECTORIES]
    });
    // Non-vacuous: if src/ ever stops being found, an empty scan would be green
    // for the wrong reason.
    expect(files.length).toBeGreaterThan(100);

    expectNoProblems(
      srcImportProblems(
        files.map((absolute) => ({
          file: path.relative(REPO_ROOT, absolute),
          source: readFileSync(absolute, "utf8")
        }))
      ),
      LYNX_GATE_REMEDY
    );
  });

  test("no lynx.config.* exists anywhere in the repository", () => {
    const files = listRepoFiles(REPO_ROOT);
    expect(files.length).toBeGreaterThan(1000);
    expect(files).toContain("package.json");
    expectNoProblems(configFileProblems(files), LYNX_GATE_REMEDY);
  });

  test("the failure message names the ADR, the consumer repo and the superseding ADR", () => {
    expect(LYNX_GATE_REMEDY).toContain("ADR-0146");
    expect(LYNX_GATE_REMEDY).toContain("CONSUMER repo");
    expect(LYNX_GATE_REMEDY).toContain("superseding ADR");
  });

  // Mutation proof for the detectors: each is fed the defect it exists to catch.
  describe("the detectors can fail", () => {
    test("a Lynx package in ANY package.json section is found", () => {
      for (const section of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
        "overrides",
        "resolutions"
      ]) {
        const problems = packageJsonProblems({
          name: "awcms",
          [section]: { "@lynx-js/react": "^0.100.0" }
        });
        expect(problems.length).toBeGreaterThan(0);
        expect(problems[0]).toContain(section);
      }
    });

    test("the build tool and an npm: alias are found, a clean file is not", () => {
      expect(
        packageJsonProblems({
          devDependencies: { "@lynx-js/rspeedy": "1.0.0" }
        }).length
      ).toBe(1);
      expect(
        packageJsonProblems({ dependencies: { alias: "npm:@lynx-js/react@3" } })
          .length
      ).toBe(1);
      expect(
        packageJsonProblems({
          name: "awcms",
          dependencies: { astro: "7.4.0" },
          scripts: { check: "bun run lint" }
        })
      ).toEqual([]);
    });

    test("every import syntax from @lynx-js/ is found", () => {
      for (const source of [
        `import { root } from "@lynx-js/react";`,
        `import "@lynx-js/react/jsx-runtime";`,
        `const m = await import("@lynx-js/react");`,
        `const m = require('@lynx-js/rspeedy');`,
        `export { x } from "@lynx-js/react";`
      ]) {
        expect(srcImportProblems([{ file: "src/x.ts", source }]).length).toBe(
          1
        );
      }
    });

    test("prose that merely mentions the package is not an import", () => {
      expect(
        srcImportProblems([
          {
            file: "src/x.ts",
            source:
              "// ADR-0146 forbids @lynx-js/react here.\nconst note = 'see @lynx-js/react docs';\nimport { a } from 'astro';"
          }
        ])
      ).toEqual([]);
    });

    test("lynx.config.* is found at any depth and in any extension; lookalikes are not", () => {
      for (const file of [
        "lynx.config.ts",
        "lynx.config.js",
        "lynx.config.mjs",
        "apps/driver/lynx.config.ts"
      ]) {
        expect(configFileProblems([file]).length).toBe(1);
      }
      for (const file of [
        "docs/lynx.md",
        "src/lynx-notes.ts",
        "lynx.configuration.ts",
        "mylynx.config.ts"
      ]) {
        expect(configFileProblems([file])).toEqual([]);
      }
    });
  });
});
