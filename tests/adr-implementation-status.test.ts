/**
 * An ADR's `Status` line must agree with the filesystem it makes promises about.
 *
 * ## The gap this closes (C12, `docs/awcms/standar-performa-dan-keamanan.md` §9)
 *
 * Six ADRs — 0016, 0017, 0018, 0019, 0020, 0021 — are `Accepted` for artifacts
 * with no code in this repository: five module admissions whose modules were
 * never built here, and one contract family (ADR-0020) whose `_shared` files
 * were deleted along with the derived-application pathway (ADR-0034). The
 * assessment's demand was explicit: a gate binding ADR status to the existence
 * of the module/files, or a new status `Accepted (belum diimplementasikan)`.
 * This delivers BOTH: the six ADRs now carry the qualified status, and this
 * test enforces the binding in both directions.
 *
 * ## How it differs from `tests/adr-admission-implementation-status.test.ts`
 *
 * That gate binds a prose banner to `listModules()` membership, and only for
 * ADRs titled `Admission of \`module_key\``. It cannot see ADR-0020 (a contract
 * ADR, not a module admission) and it does not constrain the `Status` line at
 * all — an ADR could read `Accepted` forever. This gate is map-driven over the
 * PROMISED ARTIFACT PATHS themselves, so it covers file-contract ADRs too, and
 * it constrains the status line:
 *
 * - (a) artifacts absent  → status MUST be `Accepted (belum diimplementasikan)`;
 * - (b) artifacts present → status MUST be plain `Accepted` — landing the
 *   implementation forces the flip in the same PR;
 * - (c) a map entry naming an ADR file that does not exist fails — dead map
 *   entries are themselves failures, per this repo's gate-design convention;
 * - (d) the qualifier cannot be used off-map: any ADR carrying it must have a
 *   map entry, so the status can never float free of an artifact binding.
 *
 * The decision logic is a pure function over an injected snapshot and is
 * mutation-proven below: each direction has a test that feeds it the defect it
 * must catch. No database, no network — safe for `quality` on every PR.
 */
import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "bun:test";

/** The literal qualified status the six unimplemented ADRs carry today. */
const QUALIFIED_STATUS = "Accepted (belum diimplementasikan)";

/** The literal plain status an ADR must return to when its artifacts land. */
const PLAIN_STATUS = "Accepted";

const QUALIFIER = "(belum diimplementasikan)";

/** First `- **Status:** …` line of an ADR body. */
const STATUS_LINE = /^- \*\*Status:\*\* (.+?)\s*$/m;

const ADR_DIR = path.resolve(process.cwd(), "docs/adr");

/**
 * ADR → promised artifacts. Outer array: ALL groups must be satisfied for the
 * ADR to count as implemented. Inner array: alternate spellings, ANY of which
 * satisfies the group (module keys use underscores in ADR prose while module
 * directories in `src/modules/` are hyphenated — both are accepted so the gate
 * flips on the real landing, whichever spelling it uses).
 *
 * Artifact names are taken from each ADR's own text, not guessed:
 * - 0016 §1 admits `organization_structure` as a module;
 * - 0017 §1 admits `document_infrastructure` as a module;
 * - 0018 §1 admits `data_exchange` as a module;
 * - 0019 §1 admits `integration_hub` as a module;
 * - 0020 §3 places its contracts at `_shared/business-transaction-contract.ts`,
 *   `_shared/erp-reference-data-contract.ts`, `_shared/ports/period-lock-port.ts`;
 * - 0021 §1 admits `reference_data` as a module.
 */
