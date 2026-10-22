import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  validateRichDocument,
  richMediaReferences,
  toEditorJSON,
  fromEditorJSON,
} from '../public/shared/rich-document.js';
import { validateRenderableRichDocument } from '../public/shared/rich-document-renderer.js';
import {
  prepareDiaryUnits,
  reassembleDiaryUnits,
  validateMessageUnit,
} from '../public/shared/message-units.js';
import { projectDiaryParagraphMessages } from '../public/shared/diary-paragraph-messages.js';
import { revisitMarkdown } from '../src/server/domain/revisit-markdown.mjs';
import { chatUnitId } from '../src/server/domain/message-store.mjs';
const fixture = JSON.parse(
  await fs.readFile(new URL('./fixtures/cross-device-content-v1.json', import.meta.url), 'utf8'),
);
test('portable richdoc fixture roundtrips editor and canonical layout without changing clocks, media appearances or whitespace', () => {
  const { entry, media, expected } = fixture;
  const original = JSON.stringify(entry);
  validateRichDocument(entry.body);
  validateRenderableRichDocument(entry.body);
  assert.deepEqual(fromEditorJSON(toEditorJSON(entry.body)), entry.body);
  let id = 0;
  const prepared = prepareDiaryUnits(entry, {
    media,
    timeZone: fixture.timeZone,
    createId: () => 'fixture-unit-' + ++id,
  });
  prepared.units.forEach(validateMessageUnit);
  assert.deepEqual(reassembleDiaryUnits(prepared.units, prepared.layout), entry.body);
  assert.equal(prepared.units[0].eventTime.instant, expected.firstManualInstant);
  const projected = projectDiaryParagraphMessages(prepared.units);
  const firstGroup = projected.filter(
    (u) => u.paragraphProjection?.parentUnitId === prepared.units[0].id,
  );
  assert.equal(firstGroup.length, 2);
  assert.equal(firstGroup[1].eventTime.instant, expected.secondParagraphInstant);
  assert.deepEqual(
    firstGroup.map((u) => revisitMarkdown(u.body, { normalizeDiaryParagraphIndent: true })),
    expected.paragraphMarkdown,
  );
  const images = projected.filter((u) => richMediaReferences(u.body).length);
  assert.equal(images.length, 2);
  assert.deepEqual(
    images.map((u) => richMediaReferences(u.body)[0].occurrenceId),
    expected.occurrenceIds,
  );
  assert.equal(images[0].eventTime.instant, expected.knownMediaInstant);
  assert.equal(images[1].eventTime.instant, expected.unknownMediaFallbackInstant);
  assert.equal(richMediaReferences(images[1].body)[0].insertedAt, null);
  assert.equal(JSON.stringify(entry), original);
});
test('chat wire IDs remain decimal strings beyond Number precision; composite identity is identical on every client', () => {
  const { sourceId, roomId, messageId } = fixture.chat;
  assert.notEqual(String(Number(messageId)), messageId);
  const expected =
    'chat:' +
    createHash('sha256')
      .update(JSON.stringify([sourceId, roomId, messageId]))
      .digest('hex');
  assert.equal(chatUnitId(sourceId, roomId, messageId), expected);
  assert.notEqual(chatUnitId(sourceId, roomId, messageId), chatUnitId(sourceId, '-21', messageId));
});
