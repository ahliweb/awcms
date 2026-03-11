const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getEnvValue = (key) => {
  const value = import.meta.env[key];
  return typeof value === 'string' ? value.trim() : '';
};

const getConfiguredEdgeFallbackUrl = () => {
  const supabaseUrl = getEnvValue('VITE_SUPABASE_URL');
  const isLocalSupabase = supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('localhost');

  if (isLocalSupabase) {
    return getEnvValue('VITE_LOCAL_EDGE_URL');
  }

  return getEnvValue('VITE_REMOTE_EDGE_URL');
};

export const getEdgeBaseUrl = () => {
  const configuredUrl = getEnvValue('VITE_EDGE_URL');
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, '');
  }

  return getConfiguredEdgeFallbackUrl().replace(/\/$/, '');
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

export const buildMediaAccessApiUrl = (mediaId) => {
  if (!mediaId) return '';
  return `${getEdgeBaseUrl()}/api/media/file/${encodeURIComponent(mediaId)}/access`;
};

export const getSecureMediaSessionMaxAgeSeconds = () => parsePositiveInt(
  getEnvValue('VITE_MEDIA_SECURE_SESSION_MAX_AGE_SECONDS'),
  parsePositiveInt(getEnvValue('VITE_DEFAULT_SECURE_MEDIA_SESSION_MAX_AGE_SECONDS'), 900),
);

export const isSessionBoundMedia = (file) => Boolean(file?.session_bound_access);

export const hasProtectedStoragePrefix = (storageKey) => String(storageKey || '').includes('/protected/');

export const resolveMediaUrl = (file) => {
  if (!file) return '';

  if (file.access_url) return file.access_url;

   if (isSessionBoundMedia(file)) return '';

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
