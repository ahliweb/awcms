const FALLBACK_EDGE_URL = 'http://localhost:8787';

export const getEdgeBaseUrl = () => {
  const configuredUrl = import.meta.env.VITE_EDGE_URL?.trim();
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, '');
  }

  return FALLBACK_EDGE_URL;
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
