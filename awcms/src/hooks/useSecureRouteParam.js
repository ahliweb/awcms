import { useEffect, useState } from 'react';
import { decodeRouteParam, isLikelyUuid } from '@/lib/routeSecurity';

const useSecureRouteParam = (encodedValue, scope) => {
  const hasValue = Boolean(encodedValue);
  const [value, setValue] = useState(null);
  const [loading, setLoading] = useState(hasValue);
  const [isLegacy, setIsLegacy] = useState(false);

  useEffect(() => {
    let active = true;

    if (!hasValue) {
      return;
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
  }, [encodedValue, hasValue, scope]);

  return {
    value,
    loading,
    isLegacy,
    valid: Boolean(value),
  };
};

export default useSecureRouteParam;
