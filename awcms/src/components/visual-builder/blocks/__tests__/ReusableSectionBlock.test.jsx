import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ReusableSectionBlock } from '../ReusableSectionBlock';

const fromMock = vi.fn();

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
    const resolved = Promise.resolve({
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

    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      is: vi.fn(() => query),
      or: vi.fn(() => query),
      maybeSingle: vi.fn(() => resolved),
    };

    fromMock.mockReturnValue(query);

    render(<ReusableSectionBlock sectionSlug="hero-section" title="Reusable Section" puck={{ isEditing: true }} />);

    await waitFor(() => {
      expect(screen.getByText(/2 block\(s\) • Hero, Text • source visual/)).toBeInTheDocument();
    });
  });

  it('shows preview summary for referenced template part content', async () => {
    const partResolved = Promise.resolve({
      data: { content: { content: [{ type: 'Feature' }] } },
      error: null,
    });

    const partQuery = {
      select: vi.fn(() => partQuery),
      eq: vi.fn(() => partQuery),
      is: vi.fn(() => partQuery),
      or: vi.fn(() => partQuery),
      maybeSingle: vi.fn(() => partResolved),
    };

    const sectionResolved = Promise.resolve({
      data: {
        section_mode: 'template_part_reference',
        content: null,
        template_part_id: 'part-1',
      },
      error: null,
    });

    const sectionQuery = {
      select: vi.fn(() => sectionQuery),
      eq: vi.fn(() => sectionQuery),
      is: vi.fn(() => sectionQuery),
      or: vi.fn(() => sectionQuery),
      maybeSingle: vi.fn(() => sectionResolved),
    };

    fromMock.mockImplementation((table) => (table === 'reusable_sections' ? sectionQuery : partQuery));

    render(<ReusableSectionBlock sectionSlug="feature-section" title="Reusable Section" puck={{ isEditing: true }} />);

    await waitFor(() => {
      expect(screen.getByText(/1 block\(s\) • Feature • source template_part_reference/)).toBeInTheDocument();
    });
  });
});
