import { describe, expect, test } from "bun:test";

import {
  deleteRedisCache,
  getRedisJson,
  redisCacheAside,
  setRedisJson,
  type RedisCacheClient
} from "../../src/lib/redis/cache";
import {
  getRedisClient,
  withRedisCommandTimeout
} from "../../src/lib/redis/client";
import {
  buildRedisKey,
  loadRedisConfig,
  redactRedisUrl,
  validateRedisConfig,
  type RedisConfig
} from "../../src/lib/redis/config";

function enabledConfig(overrides: Partial<RedisConfig> = {}): RedisConfig {
  return {
    enabled: true,
    url: "redis://awcms_app:secret@localhost:6379/0",
    keyPrefix: "awcms",
    connectionTimeoutMs: 2_000,
    commandTimeoutMs: 1_000,
    maxRetries: 3,
    cacheDefaultTtlSec: 300,
    ...overrides
  };
}

class FakeRedisClient {
  readonly values = new Map<string, string>();
  readonly commands: Array<{ command: string; args: string[] }> = [];
  failReads = false;
  failWrites = false;

  async get(key: string): Promise<string | null> {
    if (this.failReads) {
      throw new Error("simulated Redis read outage");
    }

    return this.values.get(key) ?? null;
  }

  async send(command: string, args: string[]): Promise<unknown> {
    const normalized = command.toUpperCase();
    this.commands.push({ command: normalized, args });

    if (this.failWrites) {
      throw new Error("simulated Redis write outage");
    }

    if (normalized === "SET") {
      this.values.set(args[0]!, args[1]!);
      return "OK";
    }

    if (normalized === "DEL") {
      const existed = this.values.delete(args[0]!);
      return existed ? 1 : 0;
    }

    return null;
  }

  asClient(): RedisCacheClient {
    return this as unknown as RedisCacheClient;
  }
}

describe("Redis configuration", () => {
  test("is disabled by default and does not create a client", () => {
    const config = loadRedisConfig({});

    expect(config.enabled).toBe(false);
    expect(config.url).toBeNull();
    expect(validateRedisConfig(config, {})).toEqual([]);
    expect(getRedisClient(config)).toBeNull();
  });

  test("requires REDIS_URL only when explicitly enabled", () => {
    const config = loadRedisConfig({ REDIS_ENABLED: "true" });
    const findings = validateRedisConfig(config, {});

    expect(
      findings.some(
        (finding) =>
          finding.severity === "fail" && finding.code === "redis_url_required"
      )
    ).toBe(true);
  });

  test("rejects unsupported URL schemes", () => {
    const config = loadRedisConfig({
      REDIS_ENABLED: "true",
      REDIS_URL: "http://localhost:6379"
    });
    const findings = validateRedisConfig(config, {});

    expect(
      findings.some(
        (finding) => finding.code === "redis_url_scheme_unsupported"
      )
    ).toBe(true);
  });

  test("warns about unauthenticated public Redis in production", () => {
    const config = loadRedisConfig({
      REDIS_ENABLED: "true",
      REDIS_URL: "redis://cache.example.com:6379/0"
    });
    const findings = validateRedisConfig(config, { APP_ENV: "production" });

    expect(
      findings.some((finding) => finding.code === "redis_tls_recommended")
    ).toBe(true);
    expect(
      findings.some((finding) => finding.code === "redis_auth_recommended")
    ).toBe(true);
  });

  test("redacts username and password from diagnostic URLs", () => {
    const redacted = redactRedisUrl(
      "redis://awcms_app:very-secret@redis.internal:6379/0"
    );

    expect(redacted).not.toContain("very-secret");
    expect(redacted).not.toContain("awcms_app");
    expect(redacted).toContain("***");
  });

  test("falls back to bounded defaults for malformed numeric values", () => {
    const config = loadRedisConfig({
      REDIS_CONNECTION_TIMEOUT_MS: "not-a-number",
      REDIS_COMMAND_TIMEOUT_MS: "0",
      REDIS_MAX_RETRIES: "999",
      REDIS_CACHE_DEFAULT_TTL_SEC: "-1"
    });

    expect(config.connectionTimeoutMs).toBe(2_000);
    expect(config.commandTimeoutMs).toBe(1_000);
    expect(config.maxRetries).toBe(3);
    expect(config.cacheDefaultTtlSec).toBe(300);
  });

  test("bounds command execution time", async () => {
    const never = new Promise<string>(() => undefined);

    await expect(
      withRedisCommandTimeout(never, 5, "test command")
    ).rejects.toThrow("Redis test command timed out.");
  });
});

