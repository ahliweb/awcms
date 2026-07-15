export type SecurityHeaderOptions = {
  /** Gates `Strict-Transport-Security` — only meaningful once TLS is real. */
  isProduction: boolean;
};

export function buildSecurityHeaders(
  options: SecurityHeaderOptions
): Array<[string, string]> {
  const headers: Array<[string, string]> = [
    ["X-Content-Type-Options", "nosniff"],
    ["X-Frame-Options", "DENY"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    [
      "Permissions-Policy",
      "geolocation=(), camera=(), microphone=(), payment=()"
    ]
  ];

  if (options.isProduction) {
    headers.push([
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    ]);
  }

  return headers;
}
