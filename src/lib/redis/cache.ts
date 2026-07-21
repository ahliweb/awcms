import type { RedisClient } from "bun";

import { safeErrorDetail } from "../logging/error-sanitizer";
import { log } from "../logging/logger";
import { getRedisClient, withRedisCommandTimeout } from "./client";
import { loadRedisConfig, type RedisConfig } from "./config";

export type RedisCacheClient = Pick<RedisClient, "get" | "send">;

export type RedisCacheOptions = {
  client?: RedisCacheClient | null;
  config?: RedisConfig;
  ttlSec?: number;
};

function resolveClient(options: RedisCacheOptions): {
  client: RedisCacheClient | null;
  config: RedisConfig;
} {
  const config = options.config ?? loadRedisConfig();
  const client =
    options.client === undefined ? getRedisClient(config) : options.client;

  return { client, config };
}

/**
 * Best-effort JSON cache read. Redis unavailability, timeout, or malformed
 * cached JSON becomes a cache miss; it never blocks the authoritative loader.
 */
export async function getRedisJson<T>(
  key: string,
  options: RedisCacheOptions = {}
): Promise<T | null> {
  const { client, config } = resolveClient(options);

  if (!client) {
    return null;
  }

  try {
    const value = await withRedisCommandTimeout(
      client.get(key),
      config.commandTimeoutMs,
      "GET"
    );

    if (value === null) {
      return null;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      await withRedisCommandTimeout(
        client.send("DEL", [key]),
        config.commandTimeoutMs,
        "DEL malformed cache entry"
      ).catch(() => undefined);

      log("warning", "Malformed Redis JSON entry treated as cache miss.", {
        moduleKey: "redis-foundation"
      });

      return null;
    }
  } catch (error) {
    log("warning", "Redis cache read failed open.", {
      moduleKey: "redis-foundation",
      error: safeErrorDetail(error)
    });

    return null;
  }
}

/**
 * Best-effort atomic SET with expiry. Returns false when Redis is disabled or
 * unavailable; callers must not interpret a cache write failure as a domain
 * transaction failure.
 */
export async function setRedisJson<T>(
  key: string,
  value: T,
  options: RedisCacheOptions = {}
): Promise<boolean> {
  const { client, config } = resolveClient(options);

  if (!client) {
    return false;
  }

  const ttlSec = options.ttlSec ?? config.cacheDefaultTtlSec;

  if (!Number.isInteger(ttlSec) || ttlSec < 1 || ttlSec > 86_400) {
    throw new Error(
      "Redis cache TTL must be an integer between 1 and 86400 seconds."
    );
  }

  try {
    const payload = JSON.stringify(value);

    if (payload === undefined) {
      log("warning", "Non-serializable Redis cache value was skipped.", {
        moduleKey: "redis-foundation"
      });
      return false;
    }

    const result = await withRedisCommandTimeout(
      client.send("SET", [key, payload, "EX", String(ttlSec)]),
      config.commandTimeoutMs,
      "SET"
    );

    return result === "OK";
  } catch (error) {
    log("warning", "Redis cache write failed open.", {
      moduleKey: "redis-foundation",
      error: safeErrorDetail(error)
    });

    return false;
  }
}

export async function deleteRedisCache(
  key: string,
  options: RedisCacheOptions = {}
): Promise<boolean> {
  const { client, config } = resolveClient(options);

  if (!client) {
    return false;
  }

  try {
    await withRedisCommandTimeout(
      client.send("DEL", [key]),
      config.commandTimeoutMs,
      "DEL"
    );

    return true;
  } catch (error) {
    log("warning", "Redis cache invalidation failed open.", {
      moduleKey: "redis-foundation",
      error: safeErrorDetail(error)
    });

    return false;
  }
}

export type RedisCacheAsideOptions = RedisCacheOptions & {
  refresh?: boolean;
};

/**
 * Generic cache-aside flow. The loader is always the source of truth; Redis
 * only accelerates reads and is never consulted inside a database transaction.
 */
export async function redisCacheAside<T>(
  key: string,
  loader: () => Promise<T>,
  options: RedisCacheAsideOptions = {}
): Promise<T> {
  if (!options.refresh) {
    const cached = await getRedisJson<T>(key, options);

    if (cached !== null) {
      return cached;
    }
  }

  const authoritativeValue = await loader();
  await setRedisJson(key, authoritativeValue, options);

  return authoritativeValue;
}
