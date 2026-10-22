import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedBusinessConfig } from '../src/server/shared-sync/config.mjs';
test('shared deployment defaults to local legacy and requires explicit paired access for a wide listener', () => {
  assert.deepEqual(sharedBusinessConfig(), { sharedSync: false, sharedRemote: false });
  assert.throws(() => sharedBusinessConfig({ enabled: true, listenHost: '0.0.0.0' }));
  assert.throws(() => sharedBusinessConfig({ enabled: false, remote: { enabled: true } }));
  assert.throws(() =>
    sharedBusinessConfig({ enabled: true, listenHost: 'example.test', remote: { enabled: true } }),
  );
  assert.throws(() =>
    sharedBusinessConfig({ enabled: true, listenHost: '192.168.1.2', remote: { enabled: true } }),
  );
  assert.equal(sharedBusinessConfig({ enabled: true, listenHost: 'localhost' }).host, '127.0.0.1');
  assert.deepEqual(
    sharedBusinessConfig({
      enabled: true,
      listenHost: '0.0.0.0',
      remote: { enabled: true, allowedHosts: ['phone.test'] },
    }),
    {
      host: '0.0.0.0',
      sharedSync: true,
      sharedRemote: { enabled: true, allowedHosts: ['phone.test'] },
    },
  );
});