const ADR_ARTIFACT_MAP: readonly {
  adrFile: string;
  artifacts: readonly (readonly string[])[];
}[] = [
  {
    adrFile: "0016-organization-structure-module-admission.md",
    artifacts: [
      [
        "src/modules/organization-structure",
        "src/modules/organization_structure"
      ]
    ]
  },
  {
    adrFile: "0017-document-infrastructure-module-admission.md",
    artifacts: [
      [
        "src/modules/document-infrastructure",
        "src/modules/document_infrastructure"
      ]
    ]
  },
  {
    adrFile: "0018-data-exchange-module-admission.md",
    artifacts: [["src/modules/data-exchange", "src/modules/data_exchange"]]
  },
  {
    adrFile: "0019-integration-hub-module-admission.md",
    artifacts: [["src/modules/integration-hub", "src/modules/integration_hub"]]
  },
  {
    adrFile: "0020-erp-extension-readiness-contracts.md",
    artifacts: [
      ["src/modules/_shared/business-transaction-contract.ts"],
      ["src/modules/_shared/erp-reference-data-contract.ts"],
      ["src/modules/_shared/ports/period-lock-port.ts"]
    ]
  },
  {
    adrFile: "0021-reference-data-module-admission.md",
    artifacts: [["src/modules/reference-data", "src/modules/reference_data"]]
  },
  {
    // ADR-0067 Opsi B — accepted 8 August 2026, not built. The promised
    // artifact is the aggregate itself: Opsi B's whole point is that a raw
    // per-visit row is never stored, so the domain file that does the
    // aggregation IS the decision made executable. Pointing this entry at the
    // endpoint or the migration instead would let a raw-row implementation
    // satisfy the gate.
    adrFile: "0067-core-web-vitals-collection.md",
    artifacts: [
      [
        "src/modules/visitor-analytics/domain/web-vitals-aggregate.ts",
        "src/modules/visitor-analytics/domain/web_vitals_aggregate.ts"
      ]
    ]
  }
];

/**
 * Filesystem snapshot the decision logic runs against. Injected so the same
 * logic is exercised live (real repo) and under mutation (synthetic states the
 * repo is not currently in — that is what makes both directions provable).
 */
interface Snapshot {
  /** ADR body by basename, or null when the file does not exist. */
  readAdr(adrFile: string): string | null;
  /** Whether a repo-relative artifact path exists. */
  artifactExists(relPath: string): boolean;
}

function extractStatus(body: string): string | null {
  const match = body.match(STATUS_LINE);
  return match?.[1] ?? null;
}

function collectOffenders(
  map: typeof ADR_ARTIFACT_MAP,
  snapshot: Snapshot
): string[] {
  const offenders: string[] = [];

  for (const entry of map) {
    const body = snapshot.readAdr(entry.adrFile);

    if (body === null) {
      offenders.push(
        `${entry.adrFile}: map entry points at an ADR file that does not ` +
          `exist — fix the filename or remove the entry.`
      );
      continue;
    }

    const status = extractStatus(body);

    if (status === null) {
      offenders.push(
        `${entry.adrFile}: no "- **Status:** …" line found — the gate cannot ` +
          `bind a status it cannot read.`
      );
      continue;
    }

    if (!status.startsWith(PLAIN_STATUS)) {
      offenders.push(
        `${entry.adrFile}: status "${status}" is no longer Accepted — this ` +
          `map entry is dead; remove it (and its artifacts binding) in the ` +
          `same change that superseded/deprecated the ADR.`
      );
      continue;
    }

    const satisfied = entry.artifacts.filter((alternates) =>
      alternates.some((relPath) => snapshot.artifactExists(relPath))
    ).length;
    const total = entry.artifacts.length;

    if (satisfied === 0) {
      if (status !== QUALIFIED_STATUS) {
        offenders.push(
          `${entry.adrFile}: none of its promised artifacts exist ` +
            `(${entry.artifacts.map((a) => a[0]).join(", ")}) but its status ` +
            `is "${status}" — an Accepted ADR with no code reads as a usable ` +
            `capability. Set it to exactly "${QUALIFIED_STATUS}", or land ` +
            `the artifacts.`
        );
      }
      continue;
    }

    if (satisfied < total) {
      offenders.push(
        `${entry.adrFile}: ${satisfied} of ${total} promised artifact groups ` +
          `exist — a partial landing. Land the rest (then set the status to ` +
          `plain "${PLAIN_STATUS}"), or remove the partial artifacts.`
      );
      continue;
    }

    if (status !== PLAIN_STATUS) {
      offenders.push(
        `${entry.adrFile}: ALL promised artifacts now exist but the status ` +
          `is still "${status}" — flip it to plain "${PLAIN_STATUS}" in the ` +
          `PR that landed the implementation.`
      );
    }
  }

  return offenders;
}

const liveSnapshot: Snapshot = {
  readAdr(adrFile) {
    const full = path.join(ADR_DIR, adrFile);
    if (!existsSync(full)) {
      return null;
    }
    return readFileSync(full, "utf8");
  },
  artifactExists(relPath) {
    return existsSync(path.resolve(process.cwd(), relPath));
  }
};

