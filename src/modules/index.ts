import type { ModuleDescriptor } from "./_shared/module-contract";
import { loggingModule } from "./logging/module";
import { tenantAdminModule } from "./tenant-admin/module";
import { profileIdentityModule } from "./profile-identity/module";
import { identityAccessModule } from "./identity-access/module";
import { moduleManagementModule } from "./module-management/module";
import { domainEventRuntimeModule } from "./domain-event-runtime/module";

export const modules: ModuleDescriptor[] = [
  loggingModule,
  tenantAdminModule,
  profileIdentityModule,
  identityAccessModule,
  moduleManagementModule,
  domainEventRuntimeModule
];

export function listModules(): ModuleDescriptor[] {
  return modules;
}

export function getModuleByKey(
  moduleKey: string
): ModuleDescriptor | undefined {
  return modules.find((module) => module.key === moduleKey);
}
