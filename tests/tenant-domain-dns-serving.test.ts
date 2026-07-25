/**
 * Serving-record reconciliation for platform subdomains.
 *
 * The adapter tests run against a local fake standing in for the Cloudflare API
 * (`baseUrl` override), because the interesting behaviour is which HTTP verb is
 * chosen: creating a second record where one should have been moved is the bug
 * that splits a tenant's traffic between the old and new target.
 */
import { afterAll, describe, expect, test } from "bun:test";

import {
  createCloudflareDnsProvider,
  validateServingRecordInput
} from "../src/modules/tenant-domain/infrastructure/cloudflare-dns-adapter";
import {
  reconcileServingRecords,
  resolveServingTarget,
  type ServingDomainRow
} from "../src/modules/tenant-domain/application/dns-serving-reconciler";

const ROOT = "platform.example";

describe("validateServingRecordInput", () => {
  test("accepts an A record for a subdomain of the platform root", () => {
    expect(
      validateServingRecordInput(
        {
          recordType: "A",
          recordName: `acme.${ROOT}`,
          recordValue: "203.0.113.10"
        },
        ROOT
      )
    ).toBeNull();
  });

  test("accepts a CNAME to a hostname", () => {
    expect(
      validateServingRecordInput(
        {
          recordType: "CNAME",
          recordName: `acme.${ROOT}`,
          recordValue: "ingress.example.com"
        },
        ROOT
      )
    ).toBeNull();
  });

  test("refuses a hostname outside the managed zone", () => {
    // The platform's Cloudflare token must never be induced to write a record
    // for a name the platform does not own.
    expect(
      validateServingRecordInput(
        {
          recordType: "A",
          recordName: "victim.example.org",
          recordValue: "203.0.113.10"
        },
        ROOT
      )
    ).toContain("root domain");
  });

  test.each([
    ["1.2.3"],
    ["1.2.3.4.5"],
    ["1.2.3.256"],
    ["1.2.3.4abc"],
    ["01.2.3.4"],
    ["not-an-ip"],
    [""]
  ])("rejects %p as an A record value", (value) => {
    expect(
      validateServingRecordInput(
        { recordType: "A", recordName: `acme.${ROOT}`, recordValue: value },
        ROOT
      )
    ).toBeTruthy();
  });

  test("rejects a value containing a newline", () => {
    expect(
      validateServingRecordInput(
        {
          recordType: "CNAME",
          recordName: `acme.${ROOT}`,
          recordValue: "ok.example.com\nmalicious"
        },
        ROOT
      )
    ).toBeTruthy();
  });

  test("rejects an unsupported record type", () => {
    expect(
      validateServingRecordInput(
        { recordType: "TXT", recordName: `acme.${ROOT}`, recordValue: "x" },
        ROOT
      )
    ).toContain("recordType");
  });
});

describe("resolveServingTarget", () => {
  test("returns null when unset — the job must not guess a target", () => {
    expect(resolveServingTarget({})).toBeNull();
  });

  test("defaults to a proxied CNAME", () => {
    expect(
      resolveServingTarget({
        TENANT_DOMAIN_SERVING_TARGET: "ingress.example.com"
      })
    ).toEqual({
      recordType: "CNAME",
      value: "ingress.example.com",
      proxied: true
    });
  });

  test("honours an explicit A record and proxied=false", () => {
    expect(
      resolveServingTarget({
        TENANT_DOMAIN_SERVING_TARGET: "203.0.113.10",
        TENANT_DOMAIN_SERVING_RECORD_TYPE: "a",
        TENANT_DOMAIN_SERVING_PROXIED: "false"
      })
    ).toEqual({ recordType: "A", value: "203.0.113.10", proxied: false });
  });
});

describe("reconcileServingRecords", () => {
  const rows: ServingDomainRow[] = [
    { id: "1", tenant_id: "t1", normalized_hostname: `a.${ROOT}` },
    { id: "2", tenant_id: "t2", normalized_hostname: `b.${ROOT}` },
    { id: "3", tenant_id: "t3", normalized_hostname: `c.${ROOT}` }
  ];

  const target = {
    recordType: "CNAME" as const,
    value: "ingress.example.com",
    proxied: true
  };

  test("one failure does not abort the rest of the pass", async () => {
    // A single hostname Cloudflare rejects must not leave every other tenant's
    // subdomain unfixed.
    const provider = {
      createVerificationRecord: async () => ({
        ok: false as const,
        error: "n/a",
        retryable: false
      }),
      checkVerificationStatus: async () => ({
        ok: false as const,
        error: "n/a",
        retryable: false
      }),
      ensureServingRecord: async (input: { recordName: string }) =>
        input.recordName === `b.${ROOT}`
          ? { ok: false as const, error: "boom", retryable: true }
          : { ok: true as const, action: "created" as const }
    };

    const summary = await reconcileServingRecords(rows, provider, target);

    expect(summary.created).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.outcomes).toHaveLength(3);
    expect(
      summary.outcomes.find((o) => o.hostname === `b.${ROOT}`)
    ).toMatchObject({ status: "failed", retryable: true });
  });
});

