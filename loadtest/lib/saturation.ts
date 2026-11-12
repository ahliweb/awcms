/**
 * Generator-side saturation sampling (Issue #1283 step 2). Linux only: reads
 * `/proc/stat` and `/proc/net/dev`, the only dependency-free source of a
 * machine-wide CPU and network figure. A figure that cannot be read is
 * reported as unknown, never as zero.
 */
import { readFileSync, readdirSync } from "node:fs";

import type { Saturation } from "./merge";

type CpuTimes = { idle: number; total: number };

export function readCpu(): CpuTimes {
  const line = readFileSync("/proc/stat", "utf8").split("\n")[0]!;
  const n = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = (n[3] ?? 0) + (n[4] ?? 0);
  return { idle, total: n.reduce((a, b) => a + b, 0) };
}

export function readNetBytes(): { bytes: number; nics: string[] } {
  let bytes = 0;
  const nics: string[] = [];
  for (const line of readFileSync("/proc/net/dev", "utf8")
    .split("\n")
    .slice(2)) {
    const [name, rest] = line.split(":");
    if (!rest) continue;
    const nic = name!.trim();
    if (nic === "lo") continue;
    const f = rest.trim().split(/\s+/).map(Number);
    bytes += (f[0] ?? 0) + (f[8] ?? 0);
    nics.push(nic);
  }
  return { bytes, nics };
}

export function linkSpeedMbps(nics: string[]): number | null {
  let best: number | null = null;
  for (const nic of nics) {
    try {
      const v = Number(readFileSync(`/sys/class/net/${nic}/speed`, "utf8"));
      if (Number.isFinite(v) && v > 0) best = Math.max(best ?? 0, v);
    } catch {
      /* virtual NIC: no speed */
    }
  }
  return best;
}

export function listNics(): string[] {
  try {
    return readdirSync("/sys/class/net").filter((n) => n !== "lo");
  } catch {
    return [];
  }
}

export type Sampler = { stop: () => Saturation };

export function startSampler(
  generatorId: string,
  host: string,
  linkMbpsOverride: number | null
): Sampler {
  let prevCpu = readCpu();
  let prevNet = readNetBytes().bytes;
  let prevAt = Date.now();
  let cpuSum = 0;
  let cpuPeak = 0;
  let netPeak = 0;
  let samples = 0;
  const timer = setInterval(() => {
    const cpu = readCpu();
    const net = readNetBytes().bytes;
    const now = Date.now();
    const dTotal = cpu.total - prevCpu.total;
    const cpuPct =
      dTotal <= 0 ? 0 : (100 * (dTotal - (cpu.idle - prevCpu.idle))) / dTotal;
    const mbps =
      ((net - prevNet) * 8) / 1e6 / Math.max((now - prevAt) / 1000, 0.001);
    cpuSum += cpuPct;
    cpuPeak = Math.max(cpuPeak, cpuPct);
    netPeak = Math.max(netPeak, mbps);
    samples += 1;
    prevCpu = cpu;
    prevNet = net;
    prevAt = now;
  }, 1000);
  return {
    stop() {
      clearInterval(timer);
      return {
        generatorId,
        host,
        samples,
        cpuAvgPct: samples === 0 ? 0 : cpuSum / samples,
        cpuPeakPct: cpuPeak,
        netPeakMbps: netPeak,
        linkMbps: linkMbpsOverride ?? linkSpeedMbps(readNetBytes().nics)
      };
    }
  };
}
