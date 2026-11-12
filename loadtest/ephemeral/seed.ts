/**
 * Synthetic seed for the ephemeral load-test environment.
 *
 * Talks only HTTP to the app of THIS run and refuses any non-loopback target,
 * so it cannot seed (or be pointed at) a real deployment. Uses the real
 * bootstrap (`POST /api/v1/setup/initialize`, a singleton) for the tenant,
 * office and owner, then the real authenticated API for the content: no SQL
 * and no real data. Every name, address and text is synthetic.
 */
export type SeedInput = {
  baseUrl: string;
  runId: string;
  password: string;
  postCount: number;
};

export type SeedResult = {
  tenantId: string;
  tenantCode: string;
  loginIdentifier: string;
  postCount: number;
};

export function assertLoopback(baseUrl: string): void {
  const host = new URL(baseUrl).hostname;
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]") {
    throw new Error(
      `seed refuses non-loopback target ${host}: it only seeds the ephemeral environment of this run`
    );
  }
}

/** Fixed synthetic login of the seeded owner; never a real address. */
export const LOGIN_IDENTIFIER = "loadtest-owner@example.invalid";

export function tenantCodeFor(runId: string): string {
  return `lt-${runId}`;
}

async function api(
  baseUrl: string,
  path: string,
  init: RequestInit & { json?: unknown }
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: init.json === undefined ? undefined : JSON.stringify(init.json)
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

export async function seed(input: SeedInput): Promise<SeedResult> {
  assertLoopback(input.baseUrl);
  const tenantCode = tenantCodeFor(input.runId);
  const loginIdentifier = LOGIN_IDENTIFIER;

  const init = await api(input.baseUrl, "/api/v1/setup/initialize", {
    method: "POST",
    json: {
      tenantCode,
      tenantName: "Load Test Tenant",
      officeCode: "LT-HQ",
      officeName: "Load Test Head Office",
      ownerDisplayName: "Load Test Owner",
      ownerLoginIdentifier: loginIdentifier,
      ownerPassword: input.password
    }
  });
  const tenantId: string | undefined = init.body?.data?.tenantId;
  if (init.status !== 200 || !tenantId) {
    throw new Error(`setup/initialize failed: ${init.status}`);
  }

  const login = await api(input.baseUrl, "/api/v1/auth/login", {
    method: "POST",
    headers: { "x-awcms-tenant-id": tenantId },
    json: { loginIdentifier, password: input.password }
  });
  const token: string | undefined = login.body?.data?.token;
  if (login.status !== 200 || !token) {
    throw new Error(`seed login failed: ${login.status}`);
  }
  const auth = {
    authorization: `Bearer ${token}`,
    "x-awcms-tenant-id": tenantId
  };

  for (let i = 0; i < input.postCount; i++) {
    const created = await api(input.baseUrl, "/api/v1/blog/posts", {
      method: "POST",
      headers: auth,
      json: {
        title: `Synthetic load test post ${i}`,
        slug: `lt-post-${i}`,
        excerpt: "Synthetic content for load testing.",
        contentJson: {},
        bodyPortableText: [
          {
            _type: "block",
            _key: "b0",
            style: "normal",
            children: [
              {
                _type: "span",
                _key: "s0",
                text: `Synthetic paragraph for post ${i}. `.repeat(20),
                marks: []
              }
            ],
            markDefs: []
          }
        ]
      }
    });
    const id: string | undefined = created.body?.data?.id;
    if (created.status !== 201 && created.status !== 200) {
      throw new Error(
        `post ${i} create failed: ${created.status} ${JSON.stringify(created.body).slice(0, 300)}`
      );
    }
    if (!id) throw new Error(`post ${i} create returned no id`);
    const published = await api(
      input.baseUrl,
      `/api/v1/blog/posts/${id}/publish`,
      {
        method: "POST",
        headers: { ...auth, "idempotency-key": `lt-seed-${input.runId}-${i}` },
        json: {}
      }
    );
    if (published.status !== 200) {
      throw new Error(
        `post ${i} publish failed: ${published.status} ${JSON.stringify(published.body).slice(0, 300)}`
      );
    }
  }

  return { tenantId, tenantCode, loginIdentifier, postCount: input.postCount };
}
