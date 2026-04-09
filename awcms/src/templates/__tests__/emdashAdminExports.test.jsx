import { describe, expect, it } from 'vitest';

import * as FlowbiteAdmin from '@/templates/flowbite-admin';
import * as EmdashAdmin from '@/templates/emdash-admin';

describe('emdash admin template exports', () => {
  it('re-exports the shared admin shell API', () => {
    expect(EmdashAdmin.AdminPageLayout).toBe(FlowbiteAdmin.AdminPageLayout);
    expect(EmdashAdmin.PageHeader).toBe(FlowbiteAdmin.PageHeader);
    expect(EmdashAdmin.PageTabs).toBe(FlowbiteAdmin.PageTabs);
    expect(EmdashAdmin.TabsContent).toBe(FlowbiteAdmin.TabsContent);
    expect(EmdashAdmin.Sidebar).toBe(FlowbiteAdmin.Sidebar);
    expect(EmdashAdmin.Footer).toBe(FlowbiteAdmin.Footer);
    expect(EmdashAdmin.TEMPLATE_NAME).toBe('emdash-admin-react');
  });
});
