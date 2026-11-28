🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](independent-intelligence-reference-2026-11-28.id.md)

# Independent intelligence capability research

## Metadata

- Version: v1.3.0
- Last updated: 2026-11-28
- Changeset: takeover review: vendor statements neutralised, references re-checked and unverified ones marked, status kept as proposed.
- Status: research and reference only; no product code, no approved dependency, no Gate 9 or Gate 15 decision. Every design item, control, provisional ID and test below is **proposed**.
- Tracker: #1534, #1535, #1536 (all open at takeover)
- Evidence snapshot: `main` at commit `164d49aecbba` (2026-11-28); blob `89bcad8fab9f` for `src/modules/index.ts`. A full code, migration, issue-status and CI audit is still pending.

## Evidence and intellectual property

This research was prompted by public descriptions of a commercial product in this field. It uses only general functional concepts and open standards. Vendor statements are self-report, were not independently tested, and are not repeated here.

Rule: no third-party product code, assets, API, text, rules, datasets or reverse engineering; no unauthorised testing. Use only public functional concepts, original requirements and original specification, design and implementation. No licence to reproduce any third-party product has been established. Patent, trademark, trade secret and contract review is still required. No dependency is introduced; every proposed dependency, model or data source needs version and digest, licence (SPDX), commercial or SaaS rights, notice, transitive SBOM, owner approval and an exit plan before use. Licensed standards text is not reproduced. Indonesian copyright law (UU 28/2014): the [bpk.go.id page](https://peraturan.bpk.go.id/Details/38690/uu-no-28-tahun-2014) and the [WIPO English text](https://www.wipo.int/wipolex/en/legislation/details/15600) exist; the claim that articles 40–41 distinguish protected expression from ideas and methods was not verified at takeover.

## Repository disposition (proposed)

Reuse the logging, reporting, identity-access, domain-event-runtime, workflow-approval, data-lifecycle, tax, inventory, procurement and omes-control modules (all present under `src/modules/` at the snapshot). Three separate research questions: metadata catalogue and lineage (#1534), deterministic ledger and AI drafts (#1535), generic findings and remediation (#1536). Earlier work in #180, #187 and #916 is closed at the snapshot and should still be read before work starts; no third-party scanner and no duplicated ERP. Generic module admission stays in AWCMS; product-specific workflows belong to consumers.

## Controls, validation and evidence (proposed)

- DAT: `source_id`, `observed_at`, purpose, classification, grant, `evidence_hash` and confidence; deduplication, conflict, freshness, revocation and tenant-isolation tests.
- FIN: balanced exact-decimal entries, idempotency, period lock, reversal, segregation of duties and accountant review; no AI posting.
- SEC: signed scope, expiry and revocation, deduplication, severity versus risk, finding lifecycle, immutable evidence and retest.
- Evaluate a STIX adapter only after a gap review. Build no modules until specifications are admitted; use expand, backfill, reconcile, contract.
- Record requirements and threats, then control, versioned contract, reproducible synthetic test, evidence, SOP and monitoring. Baselines and thresholds are hypotheses until measured.
- Use least privilege, default-deny RBAC/ABAC and FORCE RLS where applicable, no client-provided tenant trust, no secrets or PII in logs, audited approvals and recovery. No live vendor, customer or public target is tested. Verify data purpose, retention, lawful basis and controller/processor roles. No cross-tenant data sharing without explicit scoped grants.

## Professional reference register

Status column is the result of opening the source on 2026-11-28 (read-only). "Supported" means the page confirms the title and date shown; it does not mean the content was audited.

| Reference                                                                                                                                                                                                                                                                                                                                                                        | Status at takeover                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Hall and Llinas (1997), IEEE, data fusion](https://doi.org/10.1109/5.554205)                                                                                                                                                                                                                                                                                                    | not verified at takeover (publisher page gave no content)                                                                                        |
| [Lewis et al. (2020), NeurIPS, retrieval-augmented generation](https://papers.nips.cc/paper/2020/hash/6b493230205f780e1bc26945df7481e5-Abstract.html)                                                                                                                                                                                                                            | supported                                                                                                                                        |
| [W3C PROV-O](https://www.w3.org/TR/prov-o/)                                                                                                                                                                                                                                                                                                                                      | supported: W3C Recommendation, 2013-04-30                                                                                                        |
| [NIST AI RMF 1.0](https://doi.org/10.6028/NIST.AI.100-1) and [CSF 2.0](https://www.nist.gov/cyberframework)                                                                                                                                                                                                                                                                      | not verified at takeover (years not confirmed; the CSF page exists and mentions CSF 2.0)                                                         |
| [NIST SSDF SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final) v1.1                                                                                                                                                                                                                                                                                                         | supported: final, 2022-02                                                                                                                        |
| [SP 800-218 Rev. 1](https://csrc.nist.gov/pubs/sp/800/218/r1/ipd)                                                                                                                                                                                                                                                                                                                | supported: initial public draft, 2025-12-17, not final                                                                                           |
| [SP 800-218A (AI profile)](https://csrc.nist.gov/pubs/sp/800/218/a/final)                                                                                                                                                                                                                                                                                                        | supported: final, 2024-07                                                                                                                        |
| [NIST SP 800-61 Rev. 3](https://csrc.nist.gov/pubs/sp/800/61/r3/final)                                                                                                                                                                                                                                                                                                           | supported: final, 2025-04                                                                                                                        |
| [OASIS STIX 2.1](https://docs.oasis-open.org/cti/stix/v2.1/os/stix-v2.1-os.html)                                                                                                                                                                                                                                                                                                 | supported: OASIS Standard, 2021-06-10                                                                                                            |
| [OWASP ASVS](https://owasp.org/projects/asvs)                                                                                                                                                                                                                                                                                                                                    | supported: 5.0.0 stable; release date 2025-05-30 per the [ASVS site](https://asvs.owasp.org/)                                                    |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/)                                                                                                                                                                                                                                                                                                                                        | supported: W3C Recommendation, 2024-12-12                                                                                                        |
| ISO/IEC catalogue entries: 27001, 27002, 27005, 27017, 27018, 27034-1, 27701, 15408-1, 20000-1, 22301, 42001, 23894, 25010 ([family](https://www.iso.org/standard/iso-iec-27000-family), [27017](https://www.iso.org/standard/27017), [27701](https://www.iso.org/standard/27701), [42001](https://www.iso.org/standard/42001), [15408-1](https://www.iso.org/standard/15408-1)) | **not verified at takeover** (catalogue pages refuse automated access); edition years are not stated here and must not be treated as fact        |
| Indonesian PDP law ([page](https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022))                                                                                                                                                                                                                                                                                      | page exists; article text not verified at takeover                                                                                               |
| [PP 71/2019](https://jdih.komdigi.go.id/produk_hukum/view/id/695/t/common) and [Perpres 82/2022](https://peraturan.bpk.go.id/Details/211029/perpres-no-82-tahun-2022)                                                                                                                                                                                                            | titles and numbers supported (PP 71/2019 on electronic systems and transactions; Perpres 82/2022 on vital information infrastructure protection) |

Review applicable ITE law, sector law and current implementing rules before any release.

## Next gate

Follow this repository's [development flow](../awcms/alur-pengembangan.md). Discovery and UX, privacy and threat model, data and authorisation, algorithm and contracts come before Gate 9; only the research issues are in play now. Repository-specific CI, documentation checks and project coordination are validated during review; consumer UAT and Gate 15 come before production. Rollback is removal of this document (no runtime effect); future features need tested recovery, rollback and monitoring. No CI or test execution is claimed for this research.

## Follow-up research: functional concepts and open licences

Status: research only; no implementation gate, no third-party IP and no dependency admission.

### Licence admission register

Observed on the default branch of each upstream project on 2026-11-28; this is not a pinned release and not an approval.

| Candidate                                                                                     | Observed licence and disposition                                                                                                                                                               |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ZAP](https://github.com/zaproxy/zaproxy/blob/main/LICENSE)                                   | Apache-2.0; candidate; check add-ons and NOTICE                                                                                                                                                |
| [Nuclei](https://github.com/projectdiscovery/nuclei/blob/dev/LICENSE.md)                      | MIT; candidate, no new dependency                                                                                                                                                              |
| [Nuclei templates](https://github.com/projectdiscovery/nuclei-templates/blob/main/LICENSE.md) | MIT for the official collection; review provenance, signatures and safety separately; no unknown third-party templates                                                                         |
| [testssl.sh](https://github.com/testssl/testssl.sh)                                           | GPL-2.0 (README: GPLv2); hold until distribution and integration review                                                                                                                        |
| [Wazuh](https://github.com/wazuh/wazuh/blob/main/README.md)                                   | the engine is AGPL-3.0-or-later; certain shared modules are GPL-2.0-only OR AGPL-3.0-or-later; the rest is GPLv2; inspect all packages, indexer, dashboard, agent and the actual release; hold |
| [MVT](https://github.com/mvt-project/mvt/blob/main/LICENSE)                                   | MVT License 1.1 (adapted from MPL 2.0) with a consensual-use restriction; hold; explicit, informed, non-coerced data-owner consent; IOC feeds carry their own licences                         |

No tool is approved, installed or bundled. Before any ADR: pin release or tag and digest, transitive SBOM, licence obligations and NOTICE, distribution and network-use terms, dataset and feed terms, support and exit plan, and legal review. Process separation does not erase licence obligations. Prefer the approved native foundation; external adapters only after the gate.

### Scientific and professional method (proposed)

- CVSS v4.0: the base score is not risk ([FIRST FAQ](https://www.first.org/cvss/faq)). EPSS estimates the probability that a published CVE is exploited in the wild in the next 30 days ([FIRST EPSS](https://www.first.org/epss/), [research page](https://www.first.org/epss/research)); it is not the compromise probability of a specific asset. The 2021 Jacobs et al. paper ([DOI](https://doi.org/10.1145/3436242)) is **not verified at takeover**; do not use its figures or horizon as fact.
- [CISA KEV](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) and [SSVC](https://www.cisa.gov/ssvc) pages exist and are used as concepts (known exploitation, stakeholder-specific decisions). Record feed date and version; treat unknown or stale data as unknown, never as zero. A risk decision combines verified exposure, asset impact, controls, exploitation evidence and human review; no invented production formula and no automatic closure. Evaluate on a time-split synthetic or authorised historical dataset (coverage, efficiency, precision, recall, calibration, analyst burden) against a severity-only baseline; no measured result is claimed.
- [NIST SP 800-115](https://csrc.nist.gov/pubs/sp/800/115/final) (security testing and assessment, final 2008-09) for assessment planning; SP 800-61 Rev. 3 for incident response; ASVS 5.0.0; PROV-O; WCAG 2.2. ISO/IEC 27035, 27036-3 and 27037 are **not verified at takeover**.
- Breach notification under the PDP law: the article and its deadline were **not verified at takeover**. Any trigger, recipient and deadline need human and legal validation; no automated filing and no hard-coded rule. Legal review also covers lawful basis, DPIA, data transfer, electronic-system registration, sector requirements, UU ITE, PP 71/2019, Perpres 82/2022 and IP.

### Proposed safety and acceptance tests

IDs are provisional and must be reconciled with existing CAP and REQ IDs; all tests are proposed and no CI was run.

- SEC-001: verified asset and signed scope grant; expiry and revocation; recheck before every job; DNS or file proof alone is not blanket permission; third-party or shared hosting is authorised separately.
- SEC-002: deny unapproved destinations, redirects, DNS changes, SSRF and private or link-local targets; no broad or disruptive tests, no exploitation, no credential collection, no external callbacks; sandbox with synthetic fixtures, bounded resource budget, stop switch and independent worker identity.
- SEC-003: admission, SBOM, version and signature; no arbitrary user templates or shell.
- SEC-004: finding and evidence hash, redacted output, tenant-scoped access, stale flag, audit, retest and false-positive workflow.
- SEC-005: explainable risk decision with provenance and uncertainty.
- SEC-008: GRC evidence and legal review. SEC-009: incident chronology, configurable notification deadline, approval and recovery drill. SEC-010: restricted evidence retention and deletion, access audit.
- SEC-011: GitHub issue only after scoped authorisation and redaction; no auto-action.
- SEC-012: AI may only draft; no secrets or raw customer telemetry; prompt-injection and egress tests; citations and abstention.
- SEC-013: endpoint monitoring metadata only where authorised. SEC-014: legitimate rights-holder reports only, human review, no retaliatory action. SEC-015: device-owner consent, no reading of communications, no forensic guarantee.
- No real customer assets or data are used in research.

### Local research deliverables (proposed)

- #1536: inventory and scope-grant contract, immutable finding identity, lifecycle (new, triaged, accepted, remediating, retest, closed, reopened), documented risk decision, incident timeline and GRC evidence mapping. Keep advisory, verified evidence and false positive separate; risk acceptance is time-bound, assigned and reviewed. Generic contracts only; no scan runner in the public or admin request path.
- #1534: source, version, time, hash and confidence; lineage, replay, retention and conflict; no cross-tenant central lake. Reuse identity-access, workflow-approval, logging, reporting, data-lifecycle, domain-event-runtime and omes-control; inspect the real API, schema and tests before module admission.
- GitHub integration candidate: minimal private-repository installation, redacted evidence, deduplicated and idempotent ticket creation, explicit approval and verified repository mapping; never auto-push fixes.
- GRC needs distinct control, evidence, regulatory version and risk with an accountable owner; it is not certification. #1535 accounting is unchanged.

## Independent reconstruction direction (proposed, 2026-11-28)

Proposed direction: use original capabilities rather than unapproved dependencies. This supersedes the earlier hold-as-candidate status for testssl.sh, Wazuh and MVT (see the licence register). Do not install, link, vendor, port, translate or copy their source, structure, UI, rules, templates, IOCs or datasets; do not use them as an oracle; no reverse engineering of them or of any commercial product. GPL and AGPL are not commercial bans, and independent implementation is a business and architecture choice, not a legal exemption. Informed, non-coerced device-owner consent applies regardless of implementation. ZAP and Nuclei remain unapproved candidates; no dependency is admitted. Use public functional descriptions and independent standards only; contributor provenance attestation, source register, independent requirements, reviewer, similarity and dependency/SBOM checks, pinned version/SHA/licence/notice/patent/data terms and an exit plan. No formal clean-room or compliance claim. Review other IP and contracts. No restricted material in agent prompts.

### Independent standards and scope

| Topic                  | Reference and status at takeover                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TLS                    | [RFC 9846](https://www.rfc-editor.org/info/rfc9846/) (July 2026) obsoletes RFC 8446 and RFC 5246; supported. [BCP 195](https://www.rfc-editor.org/info/bcp195/) comprises RFC 8996, 9325 and 9852; RFC 9325 is also updated by RFC 10015, which is **not** a BCP 195 member. [RFC 9525](https://www.rfc-editor.org/rfc/rfc9525.html) (service identity, November 2023) obsoletes RFC 6125. [NIST SP 800-52 Rev. 2](https://csrc.nist.gov/pubs/sp/800/52/r2/final) (August 2019; the page states a revision is planned).                                                                                                        |
| Logging and monitoring | Denning (1987) ([DOI](https://doi.org/10.1109/TSE.1987.232894)): not verified at takeover. [SP 800-92](https://csrc.nist.gov/pubs/sp/800/92/final) (2006; Rev. 1 is still a draft), [SP 800-137](https://csrc.nist.gov/pubs/sp/800/137/final) (2011), [SP 800-53](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final) Rev. 5 (Release 5.2.0 of 2025-08-27 is noted on that page; control IDs AU-6, SI-7 and SI-4 were not re-checked), [RFC 5424](https://www.rfc-editor.org/info/rfc5424/) (March 2009), [OpenTelemetry logs data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/) (stable; reference only). |
| Mobile                 | [SP 800-124 Rev. 2](https://csrc.nist.gov/pubs/sp/800/124/r2/final) (2023-05) and [SP 800-101 Rev. 1](https://csrc.nist.gov/pubs/sp/800/101/r1/final) (2014-05) as scope boundary, not forensic acquisition.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Secure development     | SSDF 1.1 final; 1.2 is an initial public draft, not final.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Legal                  | UU PDP, UU ITE, PP 71/2019, purpose, retention and consent, and legal review. ISO mapping is evidence only and is not certification.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Use approved runtime TLS APIs and never new cryptography; observe negotiated version, chain, identity and expiry only, and treat unknown as not pass. A TLS 1.2 observation is not BCP compliance; no parity or exploit probes.

Provisional IDs: IND-01 TLS posture (consumer worker), IND-02 host metadata (OMES), IND-03 event normalisation and correlation (AWCMS contract and OMES summaries), IND-04 integrity evidence (OMES), IND-05 mobile posture (product discovery), IND-06 risk, evidence and cases (AWCMS or consumer). No full SIEM, XDR or forensics claim and no spyware-detection claim. Explicit scoped grant, expiry and revocation, independent worker, synthetic data, no unauthorised I/O or private data, no action without approval.

A reference spike outside this repository reportedly passed 19 synthetic tests on a non-Bun runtime. It was not run in this repository, was not verified at takeover, and is not implementation evidence: it covers pure decisions on supplied observations only, with no Bun, CI, real TLS, devices, RLS or production tests. Reconcile CAP and REQ, source provenance, ADR and Gate 9 and 15; no new product code and no deployment.

### Local requirements and acceptance (proposed)

IND-03 and IND-06, #1534 and #1536: an original neutral event contract (tenant, source, event ID, event and ingest time, schema and rule version, evidence digest, classification and consent grant); typed, bounded, deterministic grouping; deduplication; late and out-of-order handling and quarantine accounting; provenance; scoped findings and review. Use existing logging, domain-event-runtime, reporting, identity-access, workflow-approval and data-lifecycle first. No third-party rules or decoders and no raw central log store. IND-01: a neutral TLS observation contract with the worker in the consumer; no cryptography implementation and no scanner in backend requests. Tests: tenant and source mismatch, replay, unknown, malformed, revocation, no unapproved egress, evidence and retest; actual RLS, database and contract tests are required.

## Reference verification at takeover (2026-11-28)

- Checked by opening the source and found consistent with this document: RFC 9846, BCP 195 membership, RFC 9525, RFC 5424, SP 800-61r3, SP 800-218 (1.1 final, Rev. 1 draft, 218A), SP 800-92, SP 800-124r2, SP 800-52r2, SP 800-137, SP 800-101r1, SP 800-115, SP 800-53 Rev. 5 page, ASVS 5.0.0 and its date, EPSS and CVSS statements, STIX 2.1, PROV-O, Lewis et al., WCAG 2.2, OpenTelemetry page, CISA KEV and SSVC pages (existence only), the five Indonesian legal pages (titles only), and the open-licence register entries for ZAP, Nuclei, the Nuclei templates, testssl.sh, Wazuh and MVT.
- Marked not verified at takeover: the ISO catalogue entries and their edition years, the PDP-law article and deadline, Hall and Llinas, Denning, Jacobs et al., NIST AI RMF 1.0 and CSF 2.0 years, SP 800-53 control IDs, and UU 28/2014 articles 40–41.
- Corrections made: RFC 10015 is not part of BCP 195; SP 800-53 stated as Rev. 5 with Release 5.2.0 dated 2025-08-27; the ASVS release date is now sourced; the Jacobs et al. horizon statement and the PDP article deadline are no longer stated as facts; the spike statement now says it was not run here; the vendor-specific section was replaced by a neutral statement, and vendor names, prices, service hours, scanner disclosures and comparisons between vendor pages were removed.
- No reference was added. All design items, IDs and tests remain proposed.

## Changelog

### 2026-11-28 - v1.3.0

- Takeover review: vendor statements neutralised, references re-checked and unverified ones marked, corrections listed above, Indonesian mirror added.

### 2026-11-28 - v1.2.0

- Independent reconstruction direction replacing unapproved components; proposed local acceptance.

### 2026-11-28 - v1.1.0

- Product-concept follow-up, licence dispositions, risk methodology and local research criteria.

### 2026-11-28 - v1.0.0

- Initial research, local ownership and controls.
