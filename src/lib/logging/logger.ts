import { redactSensitiveAttributes } from "../../modules/_shared/redaction";

export type LogLevel = "debug" | "info" | "warning" | "error";

export type LogContext = {
  correlationId?: string;
  tenantId?: string;
  moduleKey?: string;
  [key: string]: unknown;
};

const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40
};

function currentThreshold(): number {
  const configured = process.env.LOG_LEVEL as LogLevel | undefined;

  return LOG_LEVEL_SEVERITY[configured ?? "info"] ?? LOG_LEVEL_SEVERITY.info;
}

export type LogEntry = {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
};

/** Writes one redacted JSON line to stdout, gated by `LOG_LEVEL` (default `"info"`). */
export function log(
  level: LogLevel,
  message: string,
  context?: LogContext
): void {
  if (LOG_LEVEL_SEVERITY[level] < currentThreshold()) {
    return;
  }

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...redactSensitiveAttributes(context)
  };

  console.log(JSON.stringify(entry));
}
