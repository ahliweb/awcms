# Multi-Tenancy & Role Hierarchy

> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 2.3

## 0. Level 0: Multi-National Federation

To support **Data Sovereignty** (e.g., GDPR, local regulations) and minimize latency, the system architecture supports a **Federated Fleet** model.

- **Concept**: A "Global" organization consists of multiple **Sovereign Instances** (separate Supabase projects).
- **Structure**: Each "National" tenant (Level 1) resides in its own isolated instance.
- **Management**: A separate "Fleet Manager" or aggregation layer (custom tooling) is required to unify billing/reporting across these instances.
- **Hierarchy Context**: The 5-level tenant hierarchy described below applies *within* each Sovereign Instance.

---

## 1. Tenant Hierarchy (5 Levels)

The system supports a maximum depth of **5 nested tenant levels**. This is enforced by the database constraint `tenants_level_check` and the `set_tenant_hierarchy` trigger.

### Dynamic Configuration

While the levels are structurally limited to 5, their logical definitions are **dynamic** and determined by configuration (e.g., via a `regions` setup or administrative policy) rather than hardcoded enums.

**Typical Hierarchy Structure (Example):**

1. **Level 1 (Root)**: National / Holding Company
2. **Level 2**: Provincial / Subsidiary Group
3. **Level 3**: District / Regional Office
4. **Level 4**: Sub-District / Branch
5. **Level 5**: Unit / Franchise

> **Constraint**: `CHECK (level BETWEEN 1 AND 5)`

### Inheritance Modes

Tenants interact with their parents based on `role_inheritance_mode`:

- **Auto** (`auto`): Roles are automatically synced from the parent tenant.
- **Linked** (`linked`): Specific roles are explicitly linked via `tenant_role_links`.

---

## 2. Role Hierarchy (10 Levels)

The system implements a granular **10-level Staff Hierarchy** for internal tenant management. These levels are used for workflow approvals, permission inheritance, and organizational mapping.

### Staff Levels

Defined in `public.roles` via `is_staff = true` and `staff_level`.

| Level | Role Name | Description |
| :--- | :--- | :--- |
| **10** | `super_manager` | **Strategic**. Top-level management (Director/VP). |
| **9** | `senior_manager` | **Strategic**. Senior leadership. |
| **8** | `manager` | **Strategic**. Department manager. |
| **7** | `senior_supervisor`| **Tactical**. Regional/Senior supervisor. |
| **6** | `supervisor` | **Tactical**. Team lead/Supervisor. |
| **5** | `senior_specialist`| **Operational**. Senior individual contributor (subject matter expert). |
| **4** | `specialist` | **Operational**. Experienced contributor. |
| **3** | `associate` | **Operational**. Standard contributor within a team. |
| **2** | `assistant` | **Support**. Junior support role. |
| **1** | `internship` | **Support**. Temporary/Training role (lowest clearance). |

> **Constraint**: `CHECK ((is_staff AND staff_level BETWEEN 1 AND 10) ...)`

### Standard Tenant Roles (Context7 Standard)

These roles form the baseline for all tenants:

- **Admin**: Full tenant management.
- **Auditor**: Read-only access to all tenant resources (compliance/review).
- **Editor**: Content approval and publishing.
- **Author**: Content creation (drafts).
- **Member**: Authenticated end-user (basic access).
- **Subscriber**: Paid/premium access.
- **Public**: Anonymous/Visitor access.
- **No Access**: Blocked/suspended users.

### Staff Roles (Organizational)

- A user typically has one Role that may combine flags (e.g., a `manager` might also have `is_tenant_admin=true`).

## 3. Logical Region Hierarchy (10 Levels)

To support **operational/business boundaries** independent of tenancy, the system implements a **10-level Logical Region Hierarchy**. Users can be assigned to a specific logical region via `users.region_id`.

| Level | Scope | Example |
| :--- | :--- | :--- |
| **1** | Global / Continental | Asia Pacific |
| **2** | National | Indonesia |
| **3** | Provincial / State | Jawa Barat |
| **4** | Residency / Zone | Priangan Timur |
| **5** | District / Regency | Bandung |
| **6** | Sub-District | Cicendo |
| **7** | Area / Ward | Arjuna |
| **8** | Sub-Area / Block | RW 01 |
| **9** | Unit / Cluster | RT 01 |
| **10** | Point / Individual | Household |

> **Constraint**: `CHECK (level BETWEEN 1 AND 10)`

### User Assignment

- **Direct Assignment**: Users are assigned a `region_id`.
- **Inheritance**: Region logic is separate from Tenant logic but can be used for filtering data access in custom policies.

---

## 4. Administrative Region Hierarchy (Indonesian)

To support **legal/government boundaries**, the system implements the standard Indonesian administrative hierarchy sourced from `cahyadsn/wilayah`. Users can be assigned to a specific administrative location via `users.administrative_region_id`.

| Level | Indentifier | Code Format | Example |
| :--- | :--- | :--- | :--- |
| **Provinsi** | Province | `XX` | Jawa Barat (32) |
| **Kabupaten/Kota** | City/Regency | `XX.XX` | Bandung (32.73) |
| **Kecamatan** | District | `XX.XX.XX` | Cicendo (32.73.06) |
| **Kelurahan/Desa** | Village | `XX.XX.XX.XXII` | Arjuna (32.73.06.1004) |

### Administrative User Assignment

- **Administrative Assignment**: `users.administrative_region_id` maps to the legal hierarchy.

### Use Cases

- **Taxation & Compliance**: Based on administrative location.
- **Government Reporting**: Aggregating data by official regions.
- **Logistics**: Shipping calculations based on postal codes/districts.

---

## 5. Database Implementation

### Migrations

- **Tenant Rules**: `20260127160000_tenant_hierarchy_resource_sharing.sql`
- **Role Rules**: `20260127090000_role_flags_staff_hierarchy.sql`
