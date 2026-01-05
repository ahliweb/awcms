import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';

/**
 * Cloudflare Turnstile CAPTCHA Component
 * 
 * @param {string} siteKey - Turnstile Site Key
 * @param {function} onVerify - Callback when verification succeeds, receives token
 * @param {function} onError - Callback when verification fails
 * @param {function} onExpire - Callback when token expires
 * @param {string} theme - 'light', 'dark', or 'auto'
 * @param {string} size - 'normal' or 'compact'
 */
const Turnstile = ({
    siteKey,
    onVerify,
    onError,
    onExpire,
    theme = 'auto',
    size,
    appearance = 'always',
    className = '',
}) => {
    const containerRef = useRef(null);
    const widgetIdRef = useRef(null);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const [scriptLoaded, setScriptLoaded] = useState(false);

    // Load Turnstile script
    useEffect(() => {
        const scriptId = 'turnstile-script';
        let loadInterval = null;

        // Function to handle script ready
        const onScriptReady = () => {
            if (window.turnstile) {
                console.log('[Turnstile] Script ready');
                setScriptLoaded(true);
                setIsLoading(false);
                if (loadInterval) clearInterval(loadInterval);
            }
        };

        // 1. Check if already available
        if (window.turnstile) {
            onScriptReady();
            return;
        }

        // 2. Setup Polling (Robustness)
        loadInterval = setInterval(onScriptReady, 100);

        // 3. Check/Create Script
        let script = document.getElementById(scriptId);
        if (!script) {
            script = document.createElement('script');
            script.id = scriptId;
            script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
            script.async = true;
            script.defer = true;
            document.head.appendChild(script);
        }

        // Timeout fallback
        const timeout = setTimeout(() => {
            if (!window.turnstile) {
                console.error('[Turnstile] Script load timeout');
                if (loadInterval) clearInterval(loadInterval);
                setIsLoading(false);
                setHasError(true);
                onError?.();
            }
        }, 15000); // 15 seconds

        return () => {
            if (loadInterval) clearInterval(loadInterval);
            clearTimeout(timeout);
            // Cleanup widget on unmount
            if (widgetIdRef.current && window.turnstile) {
                try {
                    window.turnstile.remove(widgetIdRef.current);
                    widgetIdRef.current = null;
                } catch (e) {
                    console.warn('Turnstile cleanup error:', e);
                }
            }
        };
    }, [onError]);

    // Render widget when script is loaded
    useEffect(() => {
        if (!scriptLoaded || hasError || !containerRef.current || !window.turnstile) {
            return;
        }

        // Ensure we don't double render
        if (widgetIdRef.current) return;

        console.log('[Turnstile] Rendering widget...');

        // Render new widget
        try {
            const renderOptions = {
                sitekey: siteKey,
                callback: (token) => {
                    console.log('[Turnstile] Verification successful', token ? '(Token received)' : '(No token)');
                    onVerify?.(token);
                },
                'error-callback': (errorCode) => {
                    console.warn('[Turnstile] Error callback:', errorCode);
                    // 600010 is invalid site key
                    if (errorCode === '600010') {
                        console.error('[Turnstile] Critical: Invalid Site Key');
                        setHasError(true);
                        onError?.();
                    }
                },
                'expired-callback': () => {
                    console.log('[Turnstile] Token expired');
                    onExpire?.();
                    if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
                },
                'timeout-callback': () => {
                    console.warn('[Turnstile] Timeout');
                    if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
                },
                'retry': 'never', // Stop looping on error
            };

            console.log('%c [Turnstile] v2.1 loaded: Standard Managed Mode', 'background: #222; color: #00ff00');

            // STRICT validation for Invisible widgets (Error 400020 prevention)
            if (appearance === 'interaction-only') {
                renderOptions.appearance = 'interaction-only';
                // DO NOT include 'size' or 'theme' for invisible widgets
            } else {
                renderOptions.appearance = appearance;
                renderOptions.theme = theme;
                if (size) renderOptions.size = size;
            }

            console.log('[Turnstile] Render options:', { ...renderOptions });
            widgetIdRef.current = window.turnstile.render(containerRef.current, renderOptions);
        } catch (e) {
            console.error('[Turnstile] Exception during render:', e);
            setHasError(true);
            onError?.();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scriptLoaded, hasError, siteKey, theme, size, appearance]);

    // Reset function
    const reset = useCallback(() => {
        if (widgetIdRef.current !== null && window.turnstile) {
            window.turnstile.reset(widgetIdRef.current);
            setHasError(false);
        }
    }, []);

    // Expose reset function via window for external access
    useEffect(() => {
        window.turnstileReset = reset;
        return () => {
            delete window.turnstileReset;
        };
    }, [reset]);

    if (hasError) {
        return (
            <div className={`flex items-center justify-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-600 ${className}`}>
                <AlertCircle className="w-5 h-5" />
                <span className="text-sm font-medium">Security check failed. Please refresh the page.</span>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className={`flex items-center justify-center gap-2 p-4 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 ${className}`}>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Loading security check...</span>
            </div>
        );
    }

    return (
        <div className={`turnstile-wrapper ${className}`}>
            <div
                ref={containerRef}
                className="flex items-center justify-center"
            />
        </div>
    );
};

export default Turnstile;
