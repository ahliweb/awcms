import { describe, expect, it } from 'vitest';

import * as EmdashAdmin from '@/templates/emdash-admin';

describe('emdash admin template exports', () => {
  it('exports the shared admin shell API directly', () => {
    expect(EmdashAdmin.AdminPageLayout).toBeTypeOf('function');
    expect(EmdashAdmin.PageHeader).toBeTypeOf('function');
    expect(EmdashAdmin.PageTabs).toBeTypeOf('function');
    expect(EmdashAdmin.TabsContent).toBeTypeOf('function');
    expect(EmdashAdmin.Sidebar).toBeTypeOf('function');
    expect(EmdashAdmin.Footer).toBeTypeOf('function');
    expect(EmdashAdmin.TEMPLATE_NAME).toBe('emdash-admin-react');
    expect(EmdashAdmin.TEMPLATE_VERSION).toBe('2.0.0');
  });
});
