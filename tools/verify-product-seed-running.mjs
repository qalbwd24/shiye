import { promises as fs } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { createProductSeedClient } from '../public/shared/product-seed-client.js';
import { readSeedPackage } from '../src/server/sync-product/seed-package.mjs';
const base = 'http://127.0.0.1:18789/';
const call = async (route, data, token) => {
  const response = await fetch(base + route, {
    method: data === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : { 'X-Sync-Client': 'local-admin' }),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  assert(response.ok, 'Runtime API failed');
  return response.json();
};
const outputs = path.resolve('outputs/product-seed');
await fs.mkdir(outputs, { recursive: true });
const area = path.resolve('var/product-seed-running', Date.now().toString());
await fs.mkdir(area, { recursive: true });
let health;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    health = await call('api/sync/v1/health');
    break;
  } catch (error) {
    if (attempt === 29) throw error;
    await delay(200);
  }
}
assert.equal(health.product.seed, 1);
const tailnet = await (await fetch('http://100.77.215.104:18789/api/sync/v1/health')).json();
assert.equal(tailnet.product.seed, 1);
const code = await call('api/sync/v1/local-pairing', {});
const device = await call('api/sync/v1/pair', { code: code.code, deviceName: '初始包隔离验收' });
try {
  const info = await call('api/sync/v1/info', undefined, device.token);
  const backup = 'var/product-seed-backups/20261018-095741/sync.sqlite';
  const old = new DatabaseSync(path.resolve(backup), { readOnly: true });
  try {
    assert.equal(
      old.prepare("SELECT value FROM metadata WHERE key='libraryId'").get().value,
      info.libraryId,
    );
    assert.equal(
      old.prepare("SELECT value FROM metadata WHERE key='epoch'").get().value,
      info.epoch,
    );
  } finally {
    old.close();
  }
  const catalog = await call('api/product/v1/catalog', undefined, device.token);
  assert.equal(catalog.seed.clientWallpaper, 'device-local');
  assert.equal(catalog.seed.stickerTags, true);
  const api = createProductSeedClient({ baseUrl: base, token: device.token });
  let job = await api.createExport('runtime-seed-v1-' + Date.now());
  for (let i = 0; i < 300; i++) {
    job = await api.exportStatus(job.id);
    if (job.status === 'ready') break;
    if (job.status === 'failed') throw Error(job.error);
    await delay(30);
  }
  assert.equal(job.status, 'ready');
  const file = path.join(area, 'initial.syseed');
  await fs.writeFile(file, Buffer.from(await (await api.download(job.id)).arrayBuffer()));
  const parsed = await readSeedPackage({
    file,
    directory: path.join(area, 'verified'),
    expectedSha256: job.sha256,
  });
  const proof = await api.resolve({
    packageId: job.id,
    sha256: job.sha256,
    libraryId: info.libraryId,
    epoch: info.epoch,
    checkpoint: parsed.manifest.checkpoint,
  });
  assert.equal(proof.verified, true);
  const report = {
    ok: true,
    endpoint: base,
    loopback: true,
    pcTailnetAddress: true,
    sameLibraryIdentity: true,
    sameEpoch: true,
    seed: 1,
    stickerTags: 1,
    exportAndVerify: true,
    entities: parsed.manifest.entityCount,
    assets: parsed.manifest.assetCount,
    packageSha256: job.sha256,
    packageId: job.id,
    privatePackage: file,
    androidNotOperated: true,
    noFormalWrites: true,
  };
  await fs.writeFile(
    path.join(outputs, 'running-verification.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  const response = await fetch(base + 'api/sync/v1/devices/' + device.deviceId, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + device.token },
  });
  assert(response.ok, 'Revoke QA device failed');
}
