import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

test('readonly comparison frontend mounts both bodies and preserves ordered attachment prefix', async () => {
  const html = await readFile(
    new URL('../public/legacy-conversion-lab.html', import.meta.url),
    'utf8',
  );
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:18767/#synthetic-session',
    pretendToBeVisual: true,
  });
  const names = [
    'window',
    'document',
    'navigator',
    'location',
    'DOMParser',
    'HTMLElement',
    'Element',
    'Node',
    'MutationObserver',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ];
  const saved = new Map(names.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const oldFetch = globalThis.fetch;
  for (const k of names)
    Object.defineProperty(globalThis, k, {
      configurable: true,
      value: ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(k)
        ? dom.window[k].bind(dom.window)
        : dom.window[k],
    });
  const image = {
    type: 'image',
    attrs: {
      blockId: 'prefix-image',
      assetId: 'photo',
      occurrenceId: 'occ-photo',
      insertedAt: null,
      widthRatio: 0.75,
      align: 'center',
      caption: '',
      alt: '虚构图',
    },
  };
  const body = {
    format: 'shiye-richdoc',
    version: 1,
    content: [
      image,
      {
        type: 'paragraph',
        attrs: { blockId: 'p' },
        content: [
          { type: 'text', text: '第一行' },
          { type: 'hardBreak', attrs: { blockId: 'br' } },
          { type: 'text', text: '第二行' },
        ],
      },
    ],
  };
  const samples = [
    {
      key: 'a'.repeat(64),
      title: '虚构样本',
      cohort: 'holdout',
      format: 'html',
      sourceYear: '2025',
      safeForPreview: true,
      requiresReview: false,
    },
  ];
  const payload = {
    original: {
      title: '虚构样本',
      content: '<p>第一行<br>第二行</p>',
      category: '日常',
      tags: ['标签'],
    },
    candidate: { body, attachmentPlacements: [{ assetId: 'photo', blockId: 'prefix-image' }] },
    temporal: { anchors: [], issues: [] },
    validation: { safeForPreview: true },
    media: [{ id: 'photo', name: '虚构图.png', type: 'image/png' }],
  };
  const routes = [];
  globalThis.fetch = async (route, options) => {
    assert.equal(options.headers['X-Lab-Session'], 'synthetic-session');
    routes.push(route);
    if (route === '/api/samples') return { ok: true, json: async () => ({ samples }) };
    if (route.startsWith('/api/entry/'))
      return { ok: true, json: async () => structuredClone(payload) };
    if (route === '/api/media/photo')
      return { ok: true, blob: async () => new Blob(['synthetic'], { type: 'image/png' }) };
    throw Error('Unexpected request');
  };
  try {
    await import('../public/features/legacy-conversion-lab.js');
    assert.equal(
      document.querySelector('#candidate .tiptap').getAttribute('contenteditable'),
      'false',
    );
    assert.equal(document.querySelectorAll('#candidate-attachments img').length, 1);
    assert.equal(document.querySelectorAll('#original-attachments img').length, 1);
    assert.equal(document.querySelectorAll('#candidate figure').length, 0);
    assert.equal(document.querySelectorAll('#candidate br').length, 1);
    assert.ok(document.querySelector('#candidate').textContent.includes('第一行'));
    assert.equal(document.querySelector('#title').textContent, '虚构样本');
    assert.ok(routes.every((route) => route.startsWith('/api/')));
    document.querySelector('#result').value = 'review';
    document.querySelector('#result').dispatchEvent(new dom.window.Event('input'));
    assert.equal(document.querySelectorAll('#samples button').length, 0);
  } finally {
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    dom.window.close();
    globalThis.fetch = oldFetch;
    for (const [k, descriptor] of saved)
      if (descriptor) Object.defineProperty(globalThis, k, descriptor);
      else delete globalThis[k];
  }
});
