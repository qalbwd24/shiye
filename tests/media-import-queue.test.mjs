import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMediaImport } from '../public/features/media-import.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
async function until(predicate) {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await new Promise(setImmediate);
  }
  assert.fail('Expected asynchronous upload state was not reached');
}

/** Minimal DOM controls; all tested state transitions use the real importer and uploader. */
function harness(t, { flush = async () => {}, choose } = {}) {
  const saved = Object.fromEntries(
    ['document', 'window', 'XMLHttpRequest'].map((key) => [key, globalThis[key]]),
  );
  const elements = [],
    requests = [],
    messages = [];
  let reviewOpen = false;
  class Element {
    controls = new Map();
    setAttribute() {}
    set innerHTML(value) {
      this.html = value;
      this.controls = new Map([['[data-dismiss]', { onclick: null }]]);
      for (const kind of ['retry', 'clear'])
        this.controls.set(
          `[data-${kind}]`,
          [...value.matchAll(new RegExp(`data-${kind}="(\\d+)"`, 'g'))].map((match) => ({
            dataset: { [kind]: match[1] },
            onclick: null,
          })),
        );
    }
    get innerHTML() {
      return this.html;
    }
    querySelector(selector) {
      return this.controls.get(selector);
    }
    querySelectorAll(selector) {
      return this.controls.get(selector) || [];
    }
  }
  globalThis.document = {
    createElement: () => new Element(),
    body: { append: (element) => elements.push(element) },
    addEventListener() {},
    querySelector: (selector) => (selector === 'dialog[open]' && reviewOpen ? {} : null),
  };
  globalThis.window = { addEventListener() {} };
  globalThis.XMLHttpRequest = class {
    upload = {};
    open() {}
    setRequestHeader() {}
    send(file) {
      this.file = file;
      requests.push(this);
    }
  };
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) globalThis[key] = value;
  });
  const entry = { id: 'synthetic-entry', title: 'Synthetic', attachments: [] };
  const library = { entries: [entry], media: [] };
  const importer = createMediaImport({
    $: () => ({ classList: { contains: () => false } }),
    escape: (text) => String(text),
    toast: (message) => messages.push(message),
    current: () => entry,
    library,
    markDirty() {},
    renderAttachments() {},
    flush,
    chooseMediaBatch:
      choose || (async (files) => files.map((file) => ({ file, quality: 'balanced' }))),
  });
  return {
    importer,
    entry,
    messages,
    requests,
    panel: elements.find((element) => element.className === 'media-upload-panel'),
    review(open) {
      reviewOpen = open;
    },
    respond(index, status = 201) {
      const xhr = requests[index];
      xhr.status = status;
      xhr.responseText = JSON.stringify(
        status >= 400
          ? { error: 'Synthetic upload failure' }
          : { id: 'media-' + index, size: xhr.file.size, type: xhr.file.type },
      );
      xhr.onload();
    },
  };
}
const file = (name) => new File(['synthetic content'], name, { type: 'text/plain' });

test('diary image upload starts directly without invoking a confirmation dialog', async (t) => {
  const h = harness(t, {
    choose: () => {
      assert.fail('Image must not open a review dialog');
    },
  });
  // SVG stays byte-exact in the compressor, avoiding a mocked image decode.
  const image = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'synthetic.svg', {
    type: 'image/svg+xml',
  });
  const pending = h.importer.upload([image]);
  await until(() => h.requests.length === 1);
  h.respond(0);
  await pending;
  assert.deepEqual(h.entry.attachments, ['media-0']);
  assert.equal(h.panel.hidden, true);
});

test('adopting a conflicting saved version never reports a dropped upload as saved', async (t) => {
  const h = harness(t, {
    flush: async () => {
      h.entry.attachments = [];
    },
  });
  const pending = h.importer.upload([file('discarded-by-conflict.txt')]);
  await until(() => h.requests.length === 1);
  h.respond(0);
  await pending;
  assert.match(h.panel.innerHTML, /当前保存版本未包含这项附件/);
  assert.equal(h.panel.hidden, false);
  assert.ok(!h.messages.includes('附件已保存'));
  await assert.rejects(h.importer.settle(), /还有媒体未保存/);
});

