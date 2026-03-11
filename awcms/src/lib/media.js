const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getEnvValue = (key) => {
  const value = import.meta.env[key];
  return typeof value === 'string' ? value.trim() : '';
};

const getWorkerApiTimeoutMs = () => parsePositiveInt(
  getEnvValue('VITE_EDGE_API_TIMEOUT_MS'),
  8000,
);

const getConfiguredEdgeFallbackUrl = () => {
  const supabaseUrl = getEnvValue('VITE_SUPABASE_URL');
  const isLocalSupabase = supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('localhost');

  if (isLocalSupabase) {
    return getEnvValue('VITE_LOCAL_EDGE_URL');
  }

  return getEnvValue('VITE_REMOTE_EDGE_URL');
};

export const isLocalEdgeRuntime = () => {
  const edgeUrl = getEdgeBaseUrl();
  return edgeUrl.includes('127.0.0.1') || edgeUrl.includes('localhost');
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

export const getLocalEdgeStartupHint = () => (
  'Cloudflare Edge API is not reachable. Start `awcms-edge` with `npm run dev:local` or run `npm run dev:full` in `awcms/`.'
);

export const createEdgeApiUnavailableError = (context = 'request') => {
  const baseUrl = getEdgeBaseUrl();
  const message = isLocalEdgeRuntime()
    ? `${context} failed because the Cloudflare Edge API is not reachable at ${baseUrl}. ${getLocalEdgeStartupHint()}`
    : `${context} failed because the Cloudflare Edge API is not reachable at ${baseUrl}.`;
  const error = new Error(message);
  error.name = 'EdgeApiUnavailableError';
  return error;
};

export const isEdgeApiUnavailableError = (error) => (
  error?.name === 'EdgeApiUnavailableError'
  || error?.name === 'AbortError'
  || error instanceof TypeError
  || error?.message?.includes('Failed to fetch')
  || error?.message?.includes('ERR_CONNECTION_REFUSED')
  || error?.message?.includes('Worker API timeout')
);

export const fetchEdgeApi = async (path, options = {}) => {
  const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutMs = getWorkerApiTimeoutMs();
  const timeoutId = abortController
    ? window.setTimeout(() => abortController.abort(new Error(`Worker API timeout after ${timeoutMs}ms`)), timeoutMs)
    : null;

  try {
    return await fetch(`${getEdgeBaseUrl()}${path}`, {
      ...options,
      signal: abortController?.signal,
    });
  } catch (error) {
    if (isEdgeApiUnavailableError(error)) {
      throw createEdgeApiUnavailableError(path);
    }
    throw error;
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
};

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
