🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](research-ai-assisted-design-evidence-2026-11-28.id.md)

# AI-assisted design and specification evidence — SYSTEM admin

- Version: 0.2.0
- Date: 2026-11-28
- Status: research proposal, not a normative change or implementation
- Related issue: #1532
- Evidence snapshot: `main` at commit `164d49aecbba` (2026-11-28).
- Document changeset: proposal text kept as `proposed`; references re-checked at takeover, vendor statements reduced to self-report, unverified references marked.

## Research method and evidence

Rapid review of public sources, not a systematic review or a product trial. This research was prompted by public descriptions of commercial AI-assisted planning and design products. Only general functional concepts and open standards are used; vendor statements are self-report, not effectiveness evidence.

- [NgodingPakeAI](https://ngodingpakeai.com/) (vendor self-report): at takeover the home page showed four feature labels without describing them, and the design feature was marked as coming soon.
- [DesainPakeAI release notes](https://desainpakeai.com/updates) (vendor self-report): at takeover the page listed ten dated entries between 2026-08-30 and 2026-09-23. What the entries claim about contextual canvas feedback was not verified at takeover.
- [Cui et al.](https://doi.org/10.1287/mnsc.2025.00535): field experiments on developer productivity with AI assistants. **Not verified at takeover** (publisher page refused access). Publication year, sample size and effect sizes are not stated here as facts.
- [METR 2025](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/): randomized study with 16 experienced developers over 246 issues, 19% longer completion time; the page marks the result as no longer current. The [2026 update](https://metr.org/blog/2026-02-24-uplift-update/) describes changes to the study design and selection effects. That outcomes differ and should not be pooled or turned into a promise of savings is this document's own conclusion, not a quotation.
- [Perry et al.](https://arxiv.org/abs/2211.03622): in a bounded study participants were more likely to believe their code was secure; read as a security and overconfidence risk signal.
- [ISO/IEC/IEEE 12207](https://www.iso.org/standard/90219.html) (software life cycle processes) and [ISO 9241-210](https://www.iso.org/standard/77520.html) (human-centred design): **not verified at takeover** (catalog pages refuse automated access). Edition years are not stated here.
- [DTCG 2025.10](https://www.designtokens.org/tr/2025.10/format/): Final Community Group Report of 2025-10-28, not a W3C Recommendation. [Stitch DESIGN.md](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-design-md/): announcement dated 2026-04-21 describing a draft specification. Both are interoperability references, not mandatory tools.

## Boundary and proposed validation

This note covers SYSTEM admin and upstream reusable primitives; public and USER admin belong to `awcms-astro` (see `AGENTS.md`). This repo has no staging of its own ([ADR-0083](adr/0083-this-template-deploys-to-one-environment.md)); UAT belongs to consuming repos.

Proposed: inventory current system admin forms, components, theme and contracts. A synthetic single-flight mutating form must map screen state to operation, RBAC/ABAC/RLS and audit; test an unauthorized actor and tenant isolation, keyboard and focus behaviour, and deterministic screenshots. No change to sessions, database policy or public UI; no new dependency.

## Evidence contract (proposed)

- Steps 2 and 4 of the [development flow](awcms/alur-pengembangan.md): requirement and acceptance criteria, screen ID, review context and a synthetic prototype.
- Steps 5–8: explicit data, permission and operation, and a contract-generated mock when applicable.
- Gate 9: detect missing or conflicting links; corrections go back to the originating specification.
- Step 11: per-slice tests only after the applicable approval.
- Step 12: deterministic visual baseline plus manual and automated [WCAG 2.2](https://www.w3.org/TR/WCAG22/) checks (W3C Recommendation, 2024-12-12); automation alone does not prove accessibility.
- Record observed, approved, inferred, unknown and proposed facts separately; pin the actual source commit before any pilot. Where UI is absent mark N/A.
- Reuse existing canonical artifacts, do not duplicate them. Measure time including review and rework, defect escape, task success and cost against a matched baseline. No fabricated tests, UAT or CI.

## Security and licensing

Concept-only independent adoption. No copying of proprietary assets or source; no confidential data sent to unapproved providers. Use synthetic fixtures, least privilege, redaction and licence review. [NIST SSDF](https://csrc.nist.gov/projects/ssdf/publications): version 1.1 final (2022), version 1.2 initial public draft (2025-12-17). [Indonesian PDP law](https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022) and [copyright law](https://peraturan.bpk.go.id/Details/38690/uu-no-28-tahun-2014) apply as relevant; the article text of the PDP law was not verified at takeover. No compliance certification or performance result is claimed.

## Next decision

Issue #1532 owns deeper inspection (ADR, docs, actual code, CI and overlap), a bounded proposal and the reviewer decision. This note authorises no implementation, dependency, release or gate decision.

## GitHub Projects — lifecycle coordination (proposed)

Proposed direction: coordinate the applicable steps of the development flow through GitHub Projects (v2), integrated with existing project management and not a second board or a replacement for repository authority. Existing work: #1532. Scope is SYSTEM admin; no staging or UAT card is marked complete falsely; record N/A with ADR evidence. None of the mapping below is in force and no project membership was checked.

- Steps 1–8: track research and specification deliverables, dependency, reviewer, acceptance criteria and evidence URL; no implementation issue before the applicable Gate 9. Step 9: the gate tracker references a recorded decision, never inferred from the board stage.
- Steps 10–12: one canonical issue per S/M unit, native parent/sub-issue and blocked-by relations where supported, milestone, priority and assignee preserved; the PR references the issue and CI evidence. Steps 13–15: staging and UAT only if applicable, release-readiness evidence and decision. Steps 16–18: deployment, validation, monitoring and follow-up with release or incident evidence.
- Reuse the approved project and its existing fields; proposed status mapping: backlog, ready (definition of ready met), in progress (claimed), waiting (dependency, review or approval), done (verified outcome), cancelled (with reason). The lifecycle step is a separate field or existing issue metadata, never inferred from status. A gate rejection stays recorded even if the tracker closes. A closed-unmerged PR, a duplicate or not-planned issue, or missing evidence is never marked done automatically. Preserve owner, assignee and target; do not invent deadlines.
- Project membership or field changes: discover the live owner, number, access and field IDs; use the actual issue URL or node ID, idempotent add, dry-run diff, readback and reconcile; keep one canonical issue and distinguish PR items from work counts. No shared draft cards or confidential context. Review permission, avoid broad seeding and conflicts with status automation, never move an item across a visibility boundary automatically. The board is coordination only, not merge or deploy authority.

References: [planning and tracking with Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects), [using the API to manage Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects), [issue dependencies](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies), [issue statuses](https://docs.github.com/en/issues/tracking-your-work-with-issues/learning-about-issues/about-issue-statuses). These four GitHub documentation pages were not opened at takeover.

## Reference verification at takeover (2026-11-28)

- Supported by opening the source: METR 2025 and its 2026 update (with corrections: 246 issues, not tasks), Perry et al., DTCG 2025.10, the Stitch announcement, NIST SSDF, WCAG 2.2, and the existence of both Indonesian law pages and the two vendor pages (listing only).
- Marked not verified at takeover: Cui et al. (including all figures from it), ISO/IEC/IEEE 12207 and ISO 9241-210 (including edition years), the article text of the PDP law, and the four GitHub documentation pages.
- Corrections made: removed the Cui et al. figures; METR "tasks" changed to "issues" and the not-current marker added; vendor feature statements reduced to what the pages show; the stale `AGENTS.md` blob prefix replaced by a commit SHA; internal programme terms replaced by the repository's own development-flow document.
- References were not added. All design items, controls, IDs and the Projects mapping remain proposed.

## Changelog

### 2026-11-28 - v0.2.0

- Takeover review: reference verification, corrections listed above, Indonesian mirror added.

### 2026-11-28 - v0.1.0

- Initial research note and GitHub Projects coordination section.
