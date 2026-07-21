import { RedisClient } from "bun";

import { safeErrorDetail } from "../logging/error-sanitizer";
import { log } from "../logging/logger";
import {
  loadRedisConfig,
  validateRedisConfig,
  type RedisConfig
} from "./config";

let singleton: RedisClient | null = null;
let singletonConfig: RedisConfig | null = null;

function createRedisClient(config: RedisConfig): RedisClient {
  if (!config.url) {
    throw new Error("REDIS_URL is required when Redis is enabled.");
  }

  return new RedisClient(config.url, {
    connectionTimeout: config.connectionTimeoutMs,
    autoReconnect: true,
    maxRetries: config.maxRetries,
    enableOfflineQueue: false,
    enableAutoPipelining: true
  });
}

function hasSameConnectionConfig(
  current: RedisConfig | null,
  requested: RedisConfig
): boolean {
  return (
    current !== null &&
    current.url === requested.url &&
    current.connectionTimeoutMs === requested.connectionTimeoutMs &&
    current.maxRetries === requested.maxRetries
  );
}

/**
 * Returns null when Redis is disabled. Configuration errors throw before any
 * connection attempt so deployment mistakes are visible during preflight.
 */
export function getRedisClient(
  config: RedisConfig = loadRedisConfig()
): RedisClient | null {
  if (!config.enabled) {
    return null;
  }

  const failures = validateRedisConfig(config).filter(
    (finding) => finding.severity === "fail"
  );

  if (failures.length > 0) {
    throw new Error(failures.map((finding) => finding.message).join(" "));
  }

  if (singleton && hasSameConnectionConfig(singletonConfig, config)) {
    return singleton;
  }

  singleton?.close();
  singleton = createRedisClient(config);
  singletonConfig = config;

  singleton.onconnect = () => {
    log("info", "Redis connection established.", {
      moduleKey: "redis-foundation"
    });
  };

  singleton.onclose = (error) => {
    log("warning", "Redis connection closed.", {
      moduleKey: "redis-foundation",
      error: safeErrorDetail(error)
    });
  };

  return singleton;
}

export function closeRedisClient(): void {
  singleton?.close();
  singleton = null;
  singletonConfig = null;
}

/** Test helper; never leaves a network connection open between test cases. */
export function resetRedisClientForTests(): void {
  closeRedisClient();
}

export async function withRedisCommandTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Redis ${operationName} timed out.`)),
          timeoutMs
        );
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export type RedisHealthResult = {
  enabled: boolean;
  status: "disabled" | "healthy" | "unhealthy";
  latencyMs: number | null;
  connected: boolean;
  bufferedAmount: number;
  error?: string;
};

export async function checkRedisHealth(
  config: RedisConfig = loadRedisConfig()
): Promise<RedisHealthResult> {
  if (!config.enabled) {
    return {
      enabled: false,
      status: "disabled",
      latencyMs: null,
      connected: false,
      bufferedAmount: 0
    };
  }

  const startedAt = performance.now();

  try {
    const client = getRedisClient(config);

    if (!client) {
      throw new Error("Redis client is unexpectedly disabled.");
    }

    const response = await withRedisCommandTimeout(
      client.send("PING", []),
      config.commandTimeoutMs,
      "PING"
    );

    if (response !== "PONG") {
      throw new Error("Redis PING returned an unexpected response.");
    }

    return {
      enabled: true,
      status: "healthy",
      latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
      connected: client.connected,
      bufferedAmount: client.bufferedAmount
    };
  } catch (error) {
    return {
      enabled: true,
      status: "unhealthy",
      latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
      connected: singleton?.connected ?? false,
      bufferedAmount: singleton?.bufferedAmount ?? 0,
      error: safeErrorDetail(error)
    };
  }
}