test('queue remains visible until attachment saving resolves, then auto-collapses and can be reopened', async (t) => {
  const saved = deferred();
  let saving = false;
  const h = harness(t, {
    flush: () => {
      saving = true;
      return saved.promise;
    },
  });
  const upload = h.importer.upload([file('single.txt')]);
  await until(() => h.requests.length === 1);
  assert.equal(h.panel.hidden, false);
  h.respond(0);
  await until(() => saving);
  assert.equal(h.panel.hidden, false);
  assert.match(h.panel.innerHTML, /正在保存附件关联/);
  assert.deepEqual(h.messages, []);
  saved.resolve();
  await upload;
  assert.deepEqual(h.entry.attachments, ['media-0']);
  assert.equal(h.panel.hidden, true);
  assert.deepEqual(h.messages, ['附件已保存']);
  h.importer.show();
  assert.equal(h.panel.hidden, false);
  assert.match(h.panel.innerHTML, /全部附件已保存/);
});

test('multiple files collapse only after every queued attachment has saved', async (t) => {
  const h = harness(t);
  const upload = h.importer.upload([file('first.txt'), file('second.txt')]);
  await until(() => h.requests.length === 1);
  h.respond(0);
  await until(() => h.requests.length === 2);
  assert.equal(h.panel.hidden, false);
  assert.deepEqual(h.messages, []);
  h.respond(1);
  await upload;
  assert.equal(h.panel.hidden, true);
  assert.equal(h.entry.attachments.length, 2);
  assert.deepEqual(h.messages, ['附件已保存']);
});

test('save failure reopens a dismissed queue; retry reuses uploaded media and closes only after save', async (t) => {
  const saved = deferred();
  let saves = 0;
  const h = harness(t, { flush: () => (++saves === 1 ? saved.promise : Promise.resolve()) });
  const upload = h.importer.upload([file('retry.txt')]);
  await until(() => h.requests.length === 1);
  h.respond(0);
  await until(() => saves === 1);
  h.panel.querySelector('[data-dismiss]').onclick();
  assert.equal(h.panel.hidden, true);
  saved.reject(Error('Synthetic save failure'));
  await upload;
  assert.equal(h.panel.hidden, false);
  assert.match(h.panel.innerHTML, /Synthetic save failure/);
  assert.deepEqual(h.messages, []);
  await assert.rejects(h.importer.settle(), /还有媒体未保存/);
  h.panel.querySelectorAll('[data-retry]')[0].onclick();
  await h.importer.settle();
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.entry.attachments, ['media-0']);
  assert.equal(h.panel.hidden, true);
});

test('partial upload failure stays visible after other files succeed until explicitly removed', async (t) => {
  const h = harness(t);
  const upload = h.importer.upload([file('failed.txt'), file('saved.txt')]);
  await until(() => h.requests.length === 1);
  h.respond(0, 500);
  await until(() => h.requests.length === 2);
  h.respond(1);
  await upload;
  assert.equal(h.panel.hidden, false);
  assert.deepEqual(h.entry.attachments, ['media-1']);
  assert.deepEqual(h.messages, []);
  h.panel.querySelectorAll('[data-clear]')[0].onclick();
  assert.equal(h.panel.hidden, true);
  assert.deepEqual(h.messages, []);
  await h.importer.settle();
});

test('pending batch review remains open and does not upload or auto-dismiss before confirmation', async (t) => {
  const review = deferred();
  const h = harness(t, { choose: () => review.promise });
  h.review(true);
  const upload = h.importer.upload([file('review.txt')]);
  await new Promise(setImmediate);
  assert.equal(h.requests.length, 0);
  assert.equal(h.panel.hidden, true);
  await assert.rejects(h.importer.settle(), /请先完成或取消当前弹窗/);
  h.review(false);
  review.resolve([]);
  await upload;
  assert.equal(h.requests.length, 0);
  assert.deepEqual(h.entry.attachments, []);
});

test('empty clipboard files never reach review or network and asynchronous reads block premature navigation', async (t) => {
  const h = harness(t);
  await assert.rejects(
    h.importer.upload([new File([], 'image.png', { type: 'image/png' })]),
    /文件内容为空/,
  );
  assert.equal(h.requests.length, 0);
  assert.deepEqual(h.entry.attachments, []);
  const reading = deferred();
  const upload = h.importer.upload(reading.promise);
  await assert.rejects(h.importer.settle(), /正在读取或添加媒体/);
  reading.reject(Error('无法读取剪贴板'));
  await assert.rejects(upload, /剪贴板/);
  await h.importer.settle();
  assert.equal(h.requests.length, 0);
});