describe("Redis key namespacing", () => {
  test("separates tenant keys and global keys", () => {
    const tenantA = buildRedisKey(
      { namespace: "reports", tenantId: "tenant-a", key: "summary" },
      { keyPrefix: "awcms" }
    );
    const tenantB = buildRedisKey(
      { namespace: "reports", tenantId: "tenant-b", key: "summary" },
      { keyPrefix: "awcms" }
    );
    const global = buildRedisKey(
      { namespace: "reports", key: "summary" },
      { keyPrefix: "awcms" }
    );

    expect(tenantA).toBe("awcms:v1:reports:tenant:tenant-a:summary");
    expect(tenantB).not.toBe(tenantA);
    expect(global).toBe("awcms:v1:reports:global:summary");
  });

  test("encodes delimiter characters so callers cannot inject key segments", () => {
    const key = buildRedisKey(
      { namespace: "report:admin", tenantId: "tenant:1", key: "a:b" },
      { keyPrefix: "awcms" }
    );

    expect(key).toBe("awcms:v1:report%3Aadmin:tenant:tenant%3A1:a%3Ab");
  });
});

describe("Redis cache-aside helpers", () => {
  test("reads and writes JSON with an explicit TTL", async () => {
    const fake = new FakeRedisClient();
    const config = enabledConfig();

    expect(
      await setRedisJson(
        "awcms:v1:test:global:item",
        { value: 42 },
        { client: fake.asClient(), config, ttlSec: 60 }
      )
    ).toBe(true);

    expect(fake.commands[0]).toEqual({
      command: "SET",
      args: ["awcms:v1:test:global:item", '{"value":42}', "EX", "60"]
    });

    expect(
      await getRedisJson<{ value: number }>("awcms:v1:test:global:item", {
        client: fake.asClient(),
        config
      })
    ).toEqual({ value: 42 });
  });

  test("rejects cache entries without a bounded positive TTL", async () => {
    const fake = new FakeRedisClient();

    await expect(
      setRedisJson(
        "awcms:v1:test:global:item",
        { value: 42 },
        { client: fake.asClient(), config: enabledConfig(), ttlSec: 0 }
      )
    ).rejects.toThrow("Redis cache TTL must be an integer");
  });

  test("treats malformed JSON as a miss and removes the bad entry", async () => {
    const fake = new FakeRedisClient();
    const key = "awcms:v1:test:global:bad-json";
    fake.values.set(key, "{not-json");

    const value = await getRedisJson(key, {
      client: fake.asClient(),
      config: enabledConfig()
    });

    expect(value).toBeNull();
    expect(fake.values.has(key)).toBe(false);
    expect(fake.commands.some((entry) => entry.command === "DEL")).toBe(true);
  });

  test("fails open to cache miss and write skip during Redis outage", async () => {
    const fake = new FakeRedisClient();
    fake.failReads = true;
    fake.failWrites = true;

    expect(
      await getRedisJson("awcms:v1:test:global:item", {
        client: fake.asClient(),
        config: enabledConfig()
      })
    ).toBeNull();

    expect(
      await setRedisJson(
        "awcms:v1:test:global:item",
        { value: 42 },
        { client: fake.asClient(), config: enabledConfig() }
      )
    ).toBe(false);

    expect(
      await deleteRedisCache("awcms:v1:test:global:item", {
        client: fake.asClient(),
        config: enabledConfig()
      })
    ).toBe(false);
  });

  test("returns a cache hit without calling the authoritative loader", async () => {
    const fake = new FakeRedisClient();
    const key = "awcms:v1:test:global:item";
    fake.values.set(key, '{"source":"cache"}');
    let loaderCalls = 0;

    const value = await redisCacheAside(
      key,
      async () => {
        loaderCalls += 1;
        return { source: "database" };
      },
      { client: fake.asClient(), config: enabledConfig() }
    );

    expect(value).toEqual({ source: "cache" });
    expect(loaderCalls).toBe(0);
  });

  test("loads authoritative data on miss and populates Redis best-effort", async () => {
    const fake = new FakeRedisClient();
    const key = "awcms:v1:test:global:item";

    const value = await redisCacheAside(
      key,
      async () => ({ source: "database" }),
      { client: fake.asClient(), config: enabledConfig(), ttlSec: 30 }
    );

    expect(value).toEqual({ source: "database" });
    expect(JSON.parse(fake.values.get(key)!)).toEqual({ source: "database" });
  });
});
