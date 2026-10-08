/**
 * ADR-0134 / Issue #918 — descriptor-declared domain-event consumers.
 *
 * The validator is the single source of truth for both the runtime's
 * registry build and `bun run domain-events:consumers:check`, so each rule is
 * proven here on a planted defect: a rule that has never been seen to fail is a
 * claim, not a gate.
 */
import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import type { ModuleDescriptor } from "../src/modules/_shared/module-contract";
import type { ModuleDomainEventConsumer } from "../src/modules/_shared/domain-event-consumer-contract";
import { validateDomainEventConsumerDeclarations } from "../src/modules/domain-event-runtime/domain/consumer-declarations";
import {
  buildDomainEventConsumerRegistry,
  DomainEventConsumerRegistryError
} from "../src/modules/domain-event-runtime/infrastructure/consumer-registry";
import {
  findEffectGuardBypasses,
  findMissingShippedConsumers
} from "../scripts/domain-event-consumers-check";

const EVENT = "awcms.fixture.thing.happened";

function mod(
  key: string,
  extra: Partial<ModuleDescriptor> = {}
): ModuleDescriptor {
  return {
    key,
    name: key,
    version: "1.0.0",
    status: "active",
    description: key,
    dependencies: ["domain_event_runtime"],
    ...extra
  };
}

function consumer(
  name: string,
  extra: Partial<ModuleDomainEventConsumer> = {}
): ModuleDomainEventConsumer {
  return {
    name,
    description: "fixture",
    eventTypes: [EVENT],
    eventVersions: ["1.0"],
    handle: async () => {},
    ...extra
  };
}

const publisher = mod("publisher", {
  dependencies: [],
  events: { asyncApiPath: "x", publishes: [EVENT], subscribes: [] }
});

function issuesFor(...modules: ModuleDescriptor[]): string[] {
  return validateDomainEventConsumerDeclarations(modules).issues.map(
    (issue) => issue.message
  );
}

describe("validateDomainEventConsumerDeclarations", () => {
  test("accepts a well-formed declaration", () => {
    const result = validateDomainEventConsumerDeclarations([
      publisher,
      mod("owner", { domainEventConsumers: [consumer("owner.projector")] })
    ]);
    expect(result.valid).toBe(true);
  });

  test("rejects a duplicate consumer name, across modules", () => {
    const issues = issuesFor(
      publisher,
      mod("a", { domainEventConsumers: [consumer("shared.name")] }),
      mod("b", { domainEventConsumers: [consumer("shared.name")] })
    );
    expect(issues.some((m) => m.includes("duplicate consumer name"))).toBe(
      true
    );
  });

  test("rejects a duplicate consumer name inside one module", () => {
    const issues = issuesFor(
      publisher,
      mod("a", {
        domainEventConsumers: [consumer("a.same"), consumer("a.same")]
      })
    );
    expect(issues.some((m) => m.includes("duplicate consumer name"))).toBe(
      true
    );
  });

  test("rejects a consumer of an event type no module publishes", () => {
    const issues = issuesFor(
      publisher,
      mod("a", {
        domainEventConsumers: [
          consumer("a.ghost", { eventTypes: ["awcms.nobody.publishes.this"] })
        ]
      })
    );
    expect(issues.some((m) => m.includes("no module lists in events"))).toBe(
      true
    );
  });

  test("rejects a declaring module that does not depend on domain_event_runtime", () => {
    const issues = issuesFor(
      publisher,
      mod("a", {
        dependencies: [],
        domainEventConsumers: [consumer("a.projector")]
      })
    );
    expect(issues.some((m) => m.includes("does not list"))).toBe(true);
  });

  test("the runtime module itself needs no self-dependency", () => {
    const result = validateDomainEventConsumerDeclarations([
      mod("domain_event_runtime", {
        dependencies: [],
        events: { asyncApiPath: "x", publishes: [EVENT], subscribes: [] },
        domainEventConsumers: [consumer("domain_event_runtime.projector")]
      })
    ]);
    expect(result.valid).toBe(true);
  });

  test("rejects malformed names, versions, empty lists and bad maxAttempts", () => {
    const issues = issuesFor(
      publisher,
      mod("a", {
        domainEventConsumers: [
          consumer("NotSnake"),
          consumer("a.empty", { eventTypes: [], eventVersions: [] }),
          consumer("a.version", { eventVersions: ["v1"] }),
          consumer("a.attempts", { maxAttempts: 0 })
        ]
      })
    );
    expect(issues.some((m) => m.includes("snake_case"))).toBe(true);
    expect(issues.some((m) => m.includes("at least one event type"))).toBe(
      true
    );
    expect(issues.some((m) => m.includes("at least one event version"))).toBe(
      true
    );
    expect(issues.some((m) => m.includes('event version "v1"'))).toBe(true);
    expect(issues.some((m) => m.includes("maxAttempts"))).toBe(true);
  });

  test("self_managed idempotency requires a rationale; a stray rationale is refused too", () => {
    const missing = issuesFor(
      publisher,
      mod("a", {
        domainEventConsumers: [
          consumer("a.inbox", { idempotency: "self_managed" })
        ]
      })
    );
    expect(missing.some((m) => m.includes("idempotencyRationale"))).toBe(true);

    const ok = validateDomainEventConsumerDeclarations([
      publisher,
      mod("a", {
        domainEventConsumers: [
          consumer("a.inbox", {
            idempotency: "self_managed",
            idempotencyRationale:
              "Natural-key upsert; a replay rewrites the same row."
          })
        ]
      })
    ]);
    expect(ok.valid).toBe(true);

    const stray = issuesFor(
      publisher,
      mod("a", {
        domainEventConsumers: [
          consumer("a.stray", { idempotencyRationale: "left over" })
        ]
      })
    );
    expect(stray.some((m) => m.includes("stale claim"))).toBe(true);
  });
});

