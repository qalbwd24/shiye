import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { prepareDiaryUnits, reassembleDiaryUnits } from '../public/shared/message-units.js';
import { projectDiaryParagraphMessages } from '../public/shared/diary-paragraph-messages.js';
const root = process.cwd();
const stage = path.resolve('tmp/android-backend-015/entry/assets');
const output = path.resolve('outputs/2026-10-18-android-backend-015/entry');
await fs.mkdir(output, { recursive: true });
const facade = ['entry-save-preparation.js', 'content-algorithms.js', 'desktop-entry-adapter.js'];
const shared = [
  'public/shared/rich-document.js',
  'public/shared/limits.js',
  'public/shared/rich-document-renderer.js',
  'public/shared/message-units.js',
  'public/shared/diary-paragraph-messages.js',
  'public/shared/legacy-time-segments.js',
  'public/shared/content-preparation.js',
  'public/shared/time-zone.js',
  'public/editor/rich-document-editor.js',
  'public/vendor/rich-editor.js',
];
const hashes = {};
for (const name of [...facade, ...shared]) {
  const src = facade.includes(name)
    ? path.join(root, 'android/app/src/main/assets', name)
    : path.join(root, name);
  const destination = path.join(stage, name);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const bytes = await fs.readFile(src);
  await fs.writeFile(destination, bytes);
  hashes[name] = createHash('sha256').update(bytes).digest('hex');
}
const { prepareEntrySave } = await import(
  pathToFileURL(path.join(stage, 'entry-save-preparation.js'))
);
const fixture = JSON.parse(
  await fs.readFile(new URL('./fixtures/cross-device-content-v1.json', import.meta.url), 'utf8'),
);
const clone = (value) => structuredClone(value);
const options = (prefix = 'fixture-unit-') => {
  let id = 0;
  return { media: clone(fixture.media), timeZone: fixture.timeZone, createId: () => prefix + ++id };
};
const reference = prepareDiaryUnits(fixture.entry, options());

test('015-C candidate uses desktop algorithms object-for-object; complete envelope fields and revision survive', () => {
  const raw = {
    entry: {
      ...clone(fixture.entry),
      attachments: ['fixture-image', 'independent-file'],
      unknown: { nested: [null, 'keep'] },
    },
    envelopeFuture: { sourceId: fixture.chat.messageId },
  };
  const before = clone(raw);
  const result = prepareEntrySave(raw, { title: 'new title' }, options());
  assert.equal(result.prepared, true, result.capability.reason);
  assert.deepEqual(
    result.derivedPlan.prepared,
    prepareDiaryUnits({ ...raw.entry, title: 'new title' }, options()),
  );
  assert.deepEqual(result.derivedPlan.reassembled, raw.entry.body);
  assert.deepEqual(
    result.derivedPlan.paragraphProjection,
    projectDiaryParagraphMessages(reference.units),
  );
  assert.equal(result.envelope.entry.date, raw.entry.date);
  assert.equal(result.envelope.entry.contentEditedAt, raw.entry.contentEditedAt);
  assert.deepEqual(result.envelope.entry.attachments, raw.entry.attachments);
  assert.deepEqual(result.envelope.entry.unknown, raw.entry.unknown);
  assert.equal(result.envelope.envelopeFuture.sourceId, fixture.chat.messageId);
  assert.equal(result.envelope.entry.revision, 7);
  assert.equal(result.baseRevision, 7);
  assert.equal(result.canCommit, false);
  assert.equal(result.currentCanonicalEnabled, false);
  assert.equal(result.derivedPlan.authoritative, false);
  assert.equal(result.derivedPlan.persist, false);
  assert.equal(result.authority, 'entry-body');
  assert.equal(result.envelope.entry.messageUnits, undefined);
  assert.deepEqual(raw, before);
});

test('015-C previous identities and unknown unit metadata survive real body edits; stale layouts are blocked', () => {
  const previous = clone(reference);
  previous.units[0].unknownUnitField = { preserve: true };
  const beforePrevious = clone(previous);
  const body = clone(fixture.entry.body);
  body.content[1].content[0].text += ' 新文字';
  const context = {
    ...options('edited-unit-'),
    previousUnits: previous.units,
    previousLayout: previous.layout,
  };
  const result = prepareEntrySave(fixture.entry, { body }, context);
  assert.equal(result.prepared, true, result.capability.reason);
  const desktop = prepareDiaryUnits(
    { ...fixture.entry, body },
    { ...options('edited-unit-'), previousUnits: previous.units },
  );
  assert.deepEqual(result.derivedPlan.prepared, desktop);
  assert.deepEqual(result.derivedPlan.reassembled, body);
  assert.equal(result.derivedPlan.prepared.units[0].id, previous.units[0].id);
  assert.deepEqual(result.derivedPlan.prepared.units[0].unknownUnitField, { preserve: true });
  assert.deepEqual(previous, beforePrevious);
  const blocked = prepareEntrySave(
    fixture.entry,
    { body },
    { ...context, previousLayout: { ...previous.layout, sourceRevision: 6 } },
  );
  assert.equal(blocked.prepared, false);
  assert.equal(blocked.derivedPlan, null);
  assert.deepEqual(blocked.envelope, fixture.entry);
  assert.equal(
    prepareEntrySave(fixture.entry, {}, { previousUnits: previous.units }).prepared,
    false,
  );
});

