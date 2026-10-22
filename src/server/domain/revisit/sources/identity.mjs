import { createHash } from 'node:crypto';

export const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
export const convertedSourceBinding = (entry) =>
  digest(canonical([entry.body, entry.attachments, entry.contentEditedAt, entry.date]));

// Taxonomy is mutable metadata, not part of the legacy content identity.
export const entryFingerprint = (entry) =>
  digest([
    entry.contentFormat,
    entry.body,
    entry.content,
    entry.markdownSource,
    entry.attachments,
    entry.contentEditedAt === undefined ? entry.updatedAt : entry.contentEditedAt,
    entry.date,
  ]);

export function freezeTree(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeTree(child);
  return Object.freeze(value);
}

export const chatCoordinates = (sourceId, roomId, messageId) =>
  JSON.stringify([sourceId, String(roomId), String(messageId)]);
