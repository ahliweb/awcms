# Independent intelligence capability research

## Metadata
- Version: v1.0.0
- Last updated: 2026-11-28
- Changeset: initial concept-only reference and local ownership/test mapping.
- Status: research/reference only; no product code, no approved dependency, no Gate 9/15 decision.
- Tracker: #1534, #1535, #1536
- Evidence: main branch blob snapshots 89bcad8fab9f (src/modules/index.ts); AGENTS e76368d0b85d (not HEAD commit). Full code, migration, issue status and CI audit still pending.

## Evidence and intellectual property
The official FOINIKS page (https://www.foiniks.com/, accessed 2026-11-28) describes proprietary products in data fusion, security assessment and AI-assisted accounting. This is vendor self-report, not independently tested or certified. Internal APIs/code, full catalog, licenses for reuse, performance and actual security are unverified. No license to reproduce has been established. Use only public functional concepts, original requirements, original specifications/design/implementation; no vendor code, UI, assets, text, datasets, brand, proprietary SDK or reverse engineering; no unauthorized testing. UU 28/2014 articles 40–41 distinguish protected program expression from ideas/methods: https://peraturan.bpk.go.id/Details/38690/uu-no-28-tahun-2014. Patent, trademark, trade secret and contract review still required. No dependencies introduced; every proposed dependency/model/data source must have version/SHA, license/SPDX, commercial/SaaS rights, notice, transitive SBOM, owner approval and exit plan before use. Do not reproduce licensed standards text.

## Repository disposition (proposed)
Reuse logging/reporting/identity-access/domain-event-runtime/workflow-approval/data-lifecycle/tax/inventory/procurement/omes-control. Three separate research questions: metadata catalog and lineage (1534), deterministic ledger and AI drafts (1535), generic findings and remediation (1536). Check #180/#187/#916 before work; no vendor scanner or duplicated ERP. Generic module admission in AWCMS, product-specific workflows in consumers.

## Controls, validation and evidence (proposed)
DAT: source_id, observed_at, purpose, classification, grant, evidence_hash and confidence; dedup/conflict/freshness/revocation and tenant isolation tests. FIN: balanced exact decimal entries, idempotency, period lock, reversal, segregation of duties, accountant review; no AI posting. SEC: signed scope, expiry/revocation, dedup, severity vs risk, finding lifecycle, immutable evidence and retest. Evaluate STIX adapter only after gap review. Build no modules until specs admitted; use expand/backfill/reconcile/contract.
Record requirements and threats → control → versioned contract → reproducible synthetic test → evidence → SOP/monitoring. Baselines and thresholds are hypotheses until measured. Use least privilege, default-deny RBAC/ABAC/FORCE RLS where applicable, no client-provided tenant trust, no secrets/PII in logs, audited approvals and recovery. No live vendor, customer or public targets tested. Verify data purpose, retention, lawful basis and controller/processor. No cross-tenant data sharing without explicit scoped grants.

## Professional reference register
- Hall & Llinas (1997), IEEE, data fusion: https://doi.org/10.1109/5.554205
- Lewis et al. (2020), NeurIPS, RAG: https://papers.nips.cc/paper/2020/hash/6b493230205f780e1bc26945df7481e5-Abstract.html
- W3C PROV-O (2013), provenance: https://www.w3.org/TR/prov-o/
- NIST AI RMF 1.0 (2023): https://doi.org/10.6028/NIST.AI.100-1 ; CSF 2.0 (2024): https://www.nist.gov/cyberframework
- NIST SSDF 1.1 (2022): https://csrc.nist.gov/pubs/sp/800/218/final ; AI profile (2024): https://csrc.nist.gov/pubs/sp/800/218/a/final
- NIST incident response SP 800-61r3 (2025): https://csrc.nist.gov/pubs/sp/800/61/r3/final ; OASIS STIX 2.1: https://docs.oasis-open.org/cti/stix/v2.1/os/stix-v2.1-os.html
- OWASP ASVS 5.0.0: https://owasp.org/projects/asvs ; WCAG 2.2: https://www.w3.org/TR/WCAG22/
- ISO catalog: ISO/IEC 27001:2022, 27002:2022, 27005:2022, 27017:2026, 27018:2025, 27034-1:2011, 27701:2025, 15408-1:2026, 20000-1:2018+Amd1:2024, ISO 22301:2019+Amd1:2024, 42001:2023, 23894:2023, 25010:2023. https://www.iso.org/standard/iso-iec-27000-family ; https://www.iso.org/standard/27017 ; https://www.iso.org/standard/27701 ; https://www.iso.org/standard/42001 ; https://www.iso.org/standard/15408-1 . Public catalog metadata only; no certification, compliance or full clause audit claimed.
- Indonesian PDP Law: https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun- ; PP 71/2019: https://jdih.komdigi.go.id/produk_hukum/view/id/695/t/common ; IIV Perpres 82/2022: https://peraturan.bpk.go.id/Details/211029/perpres-no-82-tahun-2022 . Review applicable ITE, sector laws and current implementing rules before release; vendor deadline/PP 33/2026 unverified.

## Next gate
Follow internal cross-portfolio 18-step lifecycle. Discovery/UX, privacy/threat model, data and authorization, algorithm and contracts before Gate 9; only research issue authorized now. Validate repository-specific CI, index, changeset and project board/milestone/dependencies during review; consumer UAT and Gate 15 before production. Rollback is removal of this draft doc (no runtime effect); future features require tested recovery/rollback and monitoring. No CI/test execution claimed for this research.

## Changelog
- v1.0.0 (2026-11-28): initial research, local ownership and controls.
