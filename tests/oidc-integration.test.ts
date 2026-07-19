/**
 * Real-PostgreSQL + fake-local-OIDC-provider integration tests for tenant SSO
 * (Issue #185). NO real internet IdP: a `Bun.serve` in-process provider serves
 * discovery/JWKS/token, and every key/secret is generated at RUNTIME (nothing
 * hardcoded — a static key/secret would trip GitGuardian). Gated on
 * `DATABASE_URL` (same convention as `mfa-integration.test.ts`); runs in the
 * dedicated legacy `bun test <files>` step, not the `tests/integration/` harness.
 *
 * The fake provider is reached only via the explicit
 * `AUTH_SSO_ALLOW_INSECURE_HOSTS` escape hatch (loopback http), never a public
 * address; a separate SSRF test proves a private/metadata issuer is refused.
 *
 * MUTATION PROOFS (repo security discipline):
 *  - Drop the `iss !== options.expectedIssuer` check in `oidc-policy.ts`'s
 *    `validateIdTokenClaims` → "rejects a wrong-issuer ID token" goes GREEN
 *    (should stay RED-on-mutation, i.e. the assertion fails).
 *  - Drop the `aud` membership check → "rejects a wrong-audience ID token"
 *    stops rejecting.
 *  - Drop the `AND provider_id = ${providerId}` / tenant predicate from
 *    `consumeSsoOAuthRequest` → "cross-tenant state substitution is denied"
 *    stops denying.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";

import {
  createSsoOAuthRequest,
  completeTenantSsoCallback
} from "../src/modules/identity-access/application/tenant-sso";
import { createAuthProvider } from "../src/modules/identity-access/application/auth-provider-directory";
import {
  getTenantAuthPolicy,
  isPasswordLoginDisabledForIdentity,
  saveTenantAuthPolicy
} from "../src/modules/identity-access/application/tenant-auth-policy";
import { buildOAuthStateParam } from "../src/lib/auth/oauth-state-token";
import {
  discoverOidcConfiguration,
  resetGenericOidcCachesForTests
} from "../src/lib/auth/generic-oidc-client";

const DATABASE_URL =
  process.env.SSO_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeOrSkip = DATABASE_URL ? describe : describe.skip;

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
function seg(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

type Signer = {
  kid: string;
  jwk: Record<string, unknown>;
  sign(claims: Record<string, unknown>): Promise<string>;
  signWith(
    header: Record<string, unknown>,
    claims: Record<string, unknown>
  ): Promise<string>;
};

async function makeSigner(kid: string): Promise<Signer> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as Record<
    string,
    unknown
  >;
  jwk.kid = kid;
  jwk.alg = "RS256";
  jwk.use = "sig";

  async function signWith(
    header: Record<string, unknown>,
    claims: Record<string, unknown>
  ): Promise<string> {
    const input = `${seg(header)}.${seg(claims)}`;
    const sig = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      pair.privateKey,
      new TextEncoder().encode(input)
    );
    return `${input}.${b64url(new Uint8Array(sig))}`;
  }

  return {
    kid,
    jwk,
    signWith,
    sign: (claims) => signWith({ alg: "RS256", kid, typ: "JWT" }, claims)
  };
}

describeOrSkip("tenant SSO (real PostgreSQL + fake OIDC provider)", () => {
  let sql: Bun.SQL;
  const createdTenantIds: string[] = [];

  // Fake IdP state (mutated per test).
  let server: ReturnType<typeof Bun.serve>;
  let issuer: string;
  let signer1: Signer;
  let signer2: Signer;
  let jwksKeys: Record<string, unknown>[];
  let currentIdToken: string;

  const CLIENT_ID = "client-" + randomBytes(4).toString("hex");
  const ENC_KEY = randomBytes(32).toString("base64");

  function env(
    overrides: Record<string, string | undefined> = {}
  ): NodeJS.ProcessEnv {
    return {
      ...process.env,
      AUTH_SSO_ENABLED: "true",
      AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY: ENC_KEY,
      AUTH_SSO_ALLOW_INSECURE_HOSTS: new URL(issuer).host,
      APP_URL: "http://localhost:4321",
      ...overrides
    } as NodeJS.ProcessEnv;
  }

  beforeAll(async () => {
    sql = new Bun.SQL(DATABASE_URL!, { max: 6 });
    signer1 = await makeSigner("k1");
    signer2 = await makeSigner("k2");
    jwksKeys = [signer1.jwk];
    currentIdToken = "";

    server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/.well-known/openid-configuration") {
          return Response.json({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/jwks`
          });
        }
        if (url.pathname === "/jwks") {
          return Response.json({ keys: jwksKeys });
        }
        if (url.pathname === "/token") {
          return Response.json({ id_token: currentIdToken });
        }
        return new Response("not found", { status: 404 });
      }
    });
    issuer = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    server.stop(true);
    for (const tenantId of createdTenantIds) {
      await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
      await sql`DELETE FROM awcms_oidc_auth_requests WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_external_identities WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_tenant_auth_policies WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_auth_providers WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_sessions WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_tenant_users WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_identities WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_profiles WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_tenants WHERE id = ${tenantId}`;
    }
    await sql.close({ timeout: 5 });
  });

  function tx<T>(tenantId: string, cb: (t: Bun.SQL) => Promise<T>): Promise<T> {
    return sql.begin(async (t) => {
      await t`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      return cb(t);
    }) as Promise<T>;
  }

  async function createTenant(): Promise<string> {
    const suffix = randomBytes(4).toString("hex");
    const rows = (await sql`
      INSERT INTO awcms_tenants (tenant_code, tenant_name)
      VALUES (${`sso-${suffix}`}, ${"SSO test"})
      RETURNING id
    `) as { id: string }[];
    const tenantId = rows[0]!.id;
    createdTenantIds.push(tenantId);
    await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
    return tenantId;
  }

  async function createIdentity(
    tenantId: string,
    email: string
  ): Promise<{ identityId: string; tenantUserId: string }> {
    const profile = (await sql`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${tenantId}, 'person', ${email}) RETURNING id
    `) as { id: string }[];
    const identity = (await sql`
      INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${tenantId}, ${profile[0]!.id}, ${email}, 'x') RETURNING id
    `) as { id: string }[];
    const tu = (await sql`
      INSERT INTO awcms_tenant_users (tenant_id, identity_id, status)
      VALUES (${tenantId}, ${identity[0]!.id}, 'active') RETURNING id
    `) as { id: string }[];
    return { identityId: identity[0]!.id, tenantUserId: tu[0]!.id };
  }

  async function createProvider(
    tenantId: string,
    tenantUserId: string,
    providerKey: string
  ): Promise<string> {
    const result = await tx(tenantId, (t) =>
      createAuthProvider(
        t,
        tenantId,
        tenantUserId,
        {
          providerKey,
          displayName: "Fake IdP",
          issuerUrl: issuer,
          clientId: CLIENT_ID,
          clientSecret: "secret-" + randomBytes(6).toString("hex"),
          clientSecretEnvVar: null,
          scopes: "openid email profile",
          allowedEmailDomains: [],
          enabled: true
        },
        env()
      )
    );
    if (result.outcome !== "created") {
      throw new Error(`provider create failed: ${result.outcome}`);
    }
    return result.provider.id;
  }

  function idTokenClaims(
    sub: string,
    nonce: string,
    email: string,
    over: Record<string, unknown> = {}
  ): Record<string, unknown> {
    const nowSec = Math.floor(Date.now() / 1000);
    return {
      iss: issuer,
      aud: CLIENT_ID,
      sub,
      exp: nowSec + 300,
      iat: nowSec - 5,
      nonce,
      email,
      email_verified: true,
      ...over
    };
  }

  async function startRequest(
    tenantId: string,
    providerId: string,
    purpose: "login" | "link",
    identityId: string | null
  ): Promise<{ state: string; nonce: string; stateParam: string }> {
    const { state, nonce } = await tx(tenantId, (t) =>
      createSsoOAuthRequest(t, {
        tenantId,
        providerId,
        purpose,
        identityId,
        redirectAfter: null,
        ttlSec: 600,
        now: new Date()
      })
    );
    return { state, nonce, stateParam: buildOAuthStateParam(tenantId, state) };
  }

  test("explicit link then login yields an opaque session bound to the identity", async () => {
    resetGenericOidcCachesForTests();
    const tenantId = await createTenant();
    const { identityId, tenantUserId } = await createIdentity(
      tenantId,
      "alice@corp.example"
    );
    const providerId = await createProvider(tenantId, tenantUserId, "okta");
    const subject = "sub-" + randomBytes(6).toString("hex");

    // 1. LINK (authenticated purpose) — establishes the external identity.
    const link = await startRequest(tenantId, providerId, "link", identityId);
    currentIdToken = await signer1.sign(
      idTokenClaims(subject, link.nonce, "alice@corp.example")
    );
    const linkResult = await completeTenantSsoCallback(
      sql,
      "okta",
      link.stateParam,
      "auth-code",
      env(),
      new Date()
    );
    expect(linkResult.outcome).toBe("linked");

    const links = (await sql`
      SELECT identity_id, issuer, subject FROM awcms_external_identities
      WHERE tenant_id = ${tenantId} AND provider_id = ${providerId}
    `) as { identity_id: string; issuer: string; subject: string }[];
    expect(links).toHaveLength(1);
    expect(links[0]!.identity_id).toBe(identityId);
    expect(links[0]!.subject).toBe(subject);

    // 2. LOGIN — the existing link resolves to a session_ready outcome.
    const login = await startRequest(tenantId, providerId, "login", null);
    currentIdToken = await signer1.sign(
      idTokenClaims(subject, login.nonce, "alice@corp.example")
    );
    const loginResult = await completeTenantSsoCallback(
      sql,
      "okta",
      login.stateParam,
      "auth-code",
      env(),
      new Date()
    );
    expect(loginResult.outcome).toBe("session_ready");
    if (loginResult.outcome === "session_ready") {
      expect(loginResult.identityId).toBe(identityId);
      expect(loginResult.provisioned).toBe(false);
    }
  });

  test("two concurrent provider creates with the same key yield exactly one created + one duplicate (never 500)", async () => {
    const tenantId = await createTenant();
    const { tenantUserId } = await createIdentity(
      tenantId,
      "conc@corp.example"
    );
    const providerKey = "race-" + randomBytes(4).toString("hex");

    const input = {
      providerKey,
      displayName: "Race IdP",
      issuerUrl: issuer,
      clientId: CLIENT_ID,
      clientSecret: "secret-" + randomBytes(6).toString("hex"),
      clientSecretEnvVar: null,
      scopes: "openid email profile",
      allowedEmailDomains: [] as string[],
      enabled: true
    };

    // Two truly concurrent transactions (separate pool connections) racing the
    // same partial-unique key. The loser's INSERT raises 23505, which is caught
    // INSIDE createAuthProvider and mapped to duplicate_key — never an
    // unhandled throw (which would surface as a 500). MUTATION: removing that
    // catch makes one of these settle as "rejected" and this test RED.
    const settled = await Promise.allSettled([
      tx(tenantId, (t) =>
        createAuthProvider(t, tenantId, tenantUserId, input, env())
      ),
      tx(tenantId, (t) =>
        createAuthProvider(t, tenantId, tenantUserId, input, env())
      )
    ]);

    expect(settled.every((r) => r.status === "fulfilled")).toBe(true);
    const outcomes = settled.map((r) =>
      r.status === "fulfilled" ? r.value.outcome : `REJECTED`
    );
    expect(outcomes.filter((o) => o === "created")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "duplicate_key")).toHaveLength(1);

    const persisted = (await sql`
      SELECT count(*)::int AS n FROM awcms_auth_providers
      WHERE tenant_id = ${tenantId} AND provider_key = ${providerKey} AND deleted_at IS NULL
    `) as { n: number }[];
    expect(persisted[0]!.n).toBe(1);
  });

  test("a re-link with the same subject is refused (SSO_ALREADY_LINKED)", async () => {
    resetGenericOidcCachesForTests();
    const tenantId = await createTenant();
    const { identityId, tenantUserId } = await createIdentity(
      tenantId,
      "bob@corp.example"
    );
    const providerId = await createProvider(tenantId, tenantUserId, "okta");
    const subject = "sub-" + randomBytes(6).toString("hex");

    for (let i = 0; i < 2; i += 1) {
      const link = await startRequest(tenantId, providerId, "link", identityId);
      currentIdToken = await signer1.sign(
        idTokenClaims(subject, link.nonce, "bob@corp.example")
      );
      const result = await completeTenantSsoCallback(
        sql,
        "okta",
        link.stateParam,
        "auth-code",
        env(),
        new Date()
      );
      if (i === 0) {
        expect(result.outcome).toBe("linked");
      } else {
        expect(result.outcome).toBe("error");
        if (result.outcome === "error") {
          expect(result.code).toBe("SSO_ALREADY_LINKED");
        }
      }
    }
  });

  test("cross-tenant state substitution is denied", async () => {
    resetGenericOidcCachesForTests();
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const a = await createIdentity(tenantA, "a@corp.example");
    const b = await createIdentity(tenantB, "b@corp.example");
    const providerA = await createProvider(tenantA, a.tenantUserId, "okta");
    await createProvider(tenantB, b.tenantUserId, "okta");

    // State minted in tenant A, but the attacker rewrites the tenant prefix to
    // tenant B and points the callback there.
    const start = await startRequest(tenantA, providerA, "login", null);
    const substituted = buildOAuthStateParam(tenantB, start.state);
    currentIdToken = await signer1.sign(
      idTokenClaims("sub-x", start.nonce, "a@corp.example")
    );

    const result = await completeTenantSsoCallback(
      sql,
      "okta",
      substituted,
      "auth-code",
      env(),
      new Date()
    );
    expect(result.outcome).toBe("error");
    if (result.outcome === "error") {
      expect(result.code).toBe("SSO_OAUTH_STATE_INVALID");
    }
  });

  test("rejects a wrong-nonce, wrong-issuer, wrong-audience, and tampered ID token", async () => {
    resetGenericOidcCachesForTests();
    const tenantId = await createTenant();
    const { identityId, tenantUserId } = await createIdentity(
      tenantId,
      "carol@corp.example"
    );
    const providerId = await createProvider(tenantId, tenantUserId, "okta");
    const subject = "sub-carol";

    // Pre-link so only the ID-token claim checks can fail the flow.
    const link = await startRequest(tenantId, providerId, "link", identityId);
    currentIdToken = await signer1.sign(
      idTokenClaims(subject, link.nonce, "carol@corp.example")
    );
    await completeTenantSsoCallback(
      sql,
      "okta",
      link.stateParam,
      "c",
      env(),
      new Date()
    );

    async function loginWith(
      claimsOver: (nonce: string) => Record<string, unknown>,
      sign: (claims: Record<string, unknown>) => Promise<string> = (c) =>
        signer1.sign(c)
    ): Promise<string> {
      const login = await startRequest(tenantId, providerId, "login", null);
      currentIdToken = await sign(claimsOver(login.nonce));
      const r = await completeTenantSsoCallback(
        sql,
        "okta",
        login.stateParam,
        "auth-code",
        env(),
        new Date()
      );
      return r.outcome === "error" ? r.code : r.outcome;
    }

    // wrong nonce
    expect(
      await loginWith(() =>
        idTokenClaims(subject, "not-the-nonce", "carol@corp.example")
      )
    ).toBe("SSO_ID_TOKEN_INVALID");
    // wrong issuer
    expect(
      await loginWith((nonce) =>
        idTokenClaims(subject, nonce, "carol@corp.example", {
          iss: "https://evil.example"
        })
      )
    ).toBe("SSO_ID_TOKEN_INVALID");
    // wrong audience
    expect(
      await loginWith((nonce) =>
        idTokenClaims(subject, nonce, "carol@corp.example", {
          aud: "another-client"
        })
      )
    ).toBe("SSO_ID_TOKEN_INVALID");
    // alg none (unsigned) — rejected by the allow-list
    expect(
      await loginWith(
        (nonce) => idTokenClaims(subject, nonce, "carol@corp.example"),
        (claims) => signer1.signWith({ alg: "none", typ: "JWT" }, claims)
      )
    ).toBe("SSO_ID_TOKEN_INVALID");
    // signed by an unknown key (kid not in JWKS)
    expect(
      await loginWith(
        (nonce) => idTokenClaims(subject, nonce, "carol@corp.example"),
        (claims) => signer2.sign(claims)
      )
    ).toBe("SSO_ID_TOKEN_INVALID");
  });

  test("JWKS rotation: a new kid fails until the cache is refreshed", async () => {
    resetGenericOidcCachesForTests();
    const tenantId = await createTenant();
    const { identityId, tenantUserId } = await createIdentity(
      tenantId,
      "dave@corp.example"
    );
    const providerId = await createProvider(tenantId, tenantUserId, "okta");
    const subject = "sub-dave";

    jwksKeys = [signer1.jwk];
    const link = await startRequest(tenantId, providerId, "link", identityId);
    currentIdToken = await signer1.sign(
      idTokenClaims(subject, link.nonce, "dave@corp.example")
    );
    expect(
      (
        await completeTenantSsoCallback(
          sql,
          "okta",
          link.stateParam,
          "c",
          env(),
          new Date()
        )
      ).outcome
    ).toBe("linked"); // caches discovery + JWKS (k1 only)

    // Provider rotates in a new key. The cached JWKS still lists only k1, so a
    // token signed by k2 cannot be verified yet.
    jwksKeys = [signer1.jwk, signer2.jwk];
    const login1 = await startRequest(tenantId, providerId, "login", null);
    currentIdToken = await signer2.sign(
      idTokenClaims(subject, login1.nonce, "dave@corp.example")
    );
    expect(
      (
        await completeTenantSsoCallback(
          sql,
          "okta",
          login1.stateParam,
          "c",
          env(),
          new Date()
        )
      ).outcome
    ).toBe("error");

    // After a cache refresh, the rotated key is picked up and the token verifies.
    resetGenericOidcCachesForTests();
    const login2 = await startRequest(tenantId, providerId, "login", null);
    currentIdToken = await signer2.sign(
      idTokenClaims(subject, login2.nonce, "dave@corp.example")
    );
    expect(
      (
        await completeTenantSsoCallback(
          sql,
          "okta",
          login2.stateParam,
          "c",
          env(),
          new Date()
        )
      ).outcome
    ).toBe("session_ready");
  });

  test("SSRF: discovery against a private/metadata issuer is refused", async () => {
    resetGenericOidcCachesForTests();
    const tenantId = await createTenant();
    // No allow-list entry for these hosts → HTTPS required + IP range blocked.
    const noAllow = { ...process.env } as NodeJS.ProcessEnv;
    for (const badIssuer of [
      "http://169.254.169.254",
      "https://10.0.0.1",
      "https://127.0.0.1"
    ]) {
      const r = await discoverOidcConfiguration(
        tenantId,
        "probe",
        badIssuer,
        noAllow
      );
      expect(r.ok).toBe(false);
    }
  });

  test("break-glass: policy save is gated, and IdP outage never locks out break-glass", async () => {
    resetGenericOidcCachesForTests();
    const tenantId = await createTenant();
    const bg = await createIdentity(tenantId, "owner@corp.example");
    const other = await createIdentity(tenantId, "user@corp.example");

    // sso_required with NO eligible break-glass → rejected.
    const rejected = await tx(tenantId, (t) =>
      saveTenantAuthPolicy(t, tenantId, bg.tenantUserId, {
        ssoEnabled: true,
        ssoRequired: true,
        passwordLoginEnabled: false,
        breakGlassIdentityIds: []
      })
    );
    expect(rejected.outcome).toBe("break_glass_required");

    // With an eligible break-glass owner → saved.
    const saved = await tx(tenantId, (t) =>
      saveTenantAuthPolicy(t, tenantId, bg.tenantUserId, {
        ssoEnabled: true,
        ssoRequired: true,
        passwordLoginEnabled: false,
        breakGlassIdentityIds: [bg.identityId]
      })
    );
    expect(saved.outcome).toBe("saved");

    // Break-glass owner may still password-login; everyone else is blocked.
    expect(
      await tx(tenantId, (t) =>
        isPasswordLoginDisabledForIdentity(t, tenantId, bg.identityId)
      )
    ).toBe(false);
    expect(
      await tx(tenantId, (t) =>
        isPasswordLoginDisabledForIdentity(t, tenantId, other.identityId)
      )
    ).toBe(true);

    // Simulate an IdP outage (unreachable issuer) — the SSO path fails fast,
    // but the break-glass eligibility above is unaffected: the owner is never
    // locked out by a provider outage.
    const outage = await discoverOidcConfiguration(
      tenantId,
      "outage",
      "http://127.0.0.1:1",
      env({ AUTH_SSO_ALLOW_INSECURE_HOSTS: "127.0.0.1:1" })
    );
    expect(outage.ok).toBe(false);

    const policy = await tx(tenantId, (t) => getTenantAuthPolicy(t, tenantId));
    expect(policy.ssoRequired).toBe(true);
    expect(policy.breakGlassIdentityIds).toEqual([bg.identityId]);
  });

  test("RLS FORCE denies cross-tenant provider reads under the non-superuser app role", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const a = await createIdentity(tenantA, "rls-a@corp.example");
    await createProvider(tenantA, a.tenantUserId, "okta");

    // Provision awcms_app as a LOGIN role (the container user is a superuser and
    // bypasses RLS, so it cannot prove FORCE). Password generated at runtime.
    const probePassword = randomBytes(12).toString("hex");
    await sql.unsafe(`ALTER ROLE awcms_app LOGIN PASSWORD '${probePassword}'`);
    const url = new URL(DATABASE_URL!);
    url.username = "awcms_app";
    url.password = probePassword;
    const appSql = new Bun.SQL(url.toString(), { max: 2 });

    try {
      // Control: tenant A sees its own provider.
      const seenA = await appSql.begin(async (t) => {
        await t`SELECT set_config('app.current_tenant_id', ${tenantA}, true)`;
        return t`SELECT id FROM awcms_auth_providers WHERE tenant_id = ${tenantA}`;
      });
      expect((seenA as unknown[]).length).toBe(1);

      // Cross-tenant: tenant B's context sees NONE of tenant A's providers.
      const seenFromB = await appSql.begin(async (t) => {
        await t`SELECT set_config('app.current_tenant_id', ${tenantB}, true)`;
        return t`SELECT id FROM awcms_auth_providers WHERE tenant_id = ${tenantA}`;
      });
      expect((seenFromB as unknown[]).length).toBe(0);
    } finally {
      await appSql.close({ timeout: 5 });
      await sql.unsafe(`ALTER ROLE awcms_app NOLOGIN`).catch(() => {});
    }
  });
});
