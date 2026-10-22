import { readMessageUnits } from '../../message-store.mjs';
import { chatCoordinates, digest, freezeTree } from './identity.mjs';

/** A synchronous read port. Capture once per operation; no persistence or migration. */
export function createLibrarySourcePort(readLibrary) {
  return {
    capture() {
      const db = readLibrary();
      const entries = freezeTree(structuredClone(db.entries || []));
      const media = freezeTree(structuredClone(db.media || []));
      // readMessageUnits clones units and resolves current taxonomy. Comments are not sources.
      const units = freezeTree(
        readMessageUnits({
          entries,
          messageStore: db.messageStore,
          chatJournal: { rooms: structuredClone(db.chatJournal?.rooms || []) },
        }),
      );
      const byEntry = new Map();
      for (const unit of units) {
        const id = unit.origin?.entryId;
        if (!byEntry.has(id)) byEntry.set(id, []);
        byEntry.get(id).push(unit);
      }
      const withdrawals = new Set(
        (db.chatJournal?.withdrawals || []).map((item) =>
          chatCoordinates(item.sourceId, item.roomId, item.messageId),
        ),
      );
      const assets = new Map(media.map((asset) => [asset.id, asset]));
      const entryIndex = new Map(entries.map((entry) => [entry.id, entry]));
      return Object.freeze({
        entries,
        media,
        mediaFingerprint: digest(media),
        entry: (id) => entryIndex.get(id),
        asset: (id) => assets.get(id),
        units: (id) => [...(byEntry.get(id) || [])],
        withdrawn: (origin) =>
          withdrawals.has(chatCoordinates(origin.sourceId, origin.roomId, origin.messageId)),
      });
    },
  };
}
