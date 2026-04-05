import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ReusableSectionField } from '../ReusableSectionField';

const eqMock = vi.fn();
const isMock = vi.fn();
const orderMock = vi.fn();

vi.mock('@/lib/customSupabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: () => ({
        eq: eqMock,
      }),
    })),
  },
}));

describe('ReusableSectionField', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orderMock.mockResolvedValue({
      data: [
        { id: 'section-1', name: 'Hero Section', slug: 'hero-section', owner_tenant_id: null, status: 'active' },
      ],
      error: null,
    });
    isMock.mockReturnValue({ order: orderMock });
    eqMock.mockReturnValue({ is: isMock });
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
