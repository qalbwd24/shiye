import { commitChatUnit, chatUnitId } from '../../message-store.mjs';
import { parseChatMarkdown } from '../../chat-journal.mjs';

/** Fill only missing legacy chat messages, using an entirely detached temporary store. */
export function adaptChatSources(snapshot, entry, canonical) {
  const units = [...canonical];
  const known = new Set(units.map((unit) => unit.id));
  const detached = { entries: [], media: snapshot.media };
  for (const message of entry.chatJournal.messages || []) {
    const origin = {
      sourceId: entry.chatJournal.sourceId,
      roomId: entry.chatJournal.roomId,
      messageId: message.id,
    };
    const id = chatUnitId(origin.sourceId, origin.roomId, message.id);
    if (known.has(id) || message.withdrawn || snapshot.withdrawn(origin)) continue;
    const unit = commitChatUnit(detached, entry, message, parseChatMarkdown(message.text || ''), {
      messageUnitsEnabled: true,
    });
    units.push(unit);
    known.add(id);
  }
  return units;
}
