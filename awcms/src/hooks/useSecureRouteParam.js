import { useEffect, useState } from 'react';
import { decodeRouteParam, isLikelyUuid } from '@/lib/routeSecurity';

const useSecureRouteParam = (encodedValue, scope) => {
  const [value, setValue] = useState(null);
  const [loading, setLoading] = useState(Boolean(encodedValue));
  const [isLegacy, setIsLegacy] = useState(false);

  useEffect(() => {
    let active = true;

    if (!encodedValue) {
      queueMicrotask(() => {
        if (!active) return;
        setValue(null);
        setLoading(false);
        setIsLegacy(false);
      });
      return () => {
        active = false;
      };
    }

    const resolveValue = async () => {
      const decoded = await decodeRouteParam({ value: encodedValue, scope });
      if (!active) return;
      if (decoded) {
        setValue(decoded);
        setIsLegacy(false);
      } else if (isLikelyUuid(encodedValue)) {
        setValue(encodedValue);
        setIsLegacy(true);
      } else {
        setValue(null);
        setIsLegacy(false);
      }
      setLoading(false);
    };

    resolveValue();

    return () => {
      active = false;
    };
  }, [encodedValue, scope]);

  return {
    value,
    loading,
    isLegacy,
    valid: Boolean(value),
  };
};

export default useSecureRouteParam;
