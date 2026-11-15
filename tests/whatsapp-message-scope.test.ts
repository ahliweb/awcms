/**
 * `resolveMessageScopeKeys` decision half (Issue #1265, audit L1): a channel
 * module that cannot be loaded is a DENIAL (empty list), never "unconfined"
 * (`null`). Pure — the loader is injected.
 */
import { describe, expect, test } from "bun:test";

import { resolveMessageScopeKeys } from "../src/modules/whatsapp-delivery/application/whatsapp-message-scope";
import type {
  SenderAccess,
  SenderAccessContext,
  SenderAccessGuard
} from "../src/modules/whatsapp-delivery/infrastructure/channel-account-access-loader";

const context = {} as SenderAccessContext;
const guard: SenderAccessGuard = {
  moduleKey: "whatsapp_delivery",
  activityCode: "messages",
  action: "read"
};

function access(confined: boolean): SenderAccess {
  return {
    isConfined: async () => confined,
    coveredScopes: async () => [{ type: "brand", id: "A" }]
  } as unknown as SenderAccess;
}

describe("resolveMessageScopeKeys", () => {
  test("an unloadable channel module is a denial: no row at all, never unconfined", async () => {
    expect(
      await resolveMessageScopeKeys(context, guard, async () => null)
    ).toEqual([]);
  });

  test("an unconfined caller sees every row (null)", async () => {
    expect(
      await resolveMessageScopeKeys(context, guard, async () => access(false))
    ).toBeNull();
  });

  test("a confined caller gets exactly the scopes it holds", async () => {
    expect(
      await resolveMessageScopeKeys(context, guard, async () => access(true))
    ).toEqual(["brand:A"]);
  });
});
