import { sourceLibrary, richBody, paragraph } from './revisit-source-fixtures.mjs';

/** Invented two messages per minute/day; useful for catchup and complete-minute boundaries. */
export function deliveryLibrary(days = 75) {
  const db = sourceLibrary();
  const entry = {
    ...db.entries[3],
    id: 'synthetic-series',
    attachments: [],
    content: '<p>合成连续记录</p>',
    messageUnits: { version: 1, authority: 'messageStore', ids: [] },
  };
  db.entries = [entry];
  db.media = [];
  delete db.chatJournal;
  db.messageStore = { version: 1, units: [], layouts: {} };
  const content = [];
  for (let day = 0; day < days; day++)
    for (const seconds of [5, 55]) {
      const id = `series-${day}-${seconds}`;
      const instant = new Date(
        Date.parse('2025-01-01T12:00:00Z') + day * 86400000 + seconds * 1000,
      ).toISOString();
      const body = richBody(paragraph(`合成第${day}天第${seconds}秒`));
      body.content[0].attrs.blockId = id;
      db.messageStore.units.push({
        id,
        origin: { kind: 'diary', entryId: entry.id },
        body,
        eventTime: {
          instant,
          timeZone: 'UTC',
          precision: 'millisecond',
          source: 'sent',
          sourceField: 'sentAt',
        },
        state: 'active',
        revision: 1,
        replyTo: null,
        sourceSpans: [],
        attachments: [],
      });
      entry.messageUnits.ids.push(id);
      content.push(...body.content);
    }
  entry.body = { format: 'shiye-richdoc', version: 1, content };
  return db;
}
