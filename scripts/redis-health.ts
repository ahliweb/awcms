#!/usr/bin/env bun

import { checkRedisHealth, closeRedisClient } from "../src/lib/redis/client";
import {
  loadRedisConfig,
  redactRedisUrl,
  validateRedisConfig
} from "../src/lib/redis/config";

const config = loadRedisConfig();
const findings = validateRedisConfig(config);
const failures = findings.filter((finding) => finding.severity === "fail");

if (failures.length > 0) {
  console.error(
    JSON.stringify(
      {
        check: "redis",
        status: "invalid_configuration",
        url: redactRedisUrl(config.url),
        findings
      },
      null,
      2
    )
  );
  process.exitCode = 1;
} else {
  const health = await checkRedisHealth(config);

  console.log(
    JSON.stringify(
      {
        check: "redis",
        url: redactRedisUrl(config.url),
        findings,
        ...health
      },
      null,
      2
    )
  );

  if (health.status === "unhealthy") {
    process.exitCode = 1;
  }
}

closeRedisClient();
