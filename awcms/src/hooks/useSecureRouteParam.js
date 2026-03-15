import { useEffect, useMemo, useState } from 'react';
import { decodeRouteParam, isLikelyUuid } from '@/lib/routeSecurity';

const useSecureRouteParam = (encodedValue, scope) => {
  const hasValue = Boolean(encodedValue);
  const resolutionKey = `${scope || ''}:${encodedValue || ''}`;
  const [resolution, setResolution] = useState(() => ({
    key: resolutionKey,
    value: null,
    loading: hasValue,
    isLegacy: false,
  }));

  const { value, loading, isLegacy } = useMemo(() => {
    if (!hasValue) {
      return { value: null, loading: false, isLegacy: false };
    }

    if (resolution.key !== resolutionKey) {
      return { value: null, loading: true, isLegacy: false };
    }

    return resolution;
  }, [hasValue, resolution, resolutionKey]);

  useEffect(() => {
    let active = true;

    if (!hasValue) {
      return;
    }

    const resolveValue = async () => {
      const decoded = await decodeRouteParam({ value: encodedValue, scope });
      if (!active) return;

      let nextValue = null;
      let nextIsLegacy = false;

      if (decoded) {
        nextValue = decoded;
      } else if (isLikelyUuid(encodedValue)) {
        nextValue = encodedValue;
        nextIsLegacy = true;
      }

      setResolution({
        key: resolutionKey,
        value: nextValue,
        loading: false,
        isLegacy: nextIsLegacy,
      });
    };

    resolveValue();

    return () => {
      active = false;
    };
  }, [encodedValue, hasValue, scope, resolutionKey]);

  return {
    value,
    loading,
    isLegacy,
    valid: Boolean(value),
  };
};

export default useSecureRouteParam;
