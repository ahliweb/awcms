/**
 * g05 regressions: a handoff code must die with the session that issued it.
 * The claim UPDATE has to require the issuing session to be live (not revoked,
 * not expired) and credential-current, otherwise a code minted before logout
 * or a password reset still mints a fresh session within its 60s life.
 *
 * Pure: recording fake tx, no database.
 */
import { describe, expect, test } from "bun:test";
import { SESSION_EPOCH_FRAGMENT_MARKER } from "../src/modules/identity-access/application/session-credential-epoch";
import { redeemHandoffCode } from "../src/modules/identity-access/application/session-handoff-directory";

type Call = { sql: string; values: unknown[] };

function recordingTx(responses: unknown[][]) {
  const calls: Call[] = [];
  let index = 0;
  const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join(" ? ");
    if (sql.includes(SESSION_EPOCH_FRAGMENT_MARKER)) return { sql, values };
    calls.push({ sql, values });
    return Promise.resolve(responses[index++] ?? []);
  }) as unknown as Bun.SQL;
  return { tx, calls };
}

const NOW = new Date("2026-08-10T00:00:00.000Z");
const CLIENT = {
  id: "client-1",
  clientKey: "bff",
  name: "BFF",
  redirectUris: ["https://app/cb"]
};

describe("redeemHandoffCode issuing-session liveness (g05)", () => {
  test("claim is conditional on a live, credential-current issuing session; refusal is invalid", async () => {
    const { tx, calls } = recordingTx([
      [
        {
          id: "code-1",
          client_id: "client-1",
          redirect_uri: "https://app/cb",
          expires_at: new Date(NOW.getTime() + 30_000),
          redeemed_at: null
        }
      ],
      [] // claim refused: issuing session revoked / expired / epoch-stale
    ]);

    const result = await redeemHandoffCode(tx, "tenant-1", {
      code: "some-code",
      client: CLIENT,
      redirectUri: "https://app/cb",
      sessionTtlMinutes: 60,
      now: NOW
    });

    expect(result.ok).toBe(false);
    // No session minted, no further statements.
    expect(calls).toHaveLength(2);

    const claim = calls[1]!;
    expect(claim.sql).toContain("UPDATE awcms_session_handoff_codes");
    expect(claim.sql).toContain("awcms_sessions s");
    expect(claim.sql).toContain("issued_by_session_id");
    expect(claim.sql).toContain("s.revoked_at IS NULL");
    expect(claim.sql).toContain("s.expires_at >");
    const fragment = claim.values.find(
      (v) =>
        typeof v === "object" &&
        v !== null &&
        String((v as Call).sql).includes(SESSION_EPOCH_FRAGMENT_MARKER)
    );
    expect(fragment).toBeDefined();
  });
});