describe("buildDomainEventConsumerRegistry", () => {
  test("throws DomainEventConsumerRegistryError listing every issue", () => {
    expect(() =>
      buildDomainEventConsumerRegistry([
        publisher,
        mod("a", {
          domainEventConsumers: [consumer("x.dup"), consumer("x.dup")]
        })
      ])
    ).toThrow(DomainEventConsumerRegistryError);
  });

  test("is sorted by consumer name regardless of module order", () => {
    const a = mod("a", { domainEventConsumers: [consumer("zeta.last")] });
    const b = mod("b", { domainEventConsumers: [consumer("alpha.first")] });
    const forward = buildDomainEventConsumerRegistry([publisher, a, b]);
    const reverse = buildDomainEventConsumerRegistry([b, a, publisher]);
    expect(forward.map((c) => c.name)).toEqual(["alpha.first", "zeta.last"]);
    expect(reverse.map((c) => c.name)).toEqual(forward.map((c) => c.name));
  });

  test("a module with status disabled contributes no running consumer, but is still validated", () => {
    const disabled = mod("off", {
      status: "disabled",
      domainEventConsumers: [consumer("off.projector")]
    });
    expect(buildDomainEventConsumerRegistry([publisher, disabled])).toEqual([]);

    const broken = mod("off", {
      status: "disabled",
      domainEventConsumers: [
        consumer("off.projector", { eventTypes: ["awcms.no.such.event"] })
      ]
    });
    expect(() => buildDomainEventConsumerRegistry([publisher, broken])).toThrow(
      DomainEventConsumerRegistryError
    );
  });

  test("records the owning module and defaults maxAttempts", () => {
    const [built] = buildDomainEventConsumerRegistry([
      publisher,
      mod("owner", { domainEventConsumers: [consumer("owner.projector")] })
    ]);
    expect(built!.ownerModuleKey).toBe("owner");
    expect(built!.maxAttempts).toBe(8);
  });

  test("the real composed registry builds and keeps the three shipped names", () => {
    const names = buildDomainEventConsumerRegistry(listModules()).map(
      (c) => c.name
    );
    expect(names).toEqual([
      "domain_event_runtime.activity_rollup_projector",
      "logging.sample_event_audit_projector",
      "reporting.event_activity_projector"
    ]);
    expect(findMissingShippedConsumers(listModules())).toEqual([]);
  });
});

describe("domain-events:consumers:check helpers", () => {
  test("findMissingShippedConsumers flags a renamed consumer", () => {
    const renamed = listModules().map((module) => ({
      ...module,
      domainEventConsumers: module.domainEventConsumers?.map((c) => ({
        ...c,
        name:
          c.name === "reporting.event_activity_projector"
            ? "reporting.event_activity_projector_v2"
            : c.name
      }))
    }));
    expect(findMissingShippedConsumers(renamed)).toEqual([
      "reporting.event_activity_projector"
    ]);
  });

  test("findEffectGuardBypasses flags a code call but not a comment or the allowed files", () => {
    const files = [
      {
        path: "src/modules/x/application/bad.ts",
        text: 'await applyConsumerEffectOnce(tx, t, "n", id, fx);'
      },
      {
        path: "src/modules/x/application/fine.ts",
        text: "// applyConsumerEffectOnce is applied by the registry\nexport const a = 1;"
      },
      {
        path: "src/modules/domain-event-runtime/application/consumer-effect.ts",
        text: "export async function applyConsumerEffectOnce() {}"
      }
    ];
    expect(findEffectGuardBypasses(files)).toEqual([
      "src/modules/x/application/bad.ts"
    ]);
  });

  test("the check script passes on the real tree (planted-defect failure is covered by the helper tests above)", async () => {
    const ok = Bun.spawnSync(
      ["bun", "scripts/domain-event-consumers-check.ts"],
      {
        cwd: import.meta.dir + "/..",
        stdout: "pipe",
        stderr: "pipe"
      }
    );
    expect(ok.exitCode).toBe(0);
    expect(
      findEffectGuardBypasses([
        { path: "src/a.ts", text: "applyConsumerEffectOnce(" }
      ]).length
    ).toBe(1);
  });
});
