/**
 * The pure model behind the `/admin/website-engagement/sources` form (Issue
 * #1477, ADR-0155): request bodies, the challenge-off guard and the one-time
 * token holder. No DOM, no network.
 */
import { describe, expect, test } from "bun:test";

import {
  buildCreateBody,
  buildUpdateBody,
  createTokenHolder,
  disablesChallenge,
  readTokenOutcome,
  type SourceEditSnapshot
} from "../src/lib/ui/website-engagement-sources-model";

const before: SourceEditSnapshot = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "main",
  name: "Main",
  status: "active",
  consentCopyVersion: "v1",
  challengeMode: "turnstile",
  acceptedKinds: ["contact", "lead"],
  domainIds: ["b", "a"]
};
const same = {
  name: "Main",
  consentCopyVersion: "v1",
  challengeMode: "turnstile" as const,
  acceptedKinds: ["lead", "contact"] as ("contact" | "lead")[],
  domainIds: ["a", "b"]
};

describe("request bodies", () => {
  test("create sends exactly the API's keys, trimmed and ordered", () => {
    const body = buildCreateBody({
      code: " main ",
      name: " Main ",
      consentCopyVersion: " v1 ",
      challengeMode: "turnstile",
      acceptedKinds: ["lead", "contact"],
      domainIds: ["b", "a"]
    });

    expect(Object.keys(body).sort()).toEqual([
      "acceptedKinds",
      "challengeMode",
      "code",
      "consentCopyVersion",
      "domainIds",
      "name"
    ]);
    expect(body.code).toBe("main");
    expect(body.acceptedKinds).toEqual(["contact", "lead"]);
    expect(body.domainIds).toEqual(["a", "b"]);
  });

  test("edit sends only what changed, and an unchanged form sends nothing", () => {
    expect(buildUpdateBody(before, same)).toEqual({});
    expect(buildUpdateBody(before, { ...same, name: "Renamed" })).toEqual({
      name: "Renamed"
    });
    expect(buildUpdateBody(before, { ...same, domainIds: ["a"] })).toEqual({
      domainIds: ["a"]
    });
    expect(buildUpdateBody(before, { ...same, challengeMode: "none" })).toEqual(
      { challengeMode: "none" }
    );
    // The code is not editable: it never appears in an update.
    expect(Object.keys(buildUpdateBody(before, same))).not.toContain("code");
  });

  test("switching the challenge off is flagged only when it is a change to 'none'", () => {
    expect(disablesChallenge({ challengeMode: "none" })).toBe(true);
    expect(disablesChallenge({ challengeMode: "none" }, before)).toBe(true);
    expect(
      disablesChallenge(
        { challengeMode: "none" },
        { challengeMode: "none" as const }
      )
    ).toBe(false);
    expect(disablesChallenge({ challengeMode: "turnstile" })).toBe(false);
    expect(disablesChallenge({})).toBe(false);
  });
});

describe("token outcome", () => {
  test("only revealed:true with a token is a token; a replay is never a guess", () => {
    expect(readTokenOutcome({ revealed: true, token: "wes1.x" })).toEqual({
      kind: "token",
      token: "wes1.x"
    });
    expect(readTokenOutcome({ revealed: false })).toEqual({ kind: "replayed" });
    expect(readTokenOutcome({ revealed: true })).toEqual({ kind: "none" });
    expect(readTokenOutcome({ revealed: true, token: "" })).toEqual({
      kind: "none"
    });
    expect(readTokenOutcome({ token: "wes1.x" })).toEqual({ kind: "none" });
    expect(readTokenOutcome(null)).toEqual({ kind: "none" });
  });
});

describe("the one-time token holder", () => {
  function sink() {
    const state = { text: "", shown: 0, cleared: 0 };

    return {
      state,
      port: {
        show(text: string) {
          state.text = text;
          state.shown += 1;
        },
        clear() {
          state.text = "";
          state.cleared += 1;
        }
      }
    };
  }

  test("show puts the token in the sink and clear removes every trace", () => {
    const { state, port } = sink();
    const holder = createTokenHolder(port);

    holder.show("wes1.secret");
    expect(state.text).toBe("wes1.secret");
    expect(holder.isHeld()).toBe(true);

    holder.clear();
    expect(state.text).toBe("");
    expect(holder.isHeld()).toBe(false);
  });

  test("a second token replaces the first and the holder keeps nothing of its own", () => {
    const { state, port } = sink();
    const holder = createTokenHolder(port);

    holder.show("first-token");
    holder.show("second-token");
    expect(state.text).toBe("second-token");

    holder.clear();
    expect(JSON.stringify(holder)).not.toContain("token");
    expect(state.text).not.toContain("token");
  });

  test("clear on an empty holder still clears the sink (pagehide, bfcache)", () => {
    const { state, port } = sink();

    createTokenHolder(port).clear();
    expect(state.cleared).toBe(1);
  });
});
