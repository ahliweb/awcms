/**
 * objectKeys.test.js
 * Unit tests for R2 object key generation and parsing.
 */

import { describe, it, expect } from 'vitest';
import { generateObjectKey, parseObjectKey } from '../objectKeys';

const VALID_PARAMS = {
  projectCode:       'sikesra',
  environment:       'production',
  tenantId:          '550e8400-e29b-41d4-a716-446655440000',
  module:            'media',
  objectId:          'b5e300aa-0000-0000-0000-000000000001',
  variantOrFilename: 'original.jpg',
};

describe('generateObjectKey', () => {
  it('produces the canonical key format', () => {
    const key = generateObjectKey(VALID_PARAMS);
    expect(key).toBe(
      'sikesra/production/550e8400-e29b-41d4-a716-446655440000/media/b5e300aa-0000-0000-0000-000000000001/original.jpg'
    );
  });

  it('lowercases projectCode and environment', () => {
    const key = generateObjectKey({ ...VALID_PARAMS, projectCode: 'SIKESRA', environment: 'Production' });
    expect(key.startsWith('sikesra/production/')).toBe(true);
  });

  it('throws if any required field is missing', () => {
    expect(() => generateObjectKey({ ...VALID_PARAMS, tenantId: '' })).toThrow(/tenantId/);
    expect(() => generateObjectKey({ ...VALID_PARAMS, module: undefined })).toThrow(/module/);
  });
});

describe('parseObjectKey', () => {
  it('round-trips with generateObjectKey', () => {
    const key = generateObjectKey(VALID_PARAMS);
    const parsed = parseObjectKey(key);
    expect(parsed.projectCode).toBe('sikesra');
    expect(parsed.tenantId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(parsed.variantOrFilename).toBe('original.jpg');
  });

  it('throws if fewer than 6 segments', () => {
    expect(() => parseObjectKey('too/short/key')).toThrow(/6 segments/);
  });
});
