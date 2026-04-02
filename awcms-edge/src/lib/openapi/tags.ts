export const OPENAPI_TAGS = [
  { name: 'Health', description: 'Worker liveness and compatibility endpoints.' },
  { name: 'Public Delivery', description: 'Public content and delivery surfaces safe for anonymous access.' },
  { name: 'Human Verification', description: 'Turnstile and public anti-abuse verification flows.' },
  { name: 'Applications', description: 'Public account application submission workflow.' },
  { name: 'Identity', description: 'Authenticated identity and operator account management surfaces.' },
  { name: 'Media', description: 'Authenticated media upload, access, and deletion flows.' },
  { name: 'Public Portal', description: 'Tenant public rebuild orchestration and related delivery integrations.' },
  { name: 'Content', description: 'Authenticated content processing routes.' },
  { name: 'Extensions', description: 'Extension discovery, lifecycle, and health surfaces.' },
  { name: 'Messaging', description: 'Messaging and email integration surfaces.' },
  { name: 'Operational', description: 'Operational-only maintenance and webhook surfaces.' },
] as const
