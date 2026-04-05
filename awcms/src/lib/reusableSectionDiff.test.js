import { describe, expect, it } from 'vitest';
import { compareReusableSectionRevision, compareReusableSectionRevisions } from './reusableSectionDiff';

describe('compareReusableSectionRevision', () => {
  it('detects changed and unchanged fields between current section and revision snapshot', () => {
    const currentSection = {
      name: 'Hero Section',
      slug: 'hero-section',
      description: 'Updated description',
      section_mode: 'visual',
      status: 'active',
      content: { content: [{ type: 'Hero' }] },
      metadata: { theme: 'dark' },
      template_part_id: null,
      owner_tenant_id: null,
    };

    const snapshot = {
      name: 'Hero Section',
      slug: 'hero-section',
      description: 'Original description',
      section_mode: 'visual',
      status: 'draft',
      content: { content: [{ type: 'Hero' }, { type: 'Button' }] },
      metadata: { theme: 'light' },
      template_part_id: null,
      owner_tenant_id: null,
    };

    const result = compareReusableSectionRevision(currentSection, snapshot);

    expect(result.hasChanges).toBe(true);
    expect(result.changedFields.map((field) => field.key)).toEqual(expect.arrayContaining(['description', 'status', 'content', 'metadata']));
    expect(result.unchangedFields.map((field) => field.key)).toEqual(expect.arrayContaining(['name', 'slug', 'section_mode']));
  });

  it('compares two revision snapshots directly', () => {
    const left = {
      name: 'Hero Section',
      slug: 'hero-section',
      description: 'First version',
      section_mode: 'visual',
      status: 'draft',
      content: { content: [{ type: 'Hero' }] },
      metadata: { theme: 'light' },
      template_part_id: null,
      owner_tenant_id: null,
    };

    const right = {
      name: 'Hero Section',
      slug: 'hero-section-v2',
      description: 'Second version',
      section_mode: 'visual',
      status: 'active',
      content: { content: [{ type: 'Hero' }, { type: 'Button' }] },
      metadata: { theme: 'dark' },
      template_part_id: null,
      owner_tenant_id: null,
    };

    const result = compareReusableSectionRevisions(left, right);

    expect(result.hasChanges).toBe(true);
    expect(result.changedFields.map((field) => field.key)).toEqual(expect.arrayContaining(['slug', 'description', 'status', 'content', 'metadata']));
  });
});
