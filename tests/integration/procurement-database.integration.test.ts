/**
 * The procurement schema and posting core against a real PostgreSQL, as the
 * least-privilege runtime role, with FORCE RLS in force (Issue #888, ADR-0128).
 *
 * `procurement-api.integration.test.ts` proves the HTTP wiring. This file attacks
 * the invariants that live in the DATABASE and must hold even if the application
 * code were bypassed:
 *
 *   * no reference crosses tenants — composite (tenant_id, id) foreign keys,
 *     including the cross-MODULE ones to the inventory ledger;
 *   * the document state machine and immutability are triggers, enforced against
 *     the table OWNER too;
 *   * the movement-link and event tables are append-only;
 *   * reconciliation notices a missing link and a ledger row nothing links;
 *   * the reporting projections count what happened and `awcms_worker` can read
 *     their source.
 *
 * Gated on `DATABASE_URL` (harness §Gating).
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
  assertRejected as assertRejectedByDatabase,
  getAdminSql,
  getRuntimeSql,
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { resetDatabaseCircuitBreakerForTests } from "../../src/lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { inventoryLedgerPortAdapter } from "../../src/modules/inventory/application/inventory-ledger-port-adapter";
import { createLocation } from "../../src/modules/inventory/application/inventory-location-directory";
import {
  cancelDocument,
  createDocument,
  getDocument,
  submitDocument
} from "../../src/modules/procurement/application/procurement-document-directory";
import {
  finaliseDocument,
  reverseDocument
} from "../../src/modules/procurement/application/procurement-posting";
import { reconcileDocuments } from "../../src/modules/procurement/application/procurement-reporting";
import { createSupplier } from "../../src/modules/procurement/application/procurement-supplier-directory";
import type { CreateDocumentInput } from "../../src/modules/procurement/domain/procurement-validation";
import { runIncrementalUpdateForTenant } from "../../src/modules/reporting/application/projection-incremental-worker";
import { getProjectionMetrics } from "../../src/modules/reporting/application/projection-metric-store";
import { reconcileProjection } from "../../src/modules/reporting/application/projection-reconciliation";
import { listModules } from "../../src/modules";
import { collectProjectionDescriptors } from "../../src/modules/reporting/domain/projection-registry";

/**
 * The harness's `assertRejected` takes a label; this wrapper also pins WHY the
 * database refused (SQLSTATE or message), so a test cannot pass on an unrelated
 * failure such as a typo'd column.
 */
async function assertRejected(
  promise: Promise<unknown>,
  expected: RegExp
): Promise<Error> {
  const error = await assertRejectedByDatabase(promise, String(expected));
  // Deliberate refusals through the tenant context count as database failures
  // and would open the circuit breaker, turning the NEXT expected error into
  // "Database circuit breaker is open" — so each refusal starts from closed.
  resetDatabaseCircuitBreakerForTests();
  const text = `${error.message} ${String((error as { errno?: unknown }).errno ?? "")}`;
  expect(text).toMatch(expected);
  return error;
}

const TENANT_A = "a8880000-0000-4000-8000-00000000000a";
const TENANT_B = "a8880000-0000-4000-8000-00000000000b";

// A REAL tenant user per tenant: the schema now requires `finalised_by` beside
// `finalised_at` (and `reversed_by` beside `reversed_at`), and each is a
// composite foreign key into the tenant's own users.
const ACTOR_IDS = new Map<string, string>();

function actorOf(tenantId: string) {
  return {
    actorTenantUserId: ACTOR_IDS.get(tenantId) ?? null,
    correlationId: "corr-888-db"
  };
}

