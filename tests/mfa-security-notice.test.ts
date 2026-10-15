import { describe, expect, test } from "bun:test";

import {
  maskIpForNotice,
  notifyMfaChange
} from "../src/modules/identity-access/application/mfa-security-notice";

describe("maskIpForNotice (#1004)", () => {
  test("coarsens IPv4 and IPv6, never echoing a full address", () => {
    expect(maskIpForNotice("203.0.113.42")).toBe("203.0.113.x");
    expect(maskIpForNotice("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe(
      "2001:db8:85a3::"
    );
    expect(maskIpForNotice("not-an-ip")).toBe("unknown");
  });

  test("handles IPv4-mapped, compressed and zoned IPv6", () => {
    expect(maskIpForNotice("::ffff:203.0.113.42")).toBe("203.0.113.x");
    expect(maskIpForNotice("::FFFF:203.0.113.42")).toBe("203.0.113.x");
    // Compressed and expanded spellings give the same answer.
    expect(maskIpForNotice("2001:db8::1")).toBe("2001:db8:0::");
    expect(maskIpForNotice("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe(
      "2001:db8:0::"
    );
    expect(maskIpForNotice("fe80::1%eth0")).toBe("fe80:0:0::");
    expect(maskIpForNotice("::1")).toBe("0:0:0::");
    expect(maskIpForNotice("1:2:3:4:5:6:7:8:9")).toBe("unknown");
    expect(maskIpForNotice("2001:db8::zz")).toBe("unknown");
  });
});

describe("notifyMfaChange (#1004)", () => {
  test("goes through the auth notification port with the security notice template", async () => {
    const calls: unknown[] = [];
    const tx = (async () => [{ id: "tu-1" }]) as unknown as Bun.SQL;
    const result = await notifyMfaChange(tx, {
      tenantId: "t",
      identityId: "i",
      kind: "enrolled",
      notifications: {
        async enqueueAuthNotification(_tx, request) {
          calls.push(request);
          return { enqueued: true };
        },
        async enqueueAuthAddressNotification() {
          return { enqueued: false };
        }
      },
      occurredAt: new Date("2026-10-15T00:00:00Z"),
      clientIp: "203.0.113.42"
    });

    expect(result.delivered).toBe(true);
    const request = calls[0] as {
      templateKey: string;
      recipientTenantUserId: string;
      variables: Record<string, string>;
    };
    expect(request.templateKey).toBe("system.security_notice");
    expect(request.recipientTenantUserId).toBe("tu-1");
    expect(request.variables.ipAddress).toBe("203.0.113.x");
  });
});
