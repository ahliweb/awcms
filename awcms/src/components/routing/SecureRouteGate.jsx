import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import RouteSecurityContext from '@/contexts/RouteSecurityContext';
import { decodeRouteParam, encodeRouteParam, isLikelyUuid } from '@/lib/routeSecurity';

const buildPath = (path, params) => path
  .split('/')
  .map((segment) => {
    if (!segment.startsWith(':')) return segment;
    const key = segment.slice(1);
    return params[key] || segment;
  })
  .join('/');

const SecureRouteGate = ({
  routePath,
  secureParams = [],
  scopeBase,
  fallback = '/cmspanel',
  loadingFallback = null,
  children,
}) => {
  const params = useParams();
  const navigate = useNavigate();
  const hasSecureParams = secureParams.length > 0;

  const scopePrefix = useMemo(() => {
    if (scopeBase) return scopeBase;
    return `plugin:${routePath.replace(/\//g, '.')}`;
  }, [routePath, scopeBase]);

  const resolutionKey = useMemo(() => {
    if (!hasSecureParams) return 'open';
    return secureParams.map((key) => `${key}:${params[key] || ''}`).join('|');
  }, [hasSecureParams, params, secureParams]);

  const [resolution, setResolution] = useState(() => ({
    key: resolutionKey,
    decodedParams: null,
    loading: hasSecureParams,
  }));

  const { decodedParams, loading } = useMemo(() => {
    if (!hasSecureParams) {
      return { decodedParams: null, loading: false };
    }

    if (resolution.key !== resolutionKey) {
      return { decodedParams: null, loading: true };
    }

    return resolution;
  }, [hasSecureParams, resolution, resolutionKey]);

  useEffect(() => {
    let active = true;

    if (!hasSecureParams) {
      return;
    }

    const resolveParams = async () => {
      const decoded = {};
      const signedParams = { ...params };
      let needsRedirect = false;

      for (const key of secureParams) {
        const rawValue = params[key];
        if (!rawValue) {
          navigate(fallback, { replace: true });
          return;
        }

        const scope = `${scopePrefix}.${key}`;
        const decodedValue = await decodeRouteParam({ value: rawValue, scope });
        if (decodedValue) {
          decoded[key] = decodedValue;
          continue;
        }

        if (!isLikelyUuid(rawValue)) {
          navigate(fallback, { replace: true });
          return;
        }

        const signedValue = await encodeRouteParam({ value: rawValue, scope });
        if (!signedValue || signedValue === rawValue) {
          navigate(fallback, { replace: true });
          return;
        }

        decoded[key] = rawValue;
        signedParams[key] = signedValue;
        needsRedirect = true;
      }

      if (!active) return;

      if (needsRedirect) {
        const nextPath = buildPath(routePath, signedParams);
        if (nextPath) {
          navigate(`/cmspanel/${nextPath}`, { replace: true });
        }
        return;
      }

      setResolution({
        key: resolutionKey,
        decodedParams: decoded,
        loading: false,
      });
    };

    resolveParams();

    return () => {
      active = false;
    };
  }, [params, secureParams, hasSecureParams, scopePrefix, routePath, fallback, navigate, resolutionKey]);

  if (loading) return loadingFallback;

  const content = typeof children === 'function' ? children(decodedParams) : children;

  return (
    <RouteSecurityContext.Provider value={decodedParams}>
      {content}
    </RouteSecurityContext.Provider>
  );
};

export default SecureRouteGate;
