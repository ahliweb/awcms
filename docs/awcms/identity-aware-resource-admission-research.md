# Identity-aware resource admission — research and ADR proposal

Version: 0.1.0 | Date: 2026-11-28 | Status: PROPOSED / pre-Gate 9
Document changeset: initial independent research, threat/control matrix and acceptance plan for #1541.
History: 0.1.0 — initial. This is not an accepted ADR, implemented feature or production evidence.

## 1. Problem and evidence
Network identity is a useful anonymous admission signal, not a principal. NAT/CGNAT/shared BFF egress may group unrelated users; valid credentials must not remove infrastructure bounds. RFC 6269 documents address sharing; RFC 6585 specifies throttling responses without requiring an IP identifier. OWASP API4 and NIST SP 800-228 update 1 cover resource consumption and API protection. The video https://www.youtube.com/watch?v=MopxiEARThI motivated the question; transcript unavailable, no verbatim conclusions attributed. Independently designed; no external code, assets, dependency or license admission.

Verified by static inspection (AWCMS snapshot 164d49aecbbab09cad9487fe63be315f0b83fa2b; rate-limit.ts blob 5d5c07690d673d3164440290428956bd0e06c13d): shared fixed-window Redis/local fallback, explicit fail-open on configured Redis failure, source ceilings in auth-rate-limit.ts, session introspection source ceiling, worker polling pre-auth claimed pair plus source backstop and signature verification. See #1540 for counter lifecycle hardening and #1503/#1508 (ADR-0172 effective replicas × processes). #1385 closed contract work, not a behavior change. No execution or deployed config verified. Inventory all rate-limit/refund call sites, tests, migrations, OpenAPI and telemetry at branch HEAD before implementation.

## 2. Proposed decisions and alternatives
- Reuse existing shared limiter, proxy config, identity/access, work-class admission, audit, PostgreSQL and Redis; no new service by default. Keep one-process offline/LAN supported, multi-process admission subject to ADR-0172. Do not change accepted ADRs without review.
- Pre-auth: cheap edge/source/global, body cap, concurrency and target-identifier attempt signals (HMAC, bounded TTL/cardinality; not proof of identity); preserve uniform account/tenant error and timing behavior. Retain source ceiling even for verified actors, but tune shared-network ceiling separately. Trusted proxy hop count only with authenticated/isolated origin and validated proxy path; canonicalize IP and reject malformed forwarded values.
- Post-auth: verified tenant and actor from existing authorization context (session, credential, worker signature), operation from server route registry; independent actor, tenant, global and cost quotas. Never use caller-supplied ID or token string as an authoritative bucket. Avoid long-lived per-token keys; stable account prevents session rotation bypass. Rate limiting never grants RBAC/ABAC or bypasses FORCE RLS.
- Fixed window O(1) cheap but burst up to 2L near boundary; local and shared window anchors differ today. Keep contract until approved migration. Sliding counter approximate; exact sliding log O(n) state; token bucket B burst, refill r, cost c, admits only if tokens >= c; bound admitted cost over interval t by B+r*t under ideal serialized state. Weighted token units must be measured and capped; concurrency is separate (active work, not arrival rate). Adaptive policy deferred until stable telemetry and overload tests.
- Per-bucket atomic decision plus TTL, bounded eviction/cardinality and monotonic/authoritative time. Distinguish attempts charged even on rejection from work reservations, avoid naive compensation; idempotent reservation/refund within original window, absent or expired means no-op. Timeout may mean execution occurred: do not blindly retry a debit. Redis cross-slot Lua/transactions cannot promise all-key atomicity; choose conservative sequential attempt charging or same-slot explicitly reviewed co-location, or persistent transaction for hard multi-scope budget. Redis failover loss/clock skew need explicit error bounds; no exact global guarantee claimed.
- Financial/paid agent limits are durable business controls: PostgreSQL transaction conditionally reserves all parent budgets before dispatch; unique idempotency key; settle actual cost, release only known unused reservation; ambiguous external effect remains pending/unknown and reconcile; never treat unknown as zero. Concurrency lease TTL with fencing at execution authority; stale lease cannot perform new effect. A rate-limit token is not monetary balance.
- Cloudflare edge is optional coarse/advisory protection, per-location eventual count; origin must still enforce policy. No added dependency or global edge-hard-budget assumption.

## 3. Proposed policy contract (design, not schema)
Policy ID/version, owner, route/operation, pre/post-auth stage, trusted scope resolver, independent bucket dimensions, algorithm, positive integral cost and capacity, window/refill, max active work, store authority, retention, error/overshoot semantics, failure mode, exception expiry, metrics and tests. Default policy for unclassified new endpoint must be reviewed; reject invalid configuration in CI. Key serialization length-bounded and unambiguous, namespace by deployment and version, purpose-specific HMAC for sensitive identifiers, key rotation with overlap/expiry and no raw bearer/OTP/email/IP in logs. Restrict telemetry labels to policy/route/outcome/reason class; tenant/actor identifiers in protected audit only when necessary. Audit is not a per-request amplification channel.

Decisions: ALLOW, THROTTLED, DEPENDENCY_UNAVAILABLE; carry retry-after seconds where meaningful, internally reason and policy version; public envelope follows existing contracts, no leaking other tenant capacity. 429 when quota exceeded, 503 for unavailable required authority; no-store, Retry-After per RFC 6585/9110; draft RateLimit fields optional pending RFC/ADR. Clients bound retry with jitter and idempotency; never blindly retry mutation or ambiguous spend.

