import { describe, expect, it } from 'vitest';
import { detachReusableSectionAtPath, extractReusableSectionReferences } from './reusableSectionUsage';

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

  it('detaches a reusable section by replacing it with resolved block content', () => {
    const content = {
      content: [
        { type: 'Text', props: { text: 'Before' } },
        { type: 'ReusableSection', props: { sectionSlug: 'hero-shared' } },
        { type: 'Text', props: { text: 'After' } },
      ],
      root: { props: {} },
    };

    const replacement = {
      content: [
        { type: 'Hero', props: { title: 'Hello' } },
        { type: 'Button', props: { label: 'Go' } },
      ],
      root: { props: {} },
    };

    expect(detachReusableSectionAtPath(content, 'root.content[1]', replacement)).toEqual({
      content: [
        { type: 'Text', props: { text: 'Before' } },
        { type: 'Hero', props: { title: 'Hello' } },
        { type: 'Button', props: { label: 'Go' } },
        { type: 'Text', props: { text: 'After' } },
      ],
      root: { props: {} },
    });
  });
});
