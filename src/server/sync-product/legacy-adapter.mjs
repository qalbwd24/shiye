import {
  PRODUCT_ENTITY_TYPES,
  productMessageId,
  productConversationId,
  legacyTaxonomyId,
  validateProductRecord,
} from '../../../public/shared/sync-product.js';
import { planMigrationMetadata, portableConfiguration } from './migration-metadata.mjs';

const copy = (v) => structuredClone(v);
const values = (v) => (Array.isArray(v) ? v : []);
const LOCAL_PREFERENCES = new Set([
  'window',
  'windowPosition',
  'windowSize',
  'displays',
  'dpi',
  'deviceId',
  'authToken',
  'password',
  'localPath',
]);

/** Read-only, repeatable seed plan. The caller persists taxonomy identity before any later rename. */
export function planLegacyProductImport(
  library,
  { sourceId, taxonomyIdentity = {}, extras = [] } = {},
) {
  if (!library || !Array.isArray(library.entries) || !Array.isArray(library.media) || !sourceId)
    throw new TypeError('Explicit legacy library and stable sourceId required');
  const records = [],
    issues = [],
    ids = copy(taxonomyIdentity);
  const names = (kind) => [
    ...new Set(
      [
        ...values(kind === 'category' ? library.categories : library.tags),
        ...library.entries.flatMap((e) => (kind === 'category' ? [e.category] : values(e.tags))),
      ].filter((v) => typeof v === 'string' && v),
    ),
  ];
  const taxonomy = (kind, name) => {
    const key = JSON.stringify([kind, name]);
    return (ids[key] ||= legacyTaxonomyId(sourceId, kind, name));
  };
  const add = (kind, id, value, refs = {}, attributes = {}) => {
    if (Object.hasOwn(value, '_product') || Object.hasOwn(value, '_canonical'))
      throw Object.assign(new Error('RESERVED_PRODUCT_ANNOTATION'), {
        code: 'RESERVED_PRODUCT_ANNOTATION',
      });
    const record = {
      entityType: PRODUCT_ENTITY_TYPES[kind],
      entityId: id,
      data: {
        ...copy(value),
        ...(attributes.canonical ? { _canonical: copy(attributes.canonical) } : {}),
        _product: {
          schema: 1,
          kind,
          refs: copy(refs),
          ...Object.fromEntries(
            Object.entries(copy(attributes)).filter(([k]) => k !== 'canonical'),
          ),
        },
      },
    };
    validateProductRecord(record.entityType, id, record.data);
    records.push(record);
    return record;
  };
  for (const kind of ['category', 'tag']) {
    const list = names(kind);
    for (const name of list) {
      const id = taxonomy(kind, name);
      add('taxonomy', id, { id, kind, name });
    }
    add('order', `order:${sourceId}:${kind}`, { kind, ids: list.map((n) => taxonomy(kind, n)) });
  }
  const refs = (value) => ({
    ...(value.category ? { category: taxonomy('category', value.category) } : {}),
    tags: values(value.tags).map((n) => taxonomy('tag', n)),
    assets: values(value.attachments).filter((id) => typeof id === 'string'),
  });
  for (const item of library.media) {
    const value = copy(item);
    for (const key of ['localPath', 'filePath', 'absolutePath', 'originalPath', 'thumbnailPath'])
      delete value[key];
    add('media', item.id, value, { asset: item.id });
  }
  for (const room of library.chatJournal?.rooms || []) {
    const id = productConversationId(room.sourceId, room.id);
    const assets = [
      room.wallpaperAssetId,
      room.avatarAssetId,
      room.configuration?.wallpaperAssetId,
      room.configuration?.avatarAssetId,
    ].filter(Boolean);
    add('conversation', id, room, {
      ...refs(room),
      assets,
      origin: { sourceId: room.sourceId, roomId: room.id },
    });
  }
  for (const entry of library.entries) {
    const checkpoint = records.length;
    try {
      const entryRefs = refs(entry);
      if (entry.chatJournal) {
        const journal = entry.chatJournal;
        entryRefs.conversation = productConversationId(journal.sourceId, journal.roomId);
        entryRefs.messages = [];
        for (const original of journal.messages || []) {
          const message = copy(original);
          const id = productMessageId(journal.sourceId, journal.roomId, message.id);
          entryRefs.messages.push(id);
          const record = add('message', id, message, {
            ...refs(entry),
            assets: values(message.attachments),
            entry: entry.id,
            conversation: entryRefs.conversation,
            origin: { sourceId: journal.sourceId, roomId: journal.roomId },
          });
          if (message.withdrawn) {
            record.data.text = '';
            record.data.attachments = [];
            record.state = 'withdrawn';
          }
        }
      }
      const value = copy(entry);
      if (value.chatJournal) {
        // Message entities own text. Never retain a second copy in projection history.
        value.content = '';
        value.markdownSource = null;
        value.markdownHtml = null;
        delete value.editorOriginalHtml;
        delete value.richDoc;
        delete value.body;
        delete value.messageUnits;
        value.history = [];
        value.chatJournal.messages = value.chatJournal.messages.map((m) => ({
          id: m.id,
          sentAt: m.sentAt,
          ...(m.replyTo ? { replyTo: m.replyTo } : {}),
        }));
      }
      const units = (library.messageStore?.units || []).filter(
        (u) => u.origin?.kind === 'diary' && u.origin.entryId === entry.id,
      );
      const layout = library.messageStore?.layouts?.[entry.id];
      add(
        'entry',
        entry.id,
        value,
        entryRefs,
        entry.chatJournal
          ? { readOnlyProjection: true }
          : layout
            ? { canonical: { units: copy(units), layout: copy(layout) } }
            : {},
      );
    } catch (error) {
      records.length = checkpoint;
      issues.push({ kind: 'entry', id: entry.id, code: error.code || 'INVALID_LEGACY_ENTRY' });
    }
  }
  for (const sticker of values(library.stickers)) {
    const mediaId = sticker.mediaId || sticker.assetId;
    add('sticker', sticker.id, sticker, { assets: mediaId ? [mediaId] : [] });
  }
  if (library.settings?.preferences) {
    const prefs = portableConfiguration(
      Object.fromEntries(
        Object.entries(library.settings.preferences).filter(([key]) => !LOCAL_PREFERENCES.has(key)),
      ),
    );
    add('appearance', `appearance:${sourceId}:preferences`, {
      scope: 'library',
      preferences: copy(prefs),
    });
  }
  for (const extra of extras) add(extra.kind, extra.id, extra.value, extra.refs);
  const metadata = planMigrationMetadata(library, sourceId);
  records.push(...metadata.records);
  return {
    schema: 1,
    sourceId,
    records,
    taxonomyIdentity: ids,
    issues,
    coverage: metadata.coverage,
    counts: Object.fromEntries(
      [...new Set(records.map((r) => r.data._product.kind))].map((k) => [
        k,
        records.filter((r) => r.data._product.kind === k).length,
      ]),
    ),
  };
}

/** A rename changes the explicit map, never a record ID or a body's event clock. */
export function renameLegacyTaxonomyIdentity(identity, kind, from, to) {
  const result = copy(identity),
    oldKey = JSON.stringify([kind, from]),
    newKey = JSON.stringify([kind, to]);
  if (!result[oldKey] || (result[newKey] && result[newKey] !== result[oldKey]))
    throw Object.assign(new Error('TAXONOMY_IDENTITY_CONFLICT'), {
      code: 'TAXONOMY_IDENTITY_CONFLICT',
    });
  result[newKey] = result[oldKey];
  delete result[oldKey];
  return result;
}
