/**
 * Generator-side saturation sampling (Issue #1283 step 2). Linux only: reads
 * `/proc/stat` and `/proc/net/dev`, the only dependency-free source of a
 * machine-wide CPU and network figure. A figure that cannot be read is
 * reported as unknown, never as zero.
 */
import { readFileSync, readdirSync } from "node:fs";
import { cpus as osCpus, loadavg } from "node:os";

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

/** Linux reports process CPU in clock ticks; USER_HZ is 100 on every mainstream kernel. */
const CLK_TCK = 100;

/**
 * utime + stime (ticks) from the text of `/proc/<pid>/stat`. The command name
 * sits in parentheses and may itself contain spaces or `)`, so parse after the
 * LAST `)`. Returns null when the text is not a stat line.
 */
export function parseProcStatTicks(raw: string): number | null {
  const end = raw.lastIndexOf(")");
  if (end === -1) return null;
  const f = raw
    .slice(end + 2)
    .trim()
    .split(/\s+/);
  const utime = Number(f[11]);
  const stime = Number(f[12]);
  if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
  return utime + stime;
}

/**
 * Is this process a k6 generator of `runId`? Local k6 carries the id in its
 * `-e RUN_ID=` arguments; k6 in a container carries it in its environment.
 * Matching on both the binary name and the run id keeps an unrelated k6 (or an
 * unrelated process) out of the generator's CPU figure.
 */
export function isGeneratorProcess(
  comm: string,
  cmdline: string,
  environ: string,
  runId: string
): boolean {
  if (comm.trim() !== "k6") return false;
  const needle = `RUN_ID=${runId}`;
  const inArgs = cmdline.split("\0").includes(needle);
  const inEnv = environ.split("\0").includes(needle);
  return inArgs || inEnv;
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** Sum of utime+stime ticks of every generator process of the run, and how many. */
export function readGeneratorTicks(runId: string): {
  ticks: number;
  pids: number;
} {
  let ticks = 0;
  let pids = 0;
  let entries: string[] = [];
  try {
    entries = readdirSync("/proc").filter((e) => /^\d+$/.test(e));
  } catch {
    return { ticks: 0, pids: 0 };
  }
  for (const pid of entries) {
    const comm = readText(`/proc/${pid}/comm`);
    if (comm.trim() !== "k6") continue;
    if (
      !isGeneratorProcess(
        comm,
        readText(`/proc/${pid}/cmdline`),
        readText(`/proc/${pid}/environ`),
        runId
      )
    ) {
      continue;
    }
    const t = parseProcStatTicks(readText(`/proc/${pid}/stat`));
    if (t === null) continue;
    ticks += t;
    pids += 1;
  }
  return { ticks, pids };
}

export type Sampler = { stop: () => Saturation };

export function startSampler(
  generatorId: string,
  host: string,
  linkMbpsOverride: number | null,
  runId?: string
): Sampler {
  const cpus = Math.max(1, osCpus().length);
  let prevProc = runId ? readGeneratorTicks(runId) : null;
  let procSum = 0;
  let procPeak = 0;
  let procSamples = 0;
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
    if (runId && prevProc) {
      const cur = readGeneratorTicks(runId);
      // A sample counts only while a generator process exists in both reads:
      // a vanished process would otherwise look like negative or zero use.
      if (cur.pids > 0 && prevProc.pids > 0 && cur.ticks >= prevProc.ticks) {
        const dt = Math.max((now - prevAt) / 1000, 0.001);
        const pct =
          (100 * ((cur.ticks - prevProc.ticks) / CLK_TCK)) / (dt * cpus);
        procSum += pct;
        procPeak = Math.max(procPeak, pct);
        procSamples += 1;
      }
      prevProc = cur;
    }
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
        linkMbps: linkMbpsOverride ?? linkSpeedMbps(readNetBytes().nics),
        cpus,
        procCpuAvgPct: procSamples === 0 ? null : procSum / procSamples,
        procCpuPeakPct: procSamples === 0 ? null : procPeak,
        loadAvg1End: loadavg()[0] ?? 0
      };
    }
  };
}