describe("ADR status agrees with the existence of its promised artifacts", () => {
  test("live: every mapped ADR is consistent with the repository", () => {
    expect(ADR_ARTIFACT_MAP.length).toBeGreaterThan(0);
    expect(collectOffenders(ADR_ARTIFACT_MAP, liveSnapshot)).toEqual([]);
  });

  test("live: the qualifier is never used outside the map", async () => {
    // Direction (d): `Accepted (belum diimplementasikan)` is only meaningful
    // when this gate binds it to artifact paths. An ADR carrying it without a
    // map entry has a status nothing enforces — the exact drift C12 names.
    const mapped = new Set(ADR_ARTIFACT_MAP.map((entry) => entry.adrFile));
    const names = (await readdir(ADR_DIR)).filter((name) =>
      /^\d{4}-.*\.md$/.test(name)
    );
    const offenders: string[] = [];

    for (const name of names) {
      const body = await readFile(path.join(ADR_DIR, name), "utf8");
      const status = extractStatus(body);

      if (status?.includes(QUALIFIER) && !mapped.has(name)) {
        offenders.push(
          `${name}: carries "${QUALIFIER}" but has no entry in ` +
            `ADR_ARTIFACT_MAP (tests/adr-implementation-status.test.ts) — ` +
            `add one naming the promised artifacts.`
        );
      }
    }

    expect(offenders).toEqual([]);
  });

  const syntheticMap: typeof ADR_ARTIFACT_MAP = [
    {
      adrFile: "9999-synthetic.md",
      artifacts: [["src/modules/synthetic-module"]]
    }
  ];

  function syntheticSnapshot(options: {
    status: string | null;
    artifactPresent: boolean;
  }): Snapshot {
    return {
      readAdr(adrFile) {
        if (adrFile !== "9999-synthetic.md") {
          return null;
        }
        if (options.status === null) {
          return "# ADR-9999 — Synthetic\n\nno status line here\n";
        }
        return `# ADR-9999 — Synthetic\n\n- **Status:** ${options.status}\n`;
      },
      artifactExists() {
        return options.artifactPresent;
      }
    };
  }

  test("mutation (a): absent artifact with plain Accepted status fails", () => {
    const offenders = collectOffenders(
      syntheticMap,
      syntheticSnapshot({ status: "Accepted", artifactPresent: false })
    );
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toContain(QUALIFIED_STATUS);
  });

  test("mutation (a'): absent artifact with the qualified status passes", () => {
    expect(
      collectOffenders(
        syntheticMap,
        syntheticSnapshot({ status: QUALIFIED_STATUS, artifactPresent: false })
      )
    ).toEqual([]);
  });

  test("mutation (b): present artifact with the qualified status fails — landing forces the flip", () => {
    const offenders = collectOffenders(
      syntheticMap,
      syntheticSnapshot({ status: QUALIFIED_STATUS, artifactPresent: true })
    );
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toContain('flip it to plain "Accepted"');
  });

  test("mutation (b'): present artifact with plain Accepted status passes", () => {
    expect(
      collectOffenders(
        syntheticMap,
        syntheticSnapshot({ status: "Accepted", artifactPresent: true })
      )
    ).toEqual([]);
  });

  test("mutation (c): map entry naming a nonexistent ADR file fails", () => {
    const offenders = collectOffenders(
      [
        {
          adrFile: "8888-does-not-exist.md",
          artifacts: [["src/modules/whatever"]]
        }
      ],
      syntheticSnapshot({ status: "Accepted", artifactPresent: false })
    );
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toContain("does not exist");
  });

  test("mutation: a mapped ADR without a Status line fails", () => {
    const offenders = collectOffenders(
      syntheticMap,
      syntheticSnapshot({ status: null, artifactPresent: false })
    );
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toContain('no "- **Status:** …" line');
  });

  test("mutation: a superseded mapped ADR is a dead entry and fails", () => {
    const offenders = collectOffenders(
      syntheticMap,
      syntheticSnapshot({
        status: "Superseded by ADR-9998",
        artifactPresent: false
      })
    );
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toContain("dead");
  });

  test("mutation: a partial landing fails in both status forms", () => {
    const partialMap: typeof ADR_ARTIFACT_MAP = [
      {
        adrFile: "9999-synthetic.md",
        artifacts: [["src/present.ts"], ["src/absent.ts"]]
      }
    ];
    const snapshot = (status: string): Snapshot => ({
      readAdr: () => `# ADR-9999 — Synthetic\n\n- **Status:** ${status}\n`,
      artifactExists: (relPath) => relPath === "src/present.ts"
    });

    for (const status of [PLAIN_STATUS, QUALIFIED_STATUS]) {
      const offenders = collectOffenders(partialMap, snapshot(status));
      expect(offenders).toHaveLength(1);
      expect(offenders[0]).toContain("partial landing");
    }
  });
});
