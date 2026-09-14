import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sample, fixture } from './helpers.mjs';
test('local lock protects library/media endpoints and requires current password to change', async (t) => {
  const { request, base } = await fixture(t);
  const setup = await request('/api/access', 'PUT', { password: 'test-lock-password-123' });
  assert.equal(setup.status, 200);
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/library')).status, 401);
  assert.equal((await fetch(base + '/api/library', { headers: { Cookie: cookie } })).status, 200);
  assert.equal(
    (
      await fetch(base + '/api/access', {
        method: 'PUT',
        headers: {
          Cookie: cookie,
          'X-Diary-Client': 'desktop',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: 'new-test-password', oldPassword: 'wrong' }),
      })
    ).status,
    403,
  );
  assert.equal(
    (await request('/api/unlock', 'POST', { password: 'test-lock-password-123' })).status,
    200,
  );
});
test('local API rejects foreign origin and missing mutation header', async (t) => {
  const { base } = await fixture(t);
  for (const headers of [{}, { 'X-Diary-Client': 'desktop', Origin: 'https://untrusted.invalid' }])
    assert.equal(
      (
        await fetch(base + '/api/entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(sample),
        })
      ).status,
      403,
    );
});
