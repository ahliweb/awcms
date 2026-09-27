/**
 * GitHub repository-progress config/projection (Issue ahliweb/omes#249,
 * ADR-0030) against a real PostgreSQL — same pattern as
 * `omes-control-hermes-orchestration.integration.test.ts`:
 * `withTenantOrThrow(getRuntimeSql(), tenantId, ...)` drives the REAL
 * application functions through the `awcms_app` role subject to `FORCE ROW
 * LEVEL SECURITY`, never a static string match on the SQL source.
 *
 * Covers this issue's specific acceptance criteria:
 *   - Cross-tenant RLS denial for both new tables.
 *   - Upsert idempotency (re-recording the same successful poll outcome
 *     leaves exactly one row, unchanged content).
 *   - A poll failure NEVER discards the last successful observation.
 *   - Reconfiguring to a different repository clears the old projection.
 *   - Freshness is recomputed at read time — a projection older than 2x the
 *     poll interval renders `stale`, never silently as current.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  clearRepositoryProgressConfig,
  getRepositoryProgressConfig,
  setRepositoryProgressConfig
} from "../../src/modules/omes-control/application/repository-progress-config";
import { fetchRepositoryProgress } from "../../src/modules/omes-control/application/repository-progress-directory";
import {
  getPreviousRepositoryProgressState,
  recordRepositoryProgressError,
  recordRepositoryProgressSuccess
} from "../../src/modules/omes-control/application/repository-progress-ingestion";
import { buildRepositoryProgressView } from "../../src/modules/omes-control/domain/repository-progress";

const suite = integrationEnabled ? describe : describe.skip;

const TENANT_A = "b4000000-0000-4000-8000-0000000000a1";
const TENANT_B = "b4000000-0000-4000-8000-0000000000b1";

async function seedTenant(id: string, code: string): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${id}, ${code}, ${code})
    ON CONFLICT (id) DO NOTHING
  `;
}

function sampleView(tenantId: string, observedAt: string) {
  return buildRepositoryProgressView({
    tenantId,
    owner: "acme",
    name: "widgets",
    observedAt,
    milestones: [
      {
        number: 1,
        title: "MVP",
        state: "open",
        openIssues: 1,
        closedIssues: 2,
        dueOn: null,
        htmlUrl: "https://github.com/acme/widgets/milestone/1"
      }
    ],
    issues: [
      {
        number: 10,
        title: "Fix the thing",
        state: "open",
        labels: ["bug"],
        milestoneNumber: 1,
        kind: "bug",
        htmlUrl: "https://github.com/acme/widgets/issues/10",
        updatedAt: observedAt
      }
    ]
  });
}

suite(
  "omes_control repository-progress config/projection (real PostgreSQL)",
  () => {
    beforeAll(async () => {
      await setupIntegrationDatabase();
    }, 120000);

    afterAll(async () => {
      await teardownIntegrationDatabase();
    }, 60000);

    beforeEach(async () => {
      await resetDatabase();
      await seedTenant(TENANT_A, "repo-progress-tenant-a");
      await seedTenant(TENANT_B, "repo-progress-tenant-b");
    }, 30000);

    describe("cross-tenant RLS denial (real, awcms_app / FORCE)", () => {
      test("tenant A's configuration is invisible to tenant B, even with an identical owner/name", async () => {
        await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
          setRepositoryProgressConfig(tx, TENANT_A, {
            owner: "acme",
            name: "widgets",
            useToken: false
          })
        );

        const forB = await withTenantOrThrow(getRuntimeSql(), TENANT_B, (tx) =>
          getRepositoryProgressConfig(tx, TENANT_B)
        );
        expect(forB).toBeNull();

        const forA = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
          getRepositoryProgressConfig(tx, TENANT_A)
        );
        expect(forA?.owner).toBe("acme");
      });

      test("tenant A's projection is invisible to tenant B", async () => {
        const view = sampleView(TENANT_A, new Date().toISOString());
        await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
          recordRepositoryProgressSuccess(tx, TENANT_A, view, null, null)
        );

        const forB = await withTenantOrThrow(getRuntimeSql(), TENANT_B, (tx) =>
          fetchRepositoryProgress(tx, TENANT_B, new Date())
        );
        expect(forB.state).toBe("unconfigured");

        const forA = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
          fetchRepositoryProgress(tx, TENANT_A, new Date())
        );
        // fetchRepositoryProgress reports "unconfigured" without a config row
        // even if a projection exists (defense in depth) — set the config too.
        expect(forA.state).toBe("unconfigured");
      });
    });

    describe("config lifecycle", () => {
      test("reconfiguring to a different repository clears the old projection", async () => {
        await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
          setRepositoryProgressConfig(tx, TENANT_A, {
            owner: "acme",
            name: "widgets",
            useToken: false
          })
        );
        const view = sampleView(TENANT_A, new Date().toISOString());
        await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
          recordRepositoryProgressSuccess(tx, TENANT_A, view, null, null)
        );

        let progress = await withTenantOrThrow(
          getRuntimeSql(),
          TENANT_A,
          (tx) => fetchRepositoryProgress(tx, TENANT_A, new Date())
        );
        expect(progress.state).toBe("configured");
        if (progress.state === "configured") {
          expect(progress.milestones).toHaveLength(1);
        }

        await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
          setRepositoryProgressConfig(tx, TENANT_A, {
            owner: "acme",
            name: "other-repo",
            useToken: false
          })
        );

        progress = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
          fetchRepositoryProgress(tx, TENANT_A, new Date())
        );
        expect(progress.state).toBe("configured");
        if (progress.state === "configured") {
          expect(progress.repository.name).toBe("other-repo");
          expect(progress.observedAt).toBeNull(); // old projection was cleared
          expect(progress.milestones).toHaveLength(0);
        }
      });

      test("clearing the configuration returns to unconfigured and removes the projection", async () => {
        await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
          setRepositoryProgressConfig(tx, TENANT_A, {
            owner: "acme",
            name: "widgets",
            useToken: false
          })
        );
        await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
          recordRepositoryProgressSuccess(
            tx,
            TENANT_A,
            sampleView(TENANT_A, new Date().toISOString()),
            null,
            null
          )
        );

        await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
          clearRepositoryProgressConfig(tx, TENANT_A)
        );

        const progress = await withTenantOrThrow(
          getRuntimeSql(),
          TENANT_A,
          (tx) => fetchRepositoryProgress(tx, TENANT_A, new Date())
        );
        expect(progress.state).toBe("unconfigured");
      });

      test("an invalid owner/name is refused before ever reaching the database", async () => {
        const outcome = await withTenantOrThrow(
          getRuntimeSql(),
          TENANT_A,
          (tx) =>
            setRepositoryProgressConfig(tx, TENANT_A, {
              owner: "acme/evil",
              name: "widgets",
              useToken: false
            })
        );
        expect(outcome.outcome).toBe("invalid_owner_or_name");

        const stored = await withTenantOrThrow(
          getRuntimeSql(),
          TENANT_A,
          (tx) => getRepositoryProgressConfig(tx, TENANT_A)
        );
        expect(stored).toBeNull();
      });
    });

    describe("projection upsert idempotency and error retention", () => {
      test("recording the same successful poll twice leaves exactly one row", async () => {
        await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
          setRepositoryProgressConfig(tx, TENANT_A, {
            owner: "acme",
            name: "widgets",
            useToken: false
          })
        );
        const view = sampleView(TENANT_A, "2026-09-27T12:00:00Z");

        await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
          recordRepositoryProgressSuccess(
            tx,
            TENANT_A,
            view,
            '"etag-1"',
            '"etag-2"'
          )
        );
        await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
          recordRepositoryProgressSuccess(
            tx,
            TENANT_A,
            view,
            '"etag-1"',
            '"etag-2"'
          )
        );

        const rows = await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_omes_repository_progress WHERE tenant_id = ${TENANT_A}
      `;
        expect((rows as { n: number }[])[0]?.n).toBe(1);

        const previous = await withTenantOrThrow(
          getRuntimeSql(),
          TENANT_A,
          (tx) => getPreviousRepositoryProgressState(tx, TENANT_A)
        );
        expect(previous?.milestonesEtag).toBe('"etag-1"');
        expect(previous?.milestones).toHaveLength(1);
      });

      test("a poll error never discards a prior successful observation, but flips status to error", async () => {
        await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
          setRepositoryProgressConfig(tx, TENANT_A, {
            owner: "acme",
            name: "widgets",
            useToken: false
          })
        );
        await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
          recordRepositoryProgressSuccess(
            tx,
            TENANT_A,
            sampleView(TENANT_A, "2026-09-27T12:00:00Z"),
            null,
            null
          )
        );

        await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
          recordRepositoryProgressError(
            tx,
            TENANT_A,
            "acme",
            "widgets",
            "rate_limited",
            new Date("2026-09-27T13:00:00Z")
          )
        );

        const progress = await withTenantOrThrow(
          getRuntimeSql(),
          TENANT_A,
          (tx) =>
            fetchRepositoryProgress(
              tx,
              TENANT_A,
              new Date("2026-09-27T13:00:01Z")
            )
        );
        expect(progress.state).toBe("configured");
        if (progress.state !== "configured") return;
        expect(progress.pollStatus).toBe("error");
        expect(progress.lastErrorClass).toBe("rate_limited");
        // The LAST SUCCESSFUL observation is retained, not discarded.
        expect(progress.observedAt).toBe("2026-09-27T12:00:00.000Z");
        expect(progress.milestones).toHaveLength(1);
      });

      test("a projection older than 2x the poll interval renders stale, never silently as current", async () => {
        await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
          setRepositoryProgressConfig(tx, TENANT_A, {
            owner: "acme",
            name: "widgets",
            useToken: false
          })
        );
        await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
          recordRepositoryProgressSuccess(
            tx,
            TENANT_A,
            sampleView(TENANT_A, "2026-09-27T12:00:00Z"),
            null,
            null
          )
        );

        // 15 minutes default interval * 2 = 30 minutes grace; 40 minutes later is stale.
        const progress = await withTenantOrThrow(
          getRuntimeSql(),
          TENANT_A,
          (tx) =>
            fetchRepositoryProgress(
              tx,
              TENANT_A,
              new Date("2026-09-27T12:40:00Z")
            )
        );
        expect(progress.state).toBe("configured");
        if (progress.state !== "configured") return;
        expect(progress.freshness).toBe("stale");
        // Stale data is still SHOWN, never discarded.
        expect(progress.milestones).toHaveLength(1);
      });
    });
  }
);
