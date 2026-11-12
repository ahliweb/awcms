// k6 scenarios for the awcms load-test harness (Issue #1283, ADR-0161).
//
// One script, one scenario per run (SCENARIO=public-page | admin-read |
// api-write), one load profile per run (PROFILE=smoke | baseline | spike).
// Several generators run this same script with a shared RUN_ID and START_AT;
// each drives TARGET_RPS / TOTAL_GENERATORS of the aggregate rate.
//
// Secrets and credentials never live here: the login identifier and password
// come from the environment, and a session token is fetched in setup().
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate } from "k6/metrics";

const env = (name, fallback) =>
  __ENV[name] !== undefined && __ENV[name] !== "" ? __ENV[name] : fallback;

const BASE_URL = env("BASE_URL", "").replace(/\/+$/, "");
const SCENARIO = env("SCENARIO", "public-page");
const PROFILE = env("PROFILE", "smoke");
const RUN_ID = env("RUN_ID", "");
const GENERATOR_ID = env("GENERATOR_ID", "g1");
const TOTAL_GENERATORS = Math.max(1, Number(env("TOTAL_GENERATORS", "1")));
const TARGET_RPS = Number(env("TARGET_RPS", "50"));
const START_AT_MS = Number(env("START_AT_MS", "0"));
const TENANT_CODE = env("TENANT_CODE", "");
const POST_COUNT = Math.max(1, Number(env("POST_COUNT", "20")));
const OUT_DIR = env("OUT_DIR", "loadtest/results");

// Rate of THIS generator. The spike profile multiplies it 10x within 60 s.
const rate = Math.max(1, Math.round(TARGET_RPS / TOTAL_GENERATORS));

const server5xx = new Rate("awcms_server_error_rate");
const rateLimited = new Counter("awcms_rate_limited_responses");

function profileStages() {
  if (PROFILE === "smoke") {
    return [
      { target: rate, duration: "5s" },
      { target: rate, duration: "10s" }
    ];
  }
  if (PROFILE === "baseline") {
    return [
      { target: rate, duration: "60s" },
      { target: rate, duration: env("HOLD", "5m") },
      { target: 0, duration: "15s" }
    ];
  }
  if (PROFILE === "spike") {
    // ADR-0161 spike NFR: 10x normal traffic within 60 s, 5xx <= 1 %.
    return [
      { target: rate, duration: "2m" },
      { target: rate * 10, duration: "60s" },
      { target: rate * 10, duration: env("HOLD", "3m") },
      { target: rate, duration: "30s" },
      { target: 0, duration: "15s" }
    ];
  }
  throw new Error(`unknown PROFILE ${PROFILE}`);
}

const peakRate = PROFILE === "spike" ? rate * 10 : rate;