test('015-C unknown formats/schema and canonical/partial projections remain complete and read-only', () => {
  const variants = [
    { ...clone(fixture.entry), contentFormat: 'html', content: '<p>source</p>' },
    { ...clone(fixture.entry), contentFormat: 'markdown', content: '**source**' },
    {
      ...clone(fixture.entry),
      messageUnits: { version: 1, authority: 'messageStore', layout: { unknown: true } },
    },
    { ...clone(fixture.entry), messageUnits: { version: 2, authority: 'future-owner' } },
    { ...clone(fixture.entry), bodyComplete: false },
    { ...clone(fixture.entry), format: 'shiye-entry-reading-document', version: 1, readOnly: true },
    { ...clone(fixture.entry), body: { ...clone(fixture.entry.body), version: 99 } },
    {
      ...clone(fixture.entry),
      body: {
        ...clone(fixture.entry.body),
        content: [{ type: 'future-widget', attrs: { unknown: 1 } }],
      },
    },
    {
      ...clone(fixture.entry),
      body: {
        ...clone(fixture.entry.body),
        content: [
          {
            type: 'paragraph',
            attrs: { blockId: 'p', futureAttr: 'keep' },
            content: [{ type: 'text', text: 'source' }],
          },
        ],
      },
    },
    { version: 99, entry: clone(fixture.entry), futureEnvelope: { keep: 1 } },
  ];
  for (const original of variants) {
    const before = clone(original);
    const result = prepareEntrySave(original, { title: 'must not commit' }, options());
    assert.equal(result.prepared, false);
    assert.equal(result.capability.readOnly, true);
    assert.equal(result.derivedPlan, null);
    assert.equal(result.canCommit, false);
    assert.deepEqual(result.rawOriginal, before);
    assert.deepEqual(result.envelope, before);
    assert.deepEqual(original, before);
  }
  assert.equal(prepareEntrySave(variants[2]).authority, 'messageStore');
  assert.equal(prepareEntrySave(fixture.entry, { revision: 8 }).prepared, false);
  // Explicit null and absent clock retain different shared fallback behavior.
  for (const value of ['null', 'absent']) {
    const entry = clone(fixture.entry);
    if (value === 'null') entry.contentEditedAt = null;
    else delete entry.contentEditedAt;
    const result = prepareEntrySave(entry, {}, options());
    assert.equal(result.prepared, true, result.capability.reason);
    assert.deepEqual(result.derivedPlan.prepared, prepareDiaryUnits(entry, options()));
    assert.equal(Object.hasOwn(result.entry, 'contentEditedAt'), value === 'null');
  }
});

test('015-C actual browser imports the identical shared closure and matches full desktop fixture output', async () => {
  const require = createRequire(import.meta.url);
  const { chromium } = require('../previews/telegram-chat/vendor/web-a/node_modules/playwright');
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 320, height: 760 } });
  try {
    await page.route('https://entry-preparation.test/**', async (route) => {
      const rel = new URL(route.request().url()).pathname.slice(1);
      if (!rel)
        return route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><title>synthetic 015-C</title>',
        });
      if (![...facade, ...shared].includes(rel)) return route.abort();
      return route.fulfill({
        contentType: 'application/javascript',
        body: await fs.readFile(path.join(stage, rel)),
      });
    });
    await page.goto('https://entry-preparation.test/');
    const actual = await page.evaluate(async (fixture) => {
      const { prepareEntrySave } = await import('/entry-save-preparation.js');
      let id = 0;
      const original = JSON.stringify(fixture);
      const result = prepareEntrySave(
        fixture.entry,
        {},
        {
          media: fixture.media,
          timeZone: fixture.timeZone,
          createId: () => 'fixture-unit-' + ++id,
        },
      );
      if (JSON.stringify(fixture) !== original) throw Error('fixture mutated');
      return result;
    }, fixture);
    assert.equal(actual.prepared, true, actual.capability.reason);
    assert.deepEqual(actual.derivedPlan.prepared, reference);
    assert.deepEqual(
      actual.derivedPlan.reassembled,
      reassembleDiaryUnits(reference.units, reference.layout),
    );
    assert.deepEqual(
      actual.derivedPlan.paragraphProjection,
      projectDiaryParagraphMessages(reference.units),
    );
    assert.deepEqual(actual.entry, fixture.entry);
    await fs.writeFile(
      path.join(output, 'browser-fixture.json'),
      JSON.stringify(
        { sourceHashes: hashes, result: actual, deviceVerified: false, storageWritten: false },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
});
