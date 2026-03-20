const MODULES_CHANGED_EVENT = 'awcms:modules-changed';

export function dispatchModulesChanged(detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(MODULES_CHANGED_EVENT, { detail }));
}

export function subscribeToModulesChanged(handler) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const listener = (event) => {
    handler(event?.detail || {});
  };

  window.addEventListener(MODULES_CHANGED_EVENT, listener);

  return () => {
    window.removeEventListener(MODULES_CHANGED_EVENT, listener);
  };
}

export { MODULES_CHANGED_EVENT };
