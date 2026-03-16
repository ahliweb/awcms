import assert from 'node:assert/strict';
import { createClientFromEnv } from '../src/supabase.ts';

const fakeClient = {
  auth: {
    getSession: async () => ({ data: { session: null } }),
  },
  functions: {
    fetch: fetch,
    invoke: async () => ({ data: null, error: null }),
  },
};

const client = createClientFromEnv(
  () => ({ ...fakeClient }),
  {
    PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_key',
    PUBLIC_EDGE_URL: 'http://127.0.0.1:8787',
  },
);

assert.ok(client, 'client should be created');
assert.throws(
  () => client.storage.from('cms-uploads'),
  /Supabase Storage is disabled in AWCMS/,
);

console.log('shared storage guard ok');
