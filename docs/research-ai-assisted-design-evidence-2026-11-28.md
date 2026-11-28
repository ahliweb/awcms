# AI-assisted design and specification evidence — SYSTEM admin

- Version: 0.1.0
- Date: 2026-11-28
- Status: research proposal, not a normative change or implementation
- Related issue: #1532
- Evidence snapshot: main AGENTS.md blob prefix e76368d0b85d (not a commit SHA).

## Research method and evidence
Rapid review of primary public sources, not a systematic review or a product trial. [NgodingPakeAI](https://ngodingpakeai.com/) presents planning and codebase synchronization; [DesainPakeAI release notes](https://desainpakeai.com/updates) describe contextual canvas feedback. These are vendor feature claims, not effectiveness evidence. [Cui et al. 2026](https://doi.org/10.1287/mnsc.2025.00535) pooled 4,867 developers across three field experiments: 26.08% more completed tasks (SE 10.3%). [METR 2025](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/) randomized 246 tasks with 16 experienced developers: 19% longer time; [2026 update](https://metr.org/blog/2026-02-24-uplift-update/) addresses selection and changes to design. Outcomes differ; do not pool or promise savings. [Perry et al.](https://arxiv.org/abs/2211.03622) found security/overconfidence risks in a bounded study. [ISO 12207:2026](https://www.iso.org/standard/90219.html) and [ISO 9241-210:2019](https://www.iso.org/standard/77520.html) support iterative lifecycle and human-centred design. [DTCG 2025.10](https://www.designtokens.org/tr/2025.10/format/) and [Stitch DESIGN.md](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-design-md/) are interoperability references, not mandatory tools.

## Boundary and proposed validation
SYSTEM admin and upstream reusable primitives; public/USER admin belongs to Astro. No staging for upstream per existing policy; UAT belongs to consumers.
Inventory current system admin forms, components, theme and contracts. A synthetic single-flight mutating form must map screen state to operation, RBAC/ABAC/RLS and audit; test unauthorized actor and tenant isolation, keyboard/focus and deterministic screenshots.
Do not change sessions, database policy or public UI; no new dependency.

## Evidence contract
Steps 2/4: requirement/AC, screen ID, review context and synthetic prototype. Steps 5–8: explicit data/permission/operation and contract-generated mock when applicable. Gate 9: detect missing or conflicting links; correction at originating specification. Step 11: per-slice tests only after applicable approval. Step 12: deterministic visual baseline and manual plus automated [WCAG 2.2](https://www.w3.org/TR/WCAG22/) checks; no claim that automation alone proves accessibility. Record observed, approved, inferred, unknown and proposed separately; pin actual source SHA before pilot. Where UI is absent mark N/A. Use existing canonical artifacts, do not duplicate them. Measure time including review/rework, defect escape, task success and cost against matched baseline. No fabricated tests, UAT or CI.
 
## Security and licensing
Concept-only independent adoption. No copying proprietary assets/source, no sending confidential data to unapproved providers. Use synthetic fixtures, least privilege, redaction and license review. [NIST SSDF](https://csrc.nist.gov/projects/ssdf/publications) v1.1 final; v1.2 draft. [Indonesia PDP](https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022) and [copyright](https://peraturan.bpk.go.id/Details/38690/uu-no-28-tahun-2014) as applicable. No compliance certification or performance result claimed.

## Next decision
Issue #1532 owns deeper inspection (ADR, docs, actual code, CI and overlap), a bounded proposal and reviewer decision. No implementation, dependency, release or gate approval in this note. Add to the existing documentation index and run applicable gates before merge.
