import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ReusableSectionBlock } from '../ReusableSectionBlock';

const fromMock = vi.fn();

function createSectionChain(result) {
  const resolved = Promise.resolve(result);
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    or: vi.fn(() => chain),
    maybeSingle: vi.fn(() => resolved),
  };
  return chain;
}

vi.mock('@/lib/customSupabaseClient', () => ({
  supabase: {
    from: (...args) => fromMock(...args),
  },
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ currentTenant: { id: 'tenant-1', name: 'Tenant One' } }),
}));

describe('ReusableSectionBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows preview summary for visual section content', async () => {
    const query = createSectionChain({
      data: {
        section_mode: 'visual',
        content: {
          content: [
            { type: 'Hero' },
            { type: 'Text' },
          ],
        },
        template_part_id: null,
      },
      error: null,
    });

    fromMock.mockReturnValue(query);

    render(<ReusableSectionBlock sectionSlug="hero-section" title="Reusable Section" puck={{ isEditing: true }} />);

    await waitFor(() => {
      expect(screen.getByText(/2 block\(s\) • Hero, Text • source visual/)).toBeInTheDocument();
    });
  });

  it('shows preview summary for referenced template part content', async () => {
    const partQuery = createSectionChain({
      data: { content: { content: [{ type: 'Feature' }] } },
      error: null,
    });

    const sectionQuery = createSectionChain({
      data: {
        section_mode: 'template_part_reference',
        content: null,
        template_part_id: 'part-1',
      },
      error: null,
    });

    fromMock.mockImplementation((table) => (table === 'reusable_sections' ? sectionQuery : partQuery));

    render(<ReusableSectionBlock sectionSlug="feature-section" title="Reusable Section" puck={{ isEditing: true }} />);

    await waitFor(() => {
      expect(screen.getByText(/1 block\(s\) • Feature • source template_part_reference/)).toBeInTheDocument();
    });
  });
});
