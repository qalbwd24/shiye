import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const base = 'http://127.0.0.1:18789/';
const call = async (root, route, body, token, headers = {}) => {
  const response = await fetch(root + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
};
const checks = {};
checks.loopback = (await call(base, 'api/sync/v1/health')).product.schema === 1;
checks.tailnet =
  (await call('http://100.77.215.104:18789/', 'api/sync/v1/health')).product.schema === 1;
const pairing = await call(base, 'api/sync/v1/local-pairing', {}, null, {
  'X-Sync-Client': 'local-admin',
});
const device = await call(base, 'api/sync/v1/pair', {
  code: pairing.code,
  deviceName: '产品后端验收',
});
try {
  const catalog = await call(base, 'api/product/v1/catalog', undefined, device.token);
  checks.catalog = !!catalog.epoch;
  const library = await call(base, 'api/product/v1/library', undefined, device.token);
  checks.synthetic = library.entries.length === 1 && library.entries[0].id === 'demo-entry';
  checks.configuration = library.conversations[0].configuration.messageAlign === 'right';
  checks.media = library.media.length === 1 && library.stickers.length === 1;
  const revisit = await call(base, 'api/product/v1/revisit', undefined, device.token);
  checks.revisit = !!revisit.config && revisit.runner.autoTickMs === 30000;
} finally {
  const revoked = await fetch(base + 'api/sync/v1/devices/' + device.deviceId, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${device.token}` },
  });
  checks.qaCredentialRevoked = revoked.ok;
}
if (!Object.values(checks).every(Boolean)) throw new Error('PRODUCT_LIVE_CHECK_FAILED');
const files = [
  'public/shared/sync-product.js',
  'public/shared/sync-product-client.js',
  'src/server/sync-product/service.mjs',
  'src/server/sync-product/legacy-adapter.mjs',
  'src/server/sync-product/import.mjs',
  'src/server/sync-v2/server.mjs',
  'src/server/sync-v2/store.mjs',
  'src/server/domain/chat-journal.mjs',
  'src/server/routes/revisit.mjs',
  'tools/product-sync-server.mjs',
  'tools/sync-server.mjs',
];
const sourceHashes = Object.fromEntries(
  await Promise.all(
    files.map(async (file) => [
      file,
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex'),
    ]),
  ),
);
const report = {
  checkedAt: new Date().toISOString(),
  checks,
  baseUrls: [base, 'http://100.77.215.104:18789/'],
  physicalPhoneTested: false,
  synthetic: true,
  runtime: JSON.parse(await readFile('var/product-sync-lab/runtime.json', 'utf8')),
  sourceHashes,
};
await mkdir('outputs/product-sync', { recursive: true });
await writeFile('outputs/product-sync/live-server.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ checks, synthetic: true, physicalPhoneTested: false }));
