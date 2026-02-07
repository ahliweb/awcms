> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 2 (Data Integrity) and Section 2.3 (Permissions)

# Indonesia Compliance Guide

## 1. Overview

This document outlines how AWCMS supports compliance with Indonesian regulations, specifically **UU PDP (Personal Data Protection Law)** and **PP 71/2019 (Penyelenggaraan Sistem dan Transaksi Elektronik)**.

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for Indonesian compliance (UU PDP, PP 71/2019)
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references

## 2. UU No. 27 Tahun 2022 (UU PDP)

### Key Principles

- **Data Minimization**: Collect only what is necessary.
- **Purpose Limitation**: Use data only for the stated purpose.
- **Security**: Protect data from unauthorized access.

### AWCMS Implementation

- **Consent**: Built-in visual page builder can be used to create consent forms.
- **Analytics Notice**: `analytics_consent` settings provide cookie/telemetry disclosure for public portals.
- **Rights of Data Subjects**:
  - **Right to Access**: `UserProfile` allows users to view their data.
  - **Right to Delete**: `Soft Delete` mechanism supports "right to be forgotten" workflows (hard delete can be implemented by admin).
  - **Right to Correct**: Edit forms available for all user profiles.
- **Data Encryption**: All data is encrypted at rest and in transit via Supabase.
- **Personal Data**: IP addresses and user agent strings are stored in `analytics_events` and should follow retention/notification policies.

## 3. PP 71/2019 (PSE)

### Requirements

- **Data Localization**: For public sector, data must be processed in Indonesia. For private, it can be offshore but must be accessible for law enforcement.
- **Reliability**: System uptime and failure recovery.

### Implementation

- **Hosting**: Supabase projects can be deployed in compliant regions (e.g., AWS Jakarta if Enterprise, or Singapore for general private sector compliance).
- **Audit Trails**: Non-repudiation is supported via the `audit_logs` system.

## 4. Checklist for Deployers

- [ ] Determine PSE Category (Private/Public).
- [ ] Register with Kominfo (PSE Lingkup Privat).
- [ ] Configure `PRIVACY_POLICY_URL` and `TERMS_URL` in tenant settings.
- [ ] Ensure consent checkboxes are present on public forms.
- [ ] Ensure cookie/analytics notices are enabled for public portals.
- [ ] Configure retention for analytics and audit tables as required.