async function seedActor(tenantId: string, tag: string): Promise<void> {
  const admin = getAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Actor ${tag}`})
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const user = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];

  ACTOR_IDS.set(tenantId, user[0]!.id);
}
const ITEM = { itemType: "commerce.variant", unitCode: "unit" };

function inTenant<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return withTenantOrThrow(getRuntimeSql(), tenantId, fn);
}

async function newLocation(tenantId: string, code: string): Promise<string> {
  const result = await inTenant(tenantId, (tx) =>
    createLocation(tx, tenantId, null, { code, name: code, officeId: null })
  );

  if (result.outcome !== "created") {
    throw new Error(`fixture: location ${code}`);
  }

  return result.location.id;
}

async function newSupplier(tenantId: string, code: string): Promise<string> {
  const result = await inTenant(tenantId, (tx) =>
    createSupplier(tx, tenantId, actorOf(tenantId), {
      vendorCode: code,
      name: `Supplier ${code}`,
      status: "active",
      profileId: null,
      categories: ["food"],
      tags: []
    })
  );

  if (result.outcome !== "ok") {
    throw new Error(`fixture: supplier ${code}`);
  }

  return result.supplier.id;
}

function lines(...specs: [string, string, string | null][]) {
  return specs.map(([itemRef, quantity, unitCost]) => ({
    ...ITEM,
    itemRef,
    sku: `SKU-${itemRef}`,
    itemName: `Item ${itemRef}`,
    quantity,
    unitCost
  }));
}

async function receivedDocument(
  tenantId: string,
  input: CreateDocumentInput
): Promise<string> {
  return inTenant(tenantId, async (tx) => {
    const created = await createDocument(
      tx,
      tenantId,
      actorOf(tenantId),
      input
    );

    if (created.outcome !== "ok") {
      throw new Error(`fixture: document ${created.outcome}`);
    }

    const id = created.document.id;
    const submitted = await submitDocument(
      tx,
      tenantId,
      id,
      actorOf(tenantId),
      new Date()
    );

    if (submitted.outcome !== "ok") {
      throw new Error(`fixture: submit ${submitted.outcome}`);
    }

    const done = await finaliseDocument(
      tx,
      inventoryLedgerPortAdapter,
      tenantId,
      id,
      actorOf(tenantId)
    );

    if (done.outcome !== "ok") {
      throw new Error(`fixture: finalise ${done.outcome}`);
    }

    return id;
  });
}

const suite = integrationEnabled ? describe : describe.skip;

suite("procurement database invariants (Issue #888, ADR-0128)", () => {
  let locA = "";
  let locA2 = "";
  let locB = "";
  let supA = "";
  let supB = "";

  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${TENANT_A}, 'proc-a', 'Procurement A'),
             (${TENANT_B}, 'proc-b', 'Procurement B')
    `;
    await seedActor(TENANT_A, "actor-a");
    await seedActor(TENANT_B, "actor-b");
    locA = await newLocation(TENANT_A, "main");
    locA2 = await newLocation(TENANT_A, "annex");
    locB = await newLocation(TENANT_B, "main");
    supA = await newSupplier(TENANT_A, "ACME");
    supB = await newSupplier(TENANT_B, "OTHER");
  });

  const receive = (
    supplierId: string,
    locationId: string,
    specs: [string, string, string | null][]
  ): CreateDocumentInput => ({
    mode: "receive",
    supplierId,
    locationId,
    sourceLocationId: null,
    externalReference: null,
    documentDate: null,
    notes: null,
    currencyCode: "IDR",
    lines: lines(...specs)
  });

  describe("tenant isolation", () => {
    test("a document cannot reference another tenant's supplier or stock location, even for the table owner", async () => {
      const admin = getAdminSql();
      const insert = (supplierId: string, locationId: string) =>
        admin`
          INSERT INTO awcms_procurement_documents
            (tenant_id, document_no, mode, supplier_id, location_id)
          VALUES (${TENANT_A}, ${`X-${crypto.randomUUID()}`}, 'receive',
                  ${supplierId}, ${locationId})
        `;

      await assertRejected(insert(supB, locA), /foreign key|23503/i);
      await assertRejected(insert(supA, locB), /foreign key|23503/i);
      // The control: the same shape with this tenant's own references works.
      await insert(supA, locA);
    });

    test("a movement link cannot name another tenant's ledger movement, nor a document line that is not its own", async () => {
      const admin = getAdminSql();
      const docB = await receivedDocument(
        TENANT_B,
        receive(supB, locB, [["iso-1", "1", "1"]])
      );
      const movementB = (await admin`
        SELECT movement_id FROM awcms_procurement_document_movements
        WHERE tenant_id = ${TENANT_B} AND document_id = ${docB}
      `) as { movement_id: string }[];
      const docA = await receivedDocument(
        TENANT_A,
        receive(supA, locA, [["iso-a", "1", "1"]])
      );

      await assertRejected(
        admin`
          INSERT INTO awcms_procurement_document_movements
            (tenant_id, document_id, line_no, operation, movement_id)
          VALUES (${TENANT_A}, ${docA}, 1, 'reversal', ${movementB[0]!.movement_id})
        `,
        /foreign key|23503/i
      );
      await assertRejected(
        admin`
          INSERT INTO awcms_procurement_document_movements
            (tenant_id, document_id, line_no, operation, movement_id)
          VALUES (${TENANT_A}, ${docB}, 1, 'post', ${movementB[0]!.movement_id})
        `,
        /foreign key|23503/i
      );
    });

    test("a supplier cannot link another tenant's party; labels and identifiers cannot cross either", async () => {
      const admin = getAdminSql();
      const profileB = (await admin`
        INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
        VALUES (${TENANT_B}, 'organization', 'Party B')
        RETURNING id
      `) as { id: string }[];

      await assertRejected(
        admin`
          UPDATE awcms_procurement_suppliers SET profile_id = ${profileB[0]!.id}
          WHERE tenant_id = ${TENANT_A} AND id = ${supA}
        `,
        /foreign key|23503/i
      );
      await assertRejected(
        admin`
          INSERT INTO awcms_procurement_supplier_labels
            (tenant_id, supplier_id, label_kind, label)
          VALUES (${TENANT_A}, ${supB}, 'tag', 'x')
        `,
        /foreign key|23503/i
      );
      await assertRejected(
        admin`
          INSERT INTO awcms_procurement_supplier_identifiers
            (tenant_id, supplier_id, identifier_type, normalized_value,
             value_hash, masked_value)
          VALUES (${TENANT_A}, ${supB}, 'other', 'v', 'h', 'm')
        `,
        /foreign key|23503/i
      );
    });

    test("FORCE RLS: the runtime role sees only its own tenant, and cannot write another's rows", async () => {
      await receivedDocument(
        TENANT_A,
        receive(supA, locA, [["rls-1", "1", "1"]])
      );

      const seenByB = await inTenant(
        TENANT_B,
        (tx) =>
          tx`SELECT count(*)::int AS n FROM awcms_procurement_documents` as Promise<
            { n: number }[]
          >
      );
      expect(seenByB[0]!.n).toBe(0);

      await assertRejected(
        inTenant(
          TENANT_B,
          (tx) => tx`
            INSERT INTO awcms_procurement_suppliers (tenant_id, vendor_code, name)
            VALUES (${TENANT_A}, 'SNEAK', 'Sneak')
          `
        ),
        /row-level security|42501/i
      );
    });

    test("every procurement table is RLS-enabled AND forced", async () => {
      const rows = (await getAdminSql()`
        SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE relname LIKE 'awcms\\_procurement\\_%' AND relkind = 'r'
      `) as {
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }[];

      expect(rows.length).toBe(8);
      for (const row of rows) {
        expect([
          row.relname,
          row.relrowsecurity,
          row.relforcerowsecurity
        ]).toEqual([row.relname, true, true]);
      }
    });
  });

  describe("the state machine and immutability are enforced by the database", () => {
    async function submittedDraft(): Promise<string> {
      return inTenant(TENANT_A, async (tx) => {
        const created = await createDocument(
          tx,
          TENANT_A,
          actorOf(TENANT_A),
          receive(supA, locA, [["sm-1", "2", "3"]])
        );
        const id = (created as { document: { id: string } }).document.id;

        await submitDocument(tx, TENANT_A, id, actorOf(TENANT_A), new Date());

        return id;
      });
    }

    test("a finalised document cannot be edited, un-finalised, re-pointed or deleted — even by the table owner", async () => {
      const id = await receivedDocument(
        TENANT_A,
        receive(supA, locA, [["im-1", "2", "3"]])
      );
      const admin = getAdminSql();

      await assertRejected(
        admin`UPDATE awcms_procurement_documents SET location_id = ${locA2}
              WHERE tenant_id = ${TENANT_A} AND id = ${id}`,
        /55000|may not change|illegal/i
      );
      await assertRejected(
        admin`UPDATE awcms_procurement_documents SET notes = 'tampered'
              WHERE tenant_id = ${TENANT_A} AND id = ${id}`,
        /55000|may not change|illegal/i
      );
      await assertRejected(
        admin`UPDATE awcms_procurement_documents SET status = 'draft', finalised_at = NULL,
              finalised_by = NULL WHERE tenant_id = ${TENANT_A} AND id = ${id}`,
        /55000|illegal/i
      );
      await assertRejected(
        admin`UPDATE awcms_procurement_documents SET status = 'cancelled',
              cancelled_at = now() WHERE tenant_id = ${TENANT_A} AND id = ${id}`,
        /55000|illegal/i
      );
      await assertRejected(
        admin`DELETE FROM awcms_procurement_documents
              WHERE tenant_id = ${TENANT_A} AND id = ${id}`,
        /55000|append-only|not allowed/i
      );
      // Lines of a finalised document are frozen too.
      await assertRejected(
        admin`UPDATE awcms_procurement_document_lines SET quantity = 999
              WHERE tenant_id = ${TENANT_A} AND document_id = ${id}`,
        /55000|immutable/i
      );
      await assertRejected(
        admin`DELETE FROM awcms_procurement_document_lines
              WHERE tenant_id = ${TENANT_A} AND document_id = ${id}`,
        /55000|immutable/i
      );
      await assertRejected(
        admin`INSERT INTO awcms_procurement_document_lines
                (tenant_id, document_id, line_no, item_type, item_ref, sku,
                 item_name, unit_code, quantity)
              VALUES (${TENANT_A}, ${id}, 99, 'x', 'y', 's', 'n', 'unit', 1)`,
        /55000|immutable/i
      );
    });

    test("illegal transitions are refused: draft cannot jump to finalised, a submitted document cannot go back, terminal states stay terminal", async () => {
      const admin = getAdminSql();
      const created = await inTenant(TENANT_A, (tx) =>
        createDocument(
          tx,
          TENANT_A,
          actorOf(TENANT_A),
          receive(supA, locA, [["tr-1", "1", "1"]])
        )
      );
      const id = (created as { document: { id: string } }).document.id;

      await assertRejected(
        admin`UPDATE awcms_procurement_documents SET status = 'finalised',
              submitted_at = now(), finalised_at = now()
              WHERE tenant_id = ${TENANT_A} AND id = ${id}`,
        /55000|illegal/i
      );

      const submitted = await submittedDraft();
      await assertRejected(
        admin`UPDATE awcms_procurement_documents SET status = 'draft',
              submitted_at = NULL WHERE tenant_id = ${TENANT_A} AND id = ${submitted}`,
        /55000|illegal/i
      );

      await inTenant(TENANT_A, (tx) =>
        cancelDocument(
          tx,
          TENANT_A,
          submitted,
          actorOf(TENANT_A),
          "no longer needed"
        )
      );
      await assertRejected(
        admin`UPDATE awcms_procurement_documents SET status = 'submitted',
              cancelled_at = NULL WHERE tenant_id = ${TENANT_A} AND id = ${submitted}`,
        /55000|illegal/i
      );
    });

    test("approval is a one-way door: pending/rejected can never be finalised, approval moves only pending -> approved|rejected, the instance never changes (audit M4)", async () => {
      const admin = getAdminSql();
      const actor = actorOf(TENANT_A).actorTenantUserId!;
      const pendingSubmitted = async (): Promise<string> => {
        const created = await inTenant(TENANT_A, (tx) =>
          createDocument(
            tx,
            TENANT_A,
            actorOf(TENANT_A),
            receive(supA, locA, [[`ap-${crypto.randomUUID()}`, "1", "1"]])
          )
        );
        const id = (created as { document: { id: string } }).document.id;

        await admin`
          UPDATE awcms_procurement_documents
          SET status = 'submitted', submitted_at = now(),
              approval_status = 'pending', approval_instance_id = gen_random_uuid()
          WHERE tenant_id = ${TENANT_A} AND id = ${id}`;

        return id;
      };
      const finalise = (id: string, by: string | null) =>
        admin`UPDATE awcms_procurement_documents
              SET status = 'finalised', finalised_at = now(), finalised_by = ${by}
              WHERE tenant_id = ${TENANT_A} AND id = ${id}`;

      // pending cannot be finalised, whatever the application did.
      const pending = await pendingSubmitted();
      await assertRejected(
        finalise(pending, actor),
        /23514|finalise_approval/i
      );

      // The instance is fixed at submit.
      await assertRejected(
        admin`UPDATE awcms_procurement_documents
              SET approval_instance_id = gen_random_uuid()
              WHERE tenant_id = ${TENANT_A} AND id = ${pending}`,
        /55000|may not change/i
      );
      await assertRejected(
        admin`UPDATE awcms_procurement_documents
              SET approval_status = 'not_required'
              WHERE tenant_id = ${TENANT_A} AND id = ${pending}`,
        /55000|pending ->/i
      );

      // pending -> rejected is allowed, and rejected is final: it can neither
      // be finalised nor flipped to approved.
      await admin`UPDATE awcms_procurement_documents SET approval_status = 'rejected'
                  WHERE tenant_id = ${TENANT_A} AND id = ${pending}`;
      await assertRejected(
        finalise(pending, actor),
        /23514|finalise_approval/i
      );
      await assertRejected(
        admin`UPDATE awcms_procurement_documents SET approval_status = 'approved'
              WHERE tenant_id = ${TENANT_A} AND id = ${pending}`,
        /55000|pending ->/i
      );

      // pending -> approved is allowed; approved cannot go back.
      const approved = await pendingSubmitted();
      await admin`UPDATE awcms_procurement_documents SET approval_status = 'approved'
                  WHERE tenant_id = ${TENANT_A} AND id = ${approved}`;
      await assertRejected(
        admin`UPDATE awcms_procurement_documents SET approval_status = 'pending'
              WHERE tenant_id = ${TENANT_A} AND id = ${approved}`,
        /55000|pending ->/i
      );

      // A finalise stamp without its actor is refused (audit L7) ...
      await assertRejected(finalise(approved, null), /23514|actor_stamps/i);
      // ... and with one, the approved document finalises.
      await finalise(approved, actor);
      const status = (await admin`
        SELECT status FROM awcms_procurement_documents
        WHERE tenant_id = ${TENANT_A} AND id = ${approved}`) as {
        status: string;
      }[];
      expect(status[0]!.status).toBe("finalised");

      // A reversal needs both its actor and its reason.
      await assertRejected(
        admin`UPDATE awcms_procurement_documents
              SET status = 'reversed', reversed_at = now(), reversed_by = ${actor}
              WHERE tenant_id = ${TENANT_A} AND id = ${approved}`,
        /23514|actor_stamps/i
      );
    });

    test("a reversed document frees its external reference so the same delivery can be received again; a live one still blocks it (audit L7)", async () => {
      const withRef = (): CreateDocumentInput => ({
        ...receive(supA, locA, [["xr-1", "2", "1"]]),
        externalReference: "DN-REUSE"
      });
      const first = await receivedDocument(TENANT_A, withRef());

      const blocked = await inTenant(TENANT_A, (tx) =>
        createDocument(tx, TENANT_A, actorOf(TENANT_A), withRef())
      );
      expect(blocked.outcome).toBe("duplicate_external_reference");

      const reversed = await inTenant(TENANT_A, (tx) =>
        reverseDocument(
          tx,
          inventoryLedgerPortAdapter,
          TENANT_A,
          first,
          actorOf(TENANT_A),
          "wrong delivery"
        )
      );
      expect(reversed.outcome).toBe("ok");

      const again = await inTenant(TENANT_A, (tx) =>
        createDocument(tx, TENANT_A, actorOf(TENANT_A), withRef())
      );
      expect(again.outcome).toBe("ok");
    });

    test("a submitted document's lines and header are frozen; a draft's are not", async () => {
      const admin = getAdminSql();
      const id = await submittedDraft();

      await assertRejected(
        admin`UPDATE awcms_procurement_document_lines SET quantity = 50
              WHERE tenant_id = ${TENANT_A} AND document_id = ${id}`,
        /55000|immutable/i
      );
      await assertRejected(
        admin`UPDATE awcms_procurement_documents SET notes = 'late edit'
              WHERE tenant_id = ${TENANT_A} AND id = ${id}`,
        /55000|may not change/i
      );

      const draft = await inTenant(TENANT_A, (tx) =>
        createDocument(
          tx,
          TENANT_A,
          actorOf(TENANT_A),
          receive(supA, locA, [["fr-1", "1", "1"]])
        )
      );
      const draftId = (draft as { document: { id: string } }).document.id;

      await admin`UPDATE awcms_procurement_document_lines SET quantity = 8
                  WHERE tenant_id = ${TENANT_A} AND document_id = ${draftId}`;
    });

    test("a line cannot be MOVED out of a submitted document into a draft (the OLD parent is checked too)", async () => {
      const admin = getAdminSql();
      const frozenId = await submittedDraft();
      const draft = await inTenant(TENANT_A, (tx) =>
        createDocument(
          tx,
          TENANT_A,
          actorOf(TENANT_A),
          receive(supA, locA, [["mv-1", "1", "1"]])
        )
      );
      const draftId = (draft as { document: { id: string } }).document.id;

      // The NEW parent is a draft (writable); the OLD parent is not.
      await assertRejected(
        admin`UPDATE awcms_procurement_document_lines
              SET document_id = ${draftId}, line_no = 99
              WHERE tenant_id = ${TENANT_A} AND document_id = ${frozenId}`,
        /55000|immutable/i
      );

      const rows = (await admin`
        SELECT count(*)::int AS n FROM awcms_procurement_document_lines
        WHERE tenant_id = ${TENANT_A} AND document_id = ${frozenId}
      `) as { n: number }[];
      expect(rows[0]!.n).toBeGreaterThan(0);
    });

    test("a document is born a draft and never in a stamped state", async () => {
      await assertRejected(
        getAdminSql()`
          INSERT INTO awcms_procurement_documents
            (tenant_id, document_no, mode, status, supplier_id, location_id,
             submitted_at, finalised_at)
          VALUES (${TENANT_A}, ${`X-${crypto.randomUUID()}`}, 'receive',
                  'finalised', ${supA}, ${locA}, now(), now())
        `,
        /55000|born|created as draft/i
      );
    });

    test("the mode decides the shape: supplier modes need a supplier, location modes need two different locations", async () => {
      const admin = getAdminSql();
      const base = (
        mode: string,
        supplier: string | null,
        source: string | null
      ) =>
        admin`
          INSERT INTO awcms_procurement_documents
            (tenant_id, document_no, mode, supplier_id, location_id, source_location_id)
          VALUES (${TENANT_A}, ${`X-${crypto.randomUUID()}`}, ${mode},
                  ${supplier}, ${locA}, ${source})
        `;

      await assertRejected(base("receive", null, null), /mode_shape|23514/i);
      await assertRejected(base("transfer", null, null), /mode_shape|23514/i);
      await assertRejected(base("transfer", null, locA), /mode_shape|23514/i);
      await assertRejected(base("transfer", supA, locA2), /mode_shape|23514/i);
      await base("transfer", null, locA2);
    });

    test("the runtime role holds no DELETE on documents, suppliers, links or events, and no UPDATE on links or events", async () => {
      const runtime = (sql: string) =>
        inTenant(TENANT_A, (tx) => tx.unsafe(sql));

      for (const table of [
        "awcms_procurement_documents",
        "awcms_procurement_suppliers",
        "awcms_procurement_document_movements",
        "awcms_procurement_document_events"
      ]) {
        await assertRejected(
          runtime(`DELETE FROM ${table}`),
          /permission denied|42501/i
        );
      }

      for (const table of [
        "awcms_procurement_document_movements",
        "awcms_procurement_document_events"
      ]) {
        await assertRejected(
          runtime(`UPDATE ${table} SET created_at = now()`),
          /permission denied|42501/i
        );
      }
    });

    test("links and events are append-only by trigger as well, for any role", async () => {
      const id = await receivedDocument(
        TENANT_A,
        receive(supA, locA, [["ao-1", "1", "1"]])
      );
      const admin = getAdminSql();

      await assertRejected(
        admin`DELETE FROM awcms_procurement_document_movements
              WHERE tenant_id = ${TENANT_A} AND document_id = ${id}`,
        /55000|append-only/i
      );
      await assertRejected(
        admin`UPDATE awcms_procurement_document_events SET line_count = 9
              WHERE tenant_id = ${TENANT_A} AND document_id = ${id}`,
        /55000|append-only/i
      );
    });

    test("a document reaches each of finalised/cancelled/reversed at most once (unique event)", async () => {
      const id = await receivedDocument(
        TENANT_A,
        receive(supA, locA, [["ev-1", "1", "1"]])
      );

      await assertRejected(
        getAdminSql()`
          INSERT INTO awcms_procurement_document_events
            (tenant_id, document_id, mode, event_kind, supplier_id)
          VALUES (${TENANT_A}, ${id}, 'receive', 'finalised', ${supA})
        `,
        /unique|duplicate|23505/i
      );
    });
  });

  describe("reconciliation against the ledger", () => {
    test("a clean ledger reconciles; a movement posted outside procurement under a procurement identity is reported", async () => {
      const id = await receivedDocument(
        TENANT_A,
        receive(supA, locA, [["rc-1", "5", "2"]])
      );

      const clean = await inTenant(TENANT_A, (tx) =>
        reconcileDocuments(tx, TENANT_A, null)
      );
      expect(clean).toMatchObject({
        reconciled: true,
        documentsChecked: 1,
        linesChecked: 1,
        unlinkedLedgerMovements: 0
      });

      // Someone posts to the ledger under this document's identity directly.
      await inTenant(TENANT_A, (tx) =>
        inventoryLedgerPortAdapter.postReceipt(tx, TENANT_A, null, {
          ...ITEM,
          itemRef: "rc-1",
          locationId: locA,
          quantity: "1",
          source: { type: "procurement_receipt", id, line: "9" }
        })
      );

      const drifted = await inTenant(TENANT_A, (tx) =>
        reconcileDocuments(tx, TENANT_A, null)
      );
      expect(drifted.reconciled).toBe(false);
      expect(drifted.unlinkedLedgerMovements).toBe(1);
    });

    test("a missing link is reported as a discrepancy for exactly that line and operation", async () => {
      const id = await receivedDocument(
        TENANT_A,
        receive(supA, locA, [
          ["dl-1", "5", "2"],
          ["dl-2", "1", "2"]
        ])
      );
      const admin = getAdminSql();

      // The append-only trigger would refuse this; an operator repairing a
      // damaged database is the only actor who could, so disable it for the test.
      await admin`ALTER TABLE awcms_procurement_document_movements
                  DISABLE TRIGGER awcms_procurement_document_movements_append_only`;
      try {
        await admin`DELETE FROM awcms_procurement_document_movements
                    WHERE tenant_id = ${TENANT_A} AND document_id = ${id}
                      AND line_no = 2`;
      } finally {
        await admin`ALTER TABLE awcms_procurement_document_movements
                    ENABLE TRIGGER awcms_procurement_document_movements_append_only`;
      }

      const report = await inTenant(TENANT_A, (tx) =>
        reconcileDocuments(tx, TENANT_A, id)
      );

      expect(report.reconciled).toBe(false);
      expect(report.discrepancies).toEqual([
        {
          documentId: id,
          lineNo: 2,
          operation: "post",
          expectedMovements: 1,
          linkedMovements: 0,
          matchingMovements: 0
        }
      ]);
      // The orphaned ledger row is also visible as unlinked.
      expect(report.unlinkedLedgerMovements).toBe(1);
    });

    test("every mode and a reversal reconcile, including the two-leg transfer in both directions", async () => {
      await receivedDocument(
        TENANT_A,
        receive(supA, locA, [["all-1", "10", "1"]])
      );
      const transfer = await receivedDocument(TENANT_A, {
        mode: "transfer",
        supplierId: null,
        locationId: locA2,
        sourceLocationId: locA,
        externalReference: null,
        documentDate: null,
        notes: null,
        currencyCode: "IDR",
        lines: lines(["all-1", "4", null])
      });
      const supplierReturn = await receivedDocument(TENANT_A, {
        mode: "supplier_return",
        supplierId: supA,
        locationId: locA,
        sourceLocationId: null,
        externalReference: null,
        documentDate: null,
        notes: null,
        currencyCode: "IDR",
        lines: lines(["all-1", "1", "1"])
      });

      for (const id of [transfer, supplierReturn]) {
        const outcome = await inTenant(TENANT_A, (tx) =>
          reverseDocument(
            tx,
            inventoryLedgerPortAdapter,
            TENANT_A,
            id,
            actorOf(TENANT_A),
            "recalled"
          )
        );
        expect(outcome.outcome).toBe("ok");
      }

      const report = await inTenant(TENANT_A, (tx) =>
        reconcileDocuments(tx, TENANT_A, null)
      );
      expect(report).toMatchObject({
        reconciled: true,
        documentsChecked: 3,
        unlinkedLedgerMovements: 0
      });
      // receive(post) + 2 reversed docs x (post + reversal).
      expect(report.linesChecked).toBe(5);
    });

    test("reconciliation is tenant-scoped", async () => {
      await receivedDocument(
        TENANT_A,
        receive(supA, locA, [["ts-1", "1", "1"]])
      );

      const other = await inTenant(TENANT_B, (tx) =>
        reconcileDocuments(tx, TENANT_B, null)
      );

      expect(other).toMatchObject({
        reconciled: true,
        documentsChecked: 0,
        linesChecked: 0
      });
    });
  });

  describe("the reporting projections", () => {
    test("both procurement projections count the lifecycle events, reconcile, and awcms_worker can read their source but not write it", async () => {
      const keys = collectProjectionDescriptors(listModules())
        .filter((d) => d.key.startsWith("procurement."))
        .map((d) => d.key)
        .sort();
      expect(keys).toEqual(["procurement.receiving", "procurement.suppliers"]);

      const received = await receivedDocument(
        TENANT_A,
        receive(supA, locA, [["pj-1", "5", "1"]])
      );
      await receivedDocument(
        TENANT_A,
        receive(supA, locA, [["pj-2", "5", "1"]])
      );
      await inTenant(TENANT_A, (tx) =>
        reverseDocument(
          tx,
          inventoryLedgerPortAdapter,
          TENANT_A,
          received,
          actorOf(TENANT_A),
          "recalled"
        )
      );
      const toCancel = await inTenant(TENANT_A, async (tx) => {
        const created = await createDocument(
          tx,
          TENANT_A,
          actorOf(TENANT_A),
          receive(supA, locA, [["pj-3", "1", "1"]])
        );

        return (created as { document: { id: string } }).document.id;
      });
      await inTenant(TENANT_A, (tx) =>
        cancelDocument(
          tx,
          TENANT_A,
          toCancel,
          actorOf(TENANT_A),
          "ordered twice"
        )
      );

      const descriptors = collectProjectionDescriptors(listModules()).filter(
        (d) => d.key.startsWith("procurement.")
      );
      const previous = process.env.REPORTING_PROJECTION_LAG_SECONDS;
      process.env.REPORTING_PROJECTION_LAG_SECONDS = "0";

      try {
        await new Promise((resolve) => setTimeout(resolve, 10));

        for (const descriptor of descriptors) {
          const outcome = await runIncrementalUpdateForTenant(
            getWorkerRoleSql(),
            descriptor,
            TENANT_A
          );

          expect(outcome.failed).toBe(false);
          expect(outcome.rowsProcessed).toBeGreaterThan(0);
        }
      } finally {
        if (previous === undefined) {
          delete process.env.REPORTING_PROJECTION_LAG_SECONDS;
        } else {
          process.env.REPORTING_PROJECTION_LAG_SECONDS = previous;
        }
      }

      const receiving = await inTenant(TENANT_A, (tx) =>
        getProjectionMetrics(tx, TENANT_A, "procurement.receiving")
      );
      const suppliers = await inTenant(TENANT_A, (tx) =>
        getProjectionMetrics(tx, TENANT_A, "procurement.suppliers")
      );

      expect(receiving.receipts_finalised).toBe(2);
      expect(receiving.documents_reversed).toBe(1);
      expect(receiving.documents_cancelled).toBe(1);
      expect(suppliers.supplier_documents_finalised).toBe(2);
      expect(suppliers.supplier_documents_reversed).toBe(1);
      expect(suppliers.supplier_documents_cancelled).toBe(1);

      for (const descriptor of descriptors) {
        const run = await inTenant(TENANT_A, (tx) =>
          reconcileProjection(tx, TENANT_A, descriptor, null)
        );

        expect(run.mismatch).toBe(false);
      }

      await getWorkerRoleSql()`
        SELECT count(*) FROM awcms_procurement_document_events
      `;
      await assertRejected(
        getWorkerRoleSql()`
          DELETE FROM awcms_procurement_document_events
        `,
        /permission denied|42501/i
      );
    });
  });

  test("the detail read shows lines, snapshots and the ledger links of a finalised document", async () => {
    const id = await receivedDocument(
      TENANT_A,
      receive(supA, locA, [["dt-1", "2", "3.5"]])
    );

    const detail = await inTenant(TENANT_A, (tx) =>
      getDocument(tx, TENANT_A, id)
    );

    expect(detail).toMatchObject({
      status: "finalised",
      totalCost: "7",
      supplier: { code: "ACME", name: "Supplier ACME" },
      lines: [{ lineNo: 1, quantity: "2", unitCost: "3.5", lineTotal: "7" }]
    });
    expect(detail!.movements).toHaveLength(1);
  });
});