describe("ensureServingRecord against a fake Cloudflare API", () => {
  type FakeRecord = {
    id: string;
    type: string;
    name: string;
    content: string;
    proxied: boolean;
  };

  let store: FakeRecord[] = [];
  const calls: string[] = [];

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      calls.push(`${request.method} ${url.pathname}`);

      if (request.method === "GET") {
        const name = url.searchParams.get("name");
        const type = url.searchParams.get("type");

        return Response.json({
          success: true,
          errors: [],
          result: store.filter((r) => r.name === name && r.type === type)
        });
      }

      const body = (await request.json()) as Omit<FakeRecord, "id">;

      if (request.method === "POST") {
        const created = { ...body, id: `rec-${store.length + 1}` };
        store.push(created);

        return Response.json({ success: true, errors: [], result: created });
      }

      if (request.method === "PUT") {
        const id = url.pathname.split("/").pop()!;
        const index = store.findIndex((r) => r.id === id);
        store[index] = { ...body, id };

        return Response.json({
          success: true,
          errors: [],
          result: store[index]
        });
      }

      return Response.json(
        { success: false, errors: [{ code: 1, message: "x" }] },
        { status: 405 }
      );
    }
  });

  afterAll(() => server.stop(true));

  function provider() {
    return createCloudflareDnsProvider({
      zoneId: "zone1",
      apiToken: "token1",
      platformRootDomain: ROOT,
      baseUrl: `http://127.0.0.1:${server.port}`
    });
  }

  test("creates, then reports unchanged, then updates in place on drift", async () => {
    store = [];
    calls.length = 0;

    const first = await provider().ensureServingRecord({
      recordType: "CNAME",
      recordName: `acme.${ROOT}`,
      recordValue: "ingress.example.com"
    });

    expect(first).toMatchObject({ ok: true, action: "created" });
    expect(store).toHaveLength(1);
    expect(store[0]!.proxied).toBe(true);

    const second = await provider().ensureServingRecord({
      recordType: "CNAME",
      recordName: `acme.${ROOT}`,
      recordValue: "ingress.example.com"
    });

    expect(second).toMatchObject({ ok: true, action: "unchanged" });
    expect(store).toHaveLength(1);

    const third = await provider().ensureServingRecord({
      recordType: "CNAME",
      recordName: `acme.${ROOT}`,
      recordValue: "new-ingress.example.com"
    });

    // The load-bearing assertion: still ONE record. Creating a second would
    // round-robin the tenant between the old and new target.
    expect(third).toMatchObject({ ok: true, action: "updated" });
    expect(store).toHaveLength(1);
    expect(store[0]!.content).toBe("new-ingress.example.com");
    expect(calls.some((c) => c.startsWith("PUT"))).toBe(true);
  });

  test("a trailing dot or different case is not treated as drift", async () => {
    store = [
      {
        id: "rec-1",
        type: "CNAME",
        name: `x.${ROOT}`,
        content: "Ingress.Example.com.",
        proxied: true
      }
    ];

    const result = await provider().ensureServingRecord({
      recordType: "CNAME",
      recordName: `x.${ROOT}`,
      recordValue: "ingress.example.com"
    });

    expect(result).toMatchObject({ ok: true, action: "unchanged" });
  });

  test("a proxied-flag change alone is enough to trigger an update", async () => {
    store = [
      {
        id: "rec-1",
        type: "A",
        name: `y.${ROOT}`,
        content: "203.0.113.10",
        proxied: false
      }
    ];

    const result = await provider().ensureServingRecord({
      recordType: "A",
      recordName: `y.${ROOT}`,
      recordValue: "203.0.113.10",
      proxied: true
    });

    expect(result).toMatchObject({ ok: true, action: "updated" });
    expect(store[0]!.proxied).toBe(true);
  });

  test("an invalid hostname never reaches the network", async () => {
    store = [];
    calls.length = 0;

    const result = await provider().ensureServingRecord({
      recordType: "A",
      recordName: "victim.example.org",
      recordValue: "203.0.113.10"
    });

    expect(result).toMatchObject({ ok: false, retryable: false });
    expect(calls).toHaveLength(0);
  });
});
