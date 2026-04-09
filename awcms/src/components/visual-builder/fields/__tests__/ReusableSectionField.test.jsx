import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ReusableSectionField } from '../ReusableSectionField';
import { supabase } from '@/lib/customSupabaseClient';

function createThenableChain(result) {
  const resolved = Promise.resolve(result);
  const chain = {
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    order: vi.fn(() => chain),
    or: vi.fn(() => chain),
    then: resolved.then.bind(resolved),
    catch: resolved.catch.bind(resolved),
    finally: resolved.finally.bind(resolved),
  };
  return chain;
}

vi.mock('@/lib/customSupabaseClient', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ currentTenant: { id: 'tenant-1', name: 'Tenant One' } }),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }) => <div>{children}</div>,
  SelectTrigger: ({ children, ...props }) => <button type="button" {...props}>{children}</button>,
  SelectValue: ({ placeholder }) => <span>{placeholder}</span>,
  SelectContent: ({ children }) => <div>{children}</div>,
  SelectGroup: ({ children }) => <div>{children}</div>,
  SelectLabel: ({ children }) => <div>{children}</div>,
  SelectItem: ({ children }) => <div>{children}</div>,
}));

describe('ReusableSectionField', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const chain = createThenableChain({
      data: [
        { id: 'section-1', name: 'Hero Section', slug: 'hero-section', owner_tenant_id: null, status: 'active' },
      ],
      error: null,
    });
    supabase.from.mockReturnValue({ select: () => chain });
  });

  it('loads reusable section options and shows the current slug', async () => {
    const onChange = vi.fn();

    render(<ReusableSectionField name="sectionSlug" value="hero-section" onChange={onChange} field={{ label: 'Section Slug' }} />);

    await waitFor(() => {
      expect(screen.getByText(/Hero Section/)).toBeInTheDocument();
    });

    expect(screen.getByText(/Slug:/)).toBeInTheDocument();
    expect(screen.getByText('hero-section')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
