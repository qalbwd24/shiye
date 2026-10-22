import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureRevisit, tickRevisit } from '../src/server/domain/revisit.mjs';
import { createRevisitDeliveryService } from '../src/server/domain/revisit/delivery/service.mjs';
import { revisitSources } from '../src/server/domain/revisit-sources.mjs';

test('random to six calendar months changes active status, preserves old deliveries and resumes at new cursor without duplicate replay', () => {
  const db = {
    categories: ['日常'],
    media: [],
    entries: [
      ['half-year', '2026-04-18'],
      ['full-year', '2025-10-18'],
      ['wrong-day', '2026-04-19'],
      ['old-random', '2025-10-23'],
    ].map(([id, date]) => ({
      id,
      category: '日常',
      title: '合成',
      date: date + 'T03:10:00Z',
      updatedAt: date + 'T03:10:00Z',
      contentFormat: 'html',
      content: '<p>合成回看来信</p>',
      attachments: [],
      revision: 1,
    })),
  };
  const originals = JSON.stringify([db.entries, db.media]);
  configureRevisit(db, {
    expectedRevision: 1,
    enabled: true,
    mode: 'daily-random',
    dailyTime: '08:00',
  });
  tickRevisit(db, {}, Date.parse('2026-10-17T00:00:00Z'));
  tickRevisit(db, {}, Date.parse('2026-10-17T04:00:00Z'));
  const old = structuredClone(db.revisit);
  assert.ok(old.deliveries.length > 0);
  configureRevisit(db, {
    expectedRevision: 2,
    mode: 'interval',
    interval: { unit: 'month', count: 6 },
  });
  const status = createRevisitDeliveryService({ read: (fn) => fn(db) }).status();
  assert.equal(status.config.mode, 'interval');
  assert.equal(status.randomDay, undefined);
  for (const k of ['randomDays', 'deliveries', 'batches', 'comments'])
    assert.deepEqual(db.revisit[k], old[k]);
  assert.equal(tickRevisit(db, {}, Date.parse('2026-10-18T03:09:00Z')).created, 0);
  assert.equal(tickRevisit(db, {}, Date.parse('2026-10-18T03:11:00Z')).created, 2);
  const added = db.revisit.deliveries.slice(old.deliveries.length);
  assert.deepEqual(added.map((x) => x.ref.entryId).sort(), ['full-year', 'half-year']);
  assert.ok(added.every((x) => x.replayAt === '2026-10-18T03:10:00.000Z'));
  assert.equal(tickRevisit(db, {}, Date.parse('2026-10-18T03:11:00Z')).created, 0);
  assert.equal(JSON.stringify([db.entries, db.media]), originals);
  assert.equal(revisitSources(db).sources.length, 4);
  configureRevisit(db, { expectedRevision: 3, mode: 'daily-random' });
  assert.equal(db.revisit.cursor, null);
  assert.equal(tickRevisit(db, {}, Date.parse('2026-10-18T03:12:00Z')).created, 0);
  assert.equal(db.revisit.randomDays.length, old.randomDays.length + 1);
  assert.deepEqual(db.revisit.deliveries.slice(0, old.deliveries.length), old.deliveries);
});
