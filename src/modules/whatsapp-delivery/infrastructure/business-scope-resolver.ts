/**
 * The business-scope resolver `whatsapp_delivery` uses to check that the brand of
 * a MARKETING message is a real scope of the tenant (Issue #1231 M4, audit M-1).
 *
 * The SAME adapter the consent route resolves a recorded brand against
 * (`channel_accounts`' `authorizeRequestedScope` uses it too): `tenant_admin`'s
 * office hierarchy (ADR-0060). `tenant_admin` is a declared dependency of this
 * module, so this is a plain import. Today the only resolvable scope type is
 * `office`; every other type is `resolved: false`, which the enqueue treats as a
 * refusal (fail closed), never as "no brand".
 */
import type { BusinessScopeHierarchyPort } from "../../_shared/ports/business-scope-hierarchy-port";
import { officeScopeHierarchyPortAdapter } from "../../tenant-admin/application/office-scope-hierarchy-port-adapter";

export const whatsappBusinessScopeResolver: BusinessScopeHierarchyPort =
  officeScopeHierarchyPortAdapter;
