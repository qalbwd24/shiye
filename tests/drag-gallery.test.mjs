import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveItem, isExternalFileDrag, SORT_MIME } from '../public/core/drag-sort.js';
import { fixture, sample } from './helpers.mjs';

test('sorting moves existing stable IDs, does not mutate source, and ignores invalid destinations', () => {
  const order = ['图一', '图二', '图三', '图四'];
  assert.deepEqual(moveItem(order, '图一', 2), ['图二', '图三', '图一', '图四']);
  assert.deepEqual(moveItem(order, '图四', 0), ['图四', '图一', '图二', '图三']);
  for (const destination of [-1, 4, NaN, 1.5])
    assert.deepEqual(moveItem(order, '图一', destination), order);
  assert.deepEqual(moveItem(order, 'missing', 1), order);
  assert.deepEqual(order, ['图一', '图二', '图三', '图四']);
});

test('external-file detection rejects internal image, text, link and sort drags even with Files', () => {
  assert.equal(isExternalFileDrag({ types: ['Files'] }), true);
  assert.equal(isExternalFileDrag({ types: ['Files'] }, true), false);
  for (const type of [SORT_MIME, 'text/html', 'text/uri-list', 'text/plain']) {
    assert.equal(isExternalFileDrag({ types: [type, 'Files'] }), false);
    assert.equal(isExternalFileDrag({ types: [type] }), false);
  }
  assert.equal(isExternalFileDrag(null), false);
});

test('reordering attachment references preserves media IDs, stored metadata and original bytes', async (t) => {
  const { request, base } = await fixture(t);
  const ids = [];
  for (const name of ['first.png', 'second.png']) {
    const media = await (
      await fetch(base + '/api/media', {
        method: 'POST',
        headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'image/png', 'X-File-Name': name },
        body: name,
      })
    ).json();
    ids.push(media.id);
  }
  const entry = await (
    await request('/api/entries', 'POST', { ...sample, attachments: ids })
  ).json();
  const before = await (await request('/api/library')).json();
  const response = await request('/api/entries/' + entry.id, 'PUT', {
    ...entry,
    attachments: moveItem(entry.attachments, ids[1], 0),
  });
  assert.equal(response.status, 200);
  const after = await (await request('/api/library')).json();
  assert.deepEqual(after.entries.find((e) => e.id === entry.id).attachments, [...ids].reverse());
  assert.deepEqual(after.media, before.media);
  assert.equal(await (await fetch(base + '/media/' + ids[0])).text(), 'first.png');
  assert.equal(await (await fetch(base + '/media/' + ids[1])).text(), 'second.png');
});

test('file-drop guard survives native listener microtask checkpoints and resets canceled drags', async () => {
  const { createMediaImport } = await import('../public/features/media-import.js');
  const savedDocument = globalThis.document,
    savedWindow = globalThis.window;
  const handlers = new Map(),
    elements = [];
  const add = (type, handler, capture = false) => {
    const list = handlers.get(type) || [];
    list.push({ handler, capture });
    handlers.set(type, list);
  };
  // Simulate the microtask checkpoint possible between native capture and
  // bubble callbacks. A synchronous dispatchEvent-only test misses this race.
  const phase = async (type, event, capture) => {
    for (const listener of handlers.get(type) || []) {
      if (listener.capture === capture) {
        listener.handler(event);
        await Promise.resolve();
      }
    }
  };
  const event = () => ({
    defaultPrevented: false,
    dataTransfer: { types: ['Files'], files: [] },
    preventDefault() {
      this.defaultPrevented = true;
    },
  });
  const nextTask = () => new Promise((resolve) => setTimeout(resolve, 5));
  try {
    globalThis.document = {
      addEventListener: add,
      createElement: () => {
        const node = { setAttribute() {}, hidden: false };
        elements.push(node);
        return node;
      },
      body: { append() {} },
      querySelector: () => null,
    };
    globalThis.window = { addEventListener() {} };
    createMediaImport({
      $: () => ({ classList: { contains: () => false } }),
      current: () => ({ id: 'entry' }),
      escape: (text) => text,
      toast() {},
    });
    const start = event();
    await phase('dragstart', start, true);
    // A gallery control cancels the drag in a later listener.
    start.preventDefault();
    await nextTask();
    await phase('dragenter', event(), false);
    assert.equal(elements[0].hidden, false, 'next external Files drag must remain accepted');
    await phase('dragstart', event(), true);
    const internalDrop = event();
    await phase('drop', internalDrop, true);
    await phase('dragenter', event(), false);
    assert.equal(elements[0].hidden, true, 'internal state must remain set through drop bubbling');
    await nextTask();
    await phase('dragenter', event(), false);
    assert.equal(elements[0].hidden, false, 'state resets after the whole drop event');
  } finally {
    globalThis.document = savedDocument;
    globalThis.window = savedWindow;
  }
});

test('gallery reorder and an upload during saving stay on the captured entry after selection changes', async () => {
  const { createGallery } = await import('../public/features/gallery.js');
  const { createPersistence } = await import('../public/editor/persistence.js');
  const listeners = new Map();
  const host = {
    ownerDocument: { body: { classList: { contains: () => true } } },
    classList: { add() {}, toggle() {} },
    setAttribute() {},
    insertAdjacentHTML() {},
    addEventListener(type, fn) {
      const callbacks = listeners.get(type) || new Set();
      callbacks.add(fn);
      listeners.set(type, callbacks);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    querySelectorAll: () => [],
    contains: () => true,
  };
  const a = { ...sample, id: 'a', revision: 1, history: [], attachments: ['one', 'two'] };
  const b = { ...sample, id: 'b', revision: 1, history: [], attachments: ['other'] };
  const library = { entries: [a, b], media: [] },
    writes = [];
  let current = a,
    release;
  const persistence = createPersistence({
    current: () => current,
    sanitize: (text) => text,
    status() {},
    toast() {},
    onDirty() {},
    onSaved() {},
    api: async (url, { data }) => {
      writes.push({ url, data: structuredClone(data) });
      if (writes.length === 1)
        await new Promise((resolve) => {
          release = resolve;
        });
      return { ...data, revision: data.revision + 1, history: [], updatedAt: '2026-09-14' };
    },
  });
  const gallery = createGallery({
    $: () => host,
    escape: (text) => text,
    toast() {},
    get library() {
      return library;
    },
    markDirty: persistence.markDirty,
    flush: persistence.flush,
  });
  gallery.render(a);
  const item = { dataset: { mediaId: 'one' }, draggable: true };
  const control = {
    dataset: { sortStep: '1' },
    closest(selector) {
      if (selector === '[data-sort-step]') return control;
      if (selector === '[data-media-id]') return item;
      return null;
    },
  };
  for (const fn of [...listeners.get('click')]) fn({ target: control, preventDefault() {} });
  await Promise.resolve();
  assert.equal(writes.length, 1);
  current = b;
  gallery.render(b);
  // Upload completion resolves its captured target against the live library.
  library.entries.find((entry) => entry.id === 'a').attachments.push('uploaded');
  persistence.markDirty(a);
  const completed = persistence.flush();
  release();
  await completed;
  assert.deepEqual(a.attachments, ['two', 'one', 'uploaded']);
  assert.deepEqual(b.attachments, ['other']);
  assert.equal(writes.length, 2);
  assert.ok(writes.every((write) => write.url.endsWith('/a')));
  assert.deepEqual(writes[1].data.attachments, ['two', 'one', 'uploaded']);
  assert.equal(persistence.pending, false);
});
