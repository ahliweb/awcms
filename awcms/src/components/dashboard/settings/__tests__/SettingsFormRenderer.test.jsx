import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SettingsFormRenderer from '../SettingsFormRenderer';

function SettingsFormRendererHarness() {
  const [value, setValue] = useState({
    site: { name: '' },
    maintenance: false,
    message: '',
  });

  return (
    <div>
      <SettingsFormRenderer
        schema={{
          slots: {
            before: [{ type: 'alert', title: 'Before Slot', description: 'Schema-driven intro' }],
            after: [{ type: 'card', title: 'After Slot', description: 'Schema-driven outro' }],
          },
          fields: [
            { name: 'site.name', label: 'Site Name', placeholder: 'Enter site name' },
            {
              name: 'maintenance',
              label: 'Maintenance',
              inputType: 'boolean',
              toggleLabel: 'Enable maintenance mode',
              helpText: 'Shown to administrators before saving.',
            },
            {
              name: 'message',
              label: 'Maintenance Message',
              inputType: 'textarea',
              placeholder: 'Maintenance message',
              fullWidth: true,
            },
          ],
        }}
        value={value}
        onChange={setValue}
        preSections={[<div key="pre-section">Pre Section</div>]}
        postSections={[<div key="post-section">Post Section</div>]}
      />

      <output data-testid="settings-state">{JSON.stringify(value)}</output>
    </div>
  );
}

describe('SettingsFormRenderer', () => {
  it('renders schema slots and injected pre/post sections', () => {
    render(<SettingsFormRendererHarness />);

    expect(screen.getByText('Before Slot')).toBeInTheDocument();
    expect(screen.getByText('Schema-driven intro')).toBeInTheDocument();
    expect(screen.getByText('Pre Section')).toBeInTheDocument();
    expect(screen.getByText('Post Section')).toBeInTheDocument();
    expect(screen.getByText('After Slot')).toBeInTheDocument();
    expect(screen.getByText('Schema-driven outro')).toBeInTheDocument();
  });

  it('updates nested text, textarea, and boolean values through onChange', () => {
    render(<SettingsFormRendererHarness />);

    fireEvent.change(screen.getByLabelText('Site Name'), {
      target: { value: 'AWCMS School Portal' },
    });
    fireEvent.change(screen.getByLabelText('Maintenance Message'), {
      target: { value: 'Planned maintenance window tonight.' },
    });
    fireEvent.click(screen.getByRole('switch', { name: 'Maintenance' }));

    expect(screen.getByTestId('settings-state')).toHaveTextContent('AWCMS School Portal');
    expect(screen.getByTestId('settings-state')).toHaveTextContent('Planned maintenance window tonight.');
    expect(screen.getByTestId('settings-state')).toHaveTextContent('"maintenance":true');
  });
});