| Work class | Controls | Store failure proposal |
|---|---|---|
| Public static/cache | edge + bounded local capacity | degraded read; no auth bypass |
| Login/registration | source/global + account/authenticator + admission | preserve PostgreSQL account defense; bounded local emergency mode only after review |
| Search/export/upload | actor+tenant+cost, size/time/active limits | degrade or refuse expensive work |
| OTP/provider calls | target+tenant+global + hard provider budget | reject if required quota unavailable |
| Checkout/payout | actor/tenant throttles + separate transactional ledger | reject unsafe mutation, preserve durable webhook ingress/idempotency |
| Worker/agent | verified worker+tenant+run + host admission and budget authority | pause new paid work, recover known work, no duplicate runtime |

## 4. Threat to verification trace
| ID | Threat / control | Required test / evidence |
|---|---|---|
| C01 | shared NAT/BFF; independent stable actor quotas + aggregate ceiling | synthetic users same source, no collateral actor denial until true aggregate capacity |
| C02 | spoofed source/claimed tenant/worker; trust-boundary + verification | forged forwarded header/direct origin, unknown/rotating IDs, signature/replay negative cases |
| C03 | unbounded counter state/races; atomic lifecycle | real Redis concurrency/expiry/failure and refund idempotency; local/shared window parity decision (#1540) |
| C04 | replica/process multiplication | real 1/2-process tests, config guard #1503/#1508 |
| C05 | expensive calls and resource starvation | weighted costs, body/time limits, queue and leased concurrency, mixed tenant workloads |
| C06 | quota service outage | inject timeout before/after execution, failover, recovery and per-operation failure policy |
| C07 | duplicate/ambiguous billable effect | durable reserve/settle/reconcile, duplicate delivery, crash/restart, provider outcome unknown |
| C08 | PII and enumeration | uniform response/timing distribution, secret/log/cardinality scan, retention/expiry |
| C09 | contract and UX | OpenAPI 429+Retry-After/503, no-store, bounded retry, safe idempotency; fixture parity |
| C10 | release regressions | shadow evaluate additional controls (never disable current protections), canary, rollback and drift alarms |

## 5. Measurement and rollout
Hypotheses: verified actor quotas reduce shared-egress collateral throttling; independent tenant limits reduce noisy-neighbor starvation; atomic lifecycle bounds stale state. Compare baseline against candidate with reproducible seed, same build/config, single process and distributed real Redis/PostgreSQL, cache warm/cold, legitimate burst and synthetic abusive load. Record offered vs accepted rate, legitimate false-positive (rejected eligible / eligible), per-scope overshoot (admitted cost minus declared bound, floor zero), per-tenant demand-normalized acceptance, p50/p95/p99, memory/TTL/key count, CPU, pool wait and error/429/503, timeouts and recovery. Use repeated runs and report distributions/uncertainty, hardware, dataset, SHA, policy version; no invented thresholds. Agree tolerances before tests. Hard ledger invariant: no committed reservations exceed authorized budget under concurrency (subject to explicit provider billing uncertainty); no financial reliance on edge/Redis. Rollback policy version to prior approved config with compatibility/TTL drain; never weaken auth or immutable migrations. Security reviews and required repo checks; changeset, docs en/id, contract gate and relevant RLS tests. No CodeQL; use approved security leg. Upstream release before consumer subtree sync; UAT in consuming repo. Gate 9 then atomic issues/PRs; Gate 15 and approval before production.

## 6. References and constraints
- Raghavan et al., Cloud Control with Distributed Rate Limiting, ACM SIGCOMM 2007, pp. 337–348. https://doi.org/10.1145/1282380.1282419 ; https://www.microsoft.com/en-us/research/publication/cloud-control-with-distributed-rate-limiting/ . Research supports tradeoffs, not benchmarks for AWCMS.
- RFC 6269 (2011), https://www.rfc-editor.org/rfc/rfc6269 ; RFC 6585 (2012), https://www.rfc-editor.org/rfc/rfc6585 ; RFC 7239 (2014), https://www.rfc-editor.org/rfc/rfc7239 ; RFC 9110 (2022), https://www.rfc-editor.org/rfc/rfc9110 .
- NIST SP 800-63B-4 https://pages.nist.gov/800-63-4/sp800-63b.html ; NIST SP 800-228 update 1 (2026) https://csrc.nist.gov/pubs/sp/800/228/upd1/final ; OWASP API4:2023 https://api-security.owasp.org/editions/2023/en/0xa4-unrestricted-resource-consumption/ .
- Redis INCR https://redis.io/docs/latest/commands/incr/ ; cluster spec https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/ ; Cloudflare Workers https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ ; GitHub REST https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api .
- IETF RateLimit header draft 12 (Nov 2026): https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/12/ ; not final RFC.
- ISO catalog https://www.iso.org/committee/45306/x/catalogue/ and https://www.iso.org/management-system-standards-list.html : map to ISO/IEC 27001/27002 (2022), 27005 risk, 27017:2026 cloud, 27018:2025 PII processor, 27701:2025 privacy, 27034 application security, 15408 evaluation where applicable; 20000-1 service management, ISO 22301 continuity, ISO/IEC 42001 AI. Full licensed clause/edition and applicability review before formal conformity claim.
- Indonesia: UU 27/2022 https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022 ; PP 71/2019 https://peraturan.bpk.go.id/Details/122030/pp-no-71-tahun-2019 ; UU 1/2024 https://peraturan.bpk.go.id/details/274494/uu-no-1-tahun-2024 . Lawful basis, proportionality, retention, security and sector-specific review; no legal/certification claim.

Open: approved thresholds and failure semantics, repository state/route matrix, exact Redis topology/version/license, test harness, ownership, retention, review. Research only; no production config, dependencies, benchmarks or runtime changes in this document.
