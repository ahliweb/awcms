import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TemplateSelector from '../TemplateSelector';

const fromMock = vi.fn();

vi.mock('@/lib/customSupabaseClient', () => ({
  supabase: {
    from: (...args) => fromMock(...args),
  },
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }) => <div>{children}</div>,
  DialogContent: ({ children, ...props }) => <div {...props}>{children}</div>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <h2>{children}</h2>,
  DialogDescription: ({ children }) => <p>{children}</p>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }) => <div>{children}</div>,
  TabsList: ({ children }) => <div>{children}</div>,
  TabsTrigger: ({ children, value, ...props }) => <button data-value={value} {...props}>{children}</button>,
  TabsContent: ({ children }) => <div>{children}</div>,
}));

describe('TemplateSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    fromMock.mockImplementation((table) => {
      if (table === 'templates') {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: [], error: null }),
            }),
          }),
        };
      }

      if (table === 'reusable_sections') {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                order: async () => ({
                  data: [
                    {
                      id: 'section-1',
                      name: 'Hero Section',
                      description: 'Reusable hero',
                      section_mode: 'visual',
                      owner_tenant_id: null,
                      content: { content: [{ type: 'Hero', props: { title: 'Hello' } }], root: { props: {} } },
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }

      if (table === 'template_parts') {
        return {
          select: () => ({
            in: async () => ({ data: [], error: null }),
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });
  });

  it('allows selecting and inserting a reusable section', async () => {
    const onSelect = vi.fn();
    render(<TemplateSelector open onOpenChange={() => {}} onSelect={onSelect} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reusable Sections' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reusable Sections' }));
    fireEvent.click(screen.getByText('Hero Section'));
    fireEvent.click(screen.getByRole('button', { name: 'Insert Section' }));

    expect(onSelect).toHaveBeenCalledWith({
      content: [{ type: 'Hero', props: { title: 'Hello' } }],
      root: { props: {} },
    });
  });
});
