const LOCAL_EDGE_URL = 'http://127.0.0.1:8787';
const REMOTE_EDGE_URL = 'https://awcms-edge.ahliweb.workers.dev';

export const getEdgeBaseUrl = () => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || '';
  const isLocalSupabase = supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('localhost');

  if (isLocalSupabase) {
    return LOCAL_EDGE_URL;
  }

  const configuredUrl = import.meta.env.VITE_EDGE_URL?.trim();
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, '');
  }

  return REMOTE_EDGE_URL;
};

export const buildMediaPublicUrl = (storageKey) => {
  if (!storageKey) return '';
  if (storageKey.startsWith('http://') || storageKey.startsWith('https://')) {
    return storageKey;
  }

  const normalizedKey = String(storageKey)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `${getEdgeBaseUrl()}/public/media/${normalizedKey}`;
};

export const resolveMediaUrl = (file) => {
  if (!file) return '';

  return file.public_url
    || file.url
    || buildMediaPublicUrl(file.file_path || file.storage_key || '');
};

export const normalizeMediaKind = (mimeType) => {
  if (!mimeType) return 'other';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (
    mimeType.includes('pdf')
    || mimeType.includes('document')
    || mimeType.includes('text')
    || mimeType.includes('sheet')
    || mimeType.includes('presentation')
  ) {
    return 'document';
  }

  return 'other';
};
