import { describe, expect, it } from 'vitest';
import { supabase } from '@/lib/customSupabaseClient';

describe('customSupabaseClient storage guard', () => {
  it('blocks Supabase Storage access in maintained clients', () => {
    expect(() => supabase.storage.from('cms-uploads')).toThrow(
      'Supabase Storage is disabled in AWCMS. Use Cloudflare R2 through the Cloudflare Edge API.',
    );
  });
});
