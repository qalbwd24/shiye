import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindowRefresh } from '../public/features/window-refresh.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function harness(t) {
  const requests = [],
    applied = [];
  const state = { safe: true, context: 'article-a' };
  const refresh = createWindowRefresh({
    canRefresh: () => state.safe,
    capture: () => state.context,
    isCurrent: (context) => context === state.context,
    fetch() {
      const request = deferred();
      requests.push(request);
      return request.promise;
    },
    apply: (snapshot) => applied.push(snapshot),
  });
  t.after(() => refresh.dispose());
  return { refresh, state, requests, applied };
}

test('busy notifications are retained and coalesced until editing finishes', async (t) => {
  const { refresh, state, requests, applied } = harness(t);
  state.safe = false;
  refresh.request();
  refresh.request();
  await tick();
  assert.equal(requests.length, 0);
  state.safe = true;
  refresh.resume();
  await tick();
  assert.equal(requests.length, 1);
  requests[0].resolve('latest library');
  await tick();
  assert.deepEqual(applied, ['latest library']);
});

test('input during a request discards the stale response even if saving already finished', async (t) => {
  const { refresh, state, requests, applied } = harness(t);
  refresh.request();
  await tick();
  refresh.invalidate();
  requests[0].resolve('before new typing');
  await tick();
  assert.deepEqual(applied, []);
  assert.equal(requests.length, 2);
  state.safe = false;
  requests[1].resolve('still editing');
  await tick();
  assert.deepEqual(applied, []);
  assert.equal(requests.length, 2);
  state.safe = true;
  refresh.resume();
  await tick();
  requests[2].resolve('after typing was saved');
  await tick();
  assert.deepEqual(applied, ['after typing was saved']);
});

test('navigation during fetch cannot apply an earlier context or select the old article', async (t) => {
  const { refresh, state, requests, applied } = harness(t);
  refresh.request();
  await tick();
  state.context = 'article-b';
  requests[0].resolve('article-a snapshot');
  await tick();
  assert.deepEqual(applied, []);
  requests[1].resolve('article-b snapshot');
  await tick();
  assert.deepEqual(applied, ['article-b snapshot']);
  assert.equal(state.context, 'article-b');
});

test('notifications received in flight are fetched serially and not dropped', async (t) => {
  const { refresh, requests, applied } = harness(t);
  refresh.request();
  await tick();
  refresh.request();
  refresh.request();
  await tick();
  assert.equal(requests.length, 1);
  requests[0].resolve('first');
  await tick();
  assert.equal(requests.length, 2);
  requests[1].resolve('second');
  await tick();
  assert.deepEqual(applied, ['first', 'second']);
});

test('a failed fetch waits for focus/save to retry rather than looping', async (t) => {
  const { refresh, requests, applied } = harness(t);
  refresh.request();
  await tick();
  requests[0].reject(Error('offline'));
  await tick();
  await tick();
  assert.equal(requests.length, 1);
  refresh.resume();
  await tick();
  requests[1].resolve('reconnected');
  await tick();
  assert.deepEqual(applied, ['reconnected']);
});

test('closing the window prevents an in-flight response from applying', async (t) => {
  const { refresh, requests, applied } = harness(t);
  refresh.request();
  await tick();
  refresh.dispose();
  requests[0].resolve('late response');
  refresh.request();
  await tick();
  assert.deepEqual(applied, []);
  assert.equal(requests.length, 1);
});
