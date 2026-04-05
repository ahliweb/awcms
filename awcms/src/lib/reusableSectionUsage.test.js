import { describe, expect, it } from 'vitest';
import { extractReusableSectionReferences } from './reusableSectionUsage';

describe('extractReusableSectionReferences', () => {
  it('finds reusable section blocks in nested puck content', () => {
    const content = {
      content: [
        { type: 'Hero', props: { title: 'Hello' } },
        {
          type: 'ReusableSection',
          props: { sectionSlug: 'hero-shared' },
        },
      ],
      root: {
        props: {},
        children: [
          {
            type: 'Container',
            props: {},
            content: [
              {
                type: 'ReusableSection',
                props: { sectionSlug: 'footer-shared' },
              },
            ],
          },
        ],
      },
    };

    expect(extractReusableSectionReferences(content)).toEqual([
      { slug: 'hero-shared', usagePath: 'root.content[1]' },
      { slug: 'footer-shared', usagePath: 'root.root.children[0].content[0]' },
    ]);
  });
});