export const options = {
  scenarios: {
    load: {
      executor: "ramping-arrival-rate",
      startRate: Math.max(1, Math.floor(rate / 4)),
      timeUnit: "1s",
      // Sized for ~500 ms worst-case latency; dropped_iterations reports it
      // when the generator cannot keep the arrival rate (client saturation).
      preAllocatedVUs: Math.max(20, Math.ceil(peakRate * 0.5)),
      maxVUs: Math.max(100, Math.ceil(peakRate * 2)),
      stages: profileStages()
    }
  },
  // The ADR-0161 shapes: p95 < 500 ms (writes < 900 ms) and 5xx <= 1 %.
  thresholds: {
    http_req_duration: [`p(95)<${SCENARIO === "api-write" ? 900 : 500}`],
    awcms_server_error_rate: ["rate<=0.01"]
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  discardResponseBodies: true,
  noConnectionReuse: false
};

function sleepUntilStart() {
  if (START_AT_MS > 0) {
    const waitMs = START_AT_MS - Date.now();
    if (waitMs > 0) sleep(waitMs / 1000);
  }
}

export function setup() {
  if (!BASE_URL) throw new Error("BASE_URL is required");
  if (!RUN_ID) throw new Error("RUN_ID is required");

  // Target guard: the ephemeral environment seeds a tenant whose code carries
  // the run id. A deployment that is not this run's ephemeral environment does
  // not have it, so a mistyped BASE_URL aborts here before any load is sent.
  const probe = http.get(`${BASE_URL}/blog/${TENANT_CODE}`, {
    tags: { name: "guard" },
    responseType: "none"
  });
  if (!TENANT_CODE || probe.status !== 200) {
    throw new Error(
      `target guard failed: ${BASE_URL}/blog/<run tenant> answered ${probe.status}; refusing to send load`
    );
  }

  const state = { token: null, tenantId: null };
  if (SCENARIO !== "public-page") {
    const tenantId = env("TENANT_ID", "");
    const identifier = env("LOGIN_IDENTIFIER", "");
    const password = env("LOGIN_PASSWORD", "");
    if (!tenantId || !identifier || !password) {
      throw new Error(
        "TENANT_ID, LOGIN_IDENTIFIER and LOGIN_PASSWORD are required for authenticated scenarios"
      );
    }
    const login = http.post(
      `${BASE_URL}/api/v1/auth/login`,
      JSON.stringify({ loginIdentifier: identifier, password }),
      {
        headers: {
          "content-type": "application/json",
          "x-awcms-tenant-id": tenantId
        },
        responseType: "text"
      }
    );
    const token = login.status === 200 ? login.json("data.token") : null;
    if (!token) {
      throw new Error(`login failed with status ${login.status}`);
    }
    state.token = token;
    state.tenantId = tenantId;
  }

  sleepUntilStart();
  return state;
}

function record(res) {
  server5xx.add(res.status >= 500);
  if (res.status === 429) rateLimited.add(1);
}

function publicPage() {
  // Index plus individual posts, so the mix is not one hot key.
  const pick = Math.floor(Math.random() * (POST_COUNT + 1));
  const path =
    pick === POST_COUNT
      ? `/blog/${TENANT_CODE}`
      : `/blog/${TENANT_CODE}/lt-post-${pick}`;
  const res = http.get(`${BASE_URL}${path}`, {
    tags: { name: pick === POST_COUNT ? "blog-index" : "blog-post" }
  });
  record(res);
  check(res, { "public page 200": (r) => r.status === 200 });
}

function authHeaders(state) {
  return {
    authorization: `Bearer ${state.token}`,
    "x-awcms-tenant-id": state.tenantId
  };
}

function adminRead(state) {
  // Uncacheable, authenticated, tenant-scoped (RLS) read through the database.
  const res = http.get(`${BASE_URL}/api/v1/offices`, {
    headers: authHeaders(state),
    tags: { name: "admin-read-offices" }
  });
  record(res);
  check(res, { "admin read 200": (r) => r.status === 200 });
}

function apiWrite(state) {
  // Creates a draft post: the one authenticated write of the baseline.
  const key = `${GENERATOR_ID}-${__VU}-${__ITER}-${Date.now()}`;
  const res = http.post(
    `${BASE_URL}/api/v1/blog/posts`,
    JSON.stringify({
      title: `Load test draft ${key}`,
      slug: `lt-write-${key}`,
      contentJson: {},
      bodyPortableText: [
        {
          _type: "block",
          _key: "b0",
          style: "normal",
          children: [
            { _type: "span", _key: "s0", text: "synthetic", marks: [] }
          ],
          markDefs: []
        }
      ]
    }),
    {
      headers: { ...authHeaders(state), "content-type": "application/json" },
      tags: { name: "api-write-post" }
    }
  );
  record(res);
  check(res, { "api write 2xx": (r) => r.status >= 200 && r.status < 300 });
}

export default function (state) {
  if (SCENARIO === "public-page") return publicPage();
  if (SCENARIO === "admin-read") return adminRead(state);
  if (SCENARIO === "api-write") return apiWrite(state);
  throw new Error(`unknown SCENARIO ${SCENARIO}`);
}

// One machine-readable file per generator. merge-results.ts aggregates them.
export function handleSummary(data) {
  const out = {
    runId: RUN_ID,
    generatorId: GENERATOR_ID,
    totalGenerators: TOTAL_GENERATORS,
    scenario: SCENARIO,
    profile: PROFILE,
    targetRpsAggregate: TARGET_RPS,
    summary: data
  };
  return {
    [`${OUT_DIR}/${RUN_ID}/${GENERATOR_ID}.summary.json`]: JSON.stringify(
      out,
      null,
      2
    )
  };
}
