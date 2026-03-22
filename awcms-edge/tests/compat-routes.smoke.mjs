const workerBaseUrl = process.env.AWCMS_EDGE_BASE_URL || 'http://127.0.0.1:8787';
const tenantId = process.env.AWCMS_PRIMARY_TENANT_ID || '91432330-6fec-4371-bbba-936ac7e5da76';

const routes = [
  `${workerBaseUrl}/functions/v1/extensions/public-modules?tenantId=${tenantId}`,
  `${workerBaseUrl}/functions/v1/extensions/events/public?tenantId=${tenantId}&limit=2`,
  `${workerBaseUrl}/functions/v1/serve-sitemap`,
];

const isConnectionRefused = (error) =>
  String(error?.cause?.code || error?.code || '') === 'ECONNREFUSED';

try {
  for (const route of routes) {
    const response = await fetch(route, {
      redirect: 'manual',
    });

    if (!response.ok && ![301, 302, 307, 308].includes(response.status)) {
      throw new Error(`Expected Worker compatibility route to respond successfully: ${route} -> ${response.status}`);
    }
  }

  console.log('worker compatibility routes ok');
} catch (error) {
  if (isConnectionRefused(error)) {
    console.log(`Skipping compatibility route smoke test: could not reach ${workerBaseUrl}.`);
    process.exit(0);
  }

  throw error;
}
