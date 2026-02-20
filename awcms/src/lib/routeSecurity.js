const STORAGE_KEY = 'awcms.routeSecurityKey';
const STORAGE_VERSION = 'v1';
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 12;

const isBrowser = () => typeof window !== 'undefined';

const toBase64Url = (bytes) => {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const generateKey = () => {
  if (!isBrowser() || !window.crypto?.getRandomValues) return null;
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
};

const readStoredKey = () => {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.value || parsed?.version !== STORAGE_VERSION) return null;
    if (Date.now() > parsed.expiresAt) return null;
    return parsed.value;
  } catch (_error) {
    return null;
  }
};

const storeKey = (value, ttlMs = DEFAULT_TTL_MS) => {
  if (!isBrowser()) return;
  const payload = {
    value,
    version: STORAGE_VERSION,
    expiresAt: Date.now() + ttlMs,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
};

const getRouteKey = () => {
  const stored = readStoredKey();
  if (stored) return stored;
  const generated = generateKey();
  if (generated) storeKey(generated);
  return generated;
};

const hashValue = async (value) => {
  if (!isBrowser() || !window.crypto?.subtle) return null;
  const data = new TextEncoder().encode(value);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
  return toBase64Url(new Uint8Array(hashBuffer));
};

export const isLikelyUuid = (value) => (
  typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
);

export const encodeRouteParam = async ({ value, scope }) => {
  if (!value) return null;
  const routeKey = getRouteKey();
  if (!routeKey) return value;
  const signature = await hashValue(`${STORAGE_VERSION}:${routeKey}:${scope}:${value}`);
  if (!signature) return value;
  return `${value}.${signature.slice(0, 24)}`;
};

export const decodeRouteParam = async ({ value, scope }) => {
  if (!value) return null;
  const [raw, signature] = value.split('.');
  if (!raw || !signature || !isLikelyUuid(raw)) return null;
  const routeKey = getRouteKey();
  if (!routeKey) return null;
  const expected = await hashValue(`${STORAGE_VERSION}:${routeKey}:${scope}:${raw}`);
  if (!expected) return null;
  return expected.slice(0, 24) === signature ? raw : null;
};
