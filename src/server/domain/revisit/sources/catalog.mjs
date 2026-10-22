import { isHidden } from '../../../../../public/shared/entry-state.js';
import { isUTCInstant } from '../engine/contracts.mjs';
import { adaptChatSources } from './chat-adapter.mjs';
import { createDiarySourceAdapter } from './diary-adapter.mjs';
import { digest, entryFingerprint, freezeTree, convertedSourceBinding } from './identity.mjs';
import { projectDiaryParagraphMessages } from '../../../../../public/shared/diary-paragraph-messages.js';

/** Sessions represent one read snapshot, not a long-lived visibility authorization. */
export function createSourceReader(port, { diaryAdapter = createDiarySourceAdapter() } = {}) {
  return {
    capture() {
      const snapshot = port.capture();
      const sources = [],
        issues = [],
        index = new Map();
      const readDiary = (id) => {
        const entry = snapshot.entry(id);
        return entry && !entry.chatJournal ? diaryAdapter.read(snapshot, entry) : null;
      };
      for (const entry of snapshot.entries) {
        if (entry.deleted || isHidden(entry) || entry.draft) continue;
        let units = snapshot.units(entry.id).filter((unit) => unit.origin?.kind !== 'comment');
        let legacyIdentity =
          entry.revisitSourceIdentity?.version === 1 &&
          entry.revisitSourceIdentity.binding === convertedSourceBinding(entry)
            ? entry.revisitSourceIdentity.snapshot
            : null;
        let paragraphUnits = null;
        try {
          if (entry.chatJournal) units = adaptChatSources(snapshot, entry, units);
          else if (!entry.messageUnits && !units.length) {
            const candidate = readDiary(entry.id);
            units = candidate?.units || [];
            paragraphUnits = candidate?.paragraphMessages;
            if (candidate?.issues?.length)
              issues.push({ entryId: entry.id, codes: candidate.issues.map((item) => item.code) });
            legacyIdentity = entryFingerprint(entry);
          } else if (
            entry.messageUnits &&
            (!units.length ||
              (entry.messageUnits.ids || []).some((id) => !units.some((unit) => unit.id === id)))
          )
            issues.push({ entryId: entry.id, codes: ['source-canonical-units-missing'] });
        } catch {
          issues.push({ entryId: entry.id, codes: ['source-adaptation-failed'] });
        }
        const withdrawn = new Set(
          (entry.chatJournal?.messages || [])
            .filter((message) => message.withdrawn)
            .map((message) => String(message.id)),
        );
        const projected = entry.chatJournal
          ? units
          : paragraphUnits || projectDiaryParagraphMessages(units);
        const visibleIds = new Set(projected.map((unit) => unit.id));
        for (const unit of [...units.filter((unit) => !visibleIds.has(unit.id)), ...projected]) {
          if (
            unit.state !== 'active' ||
            !unit.body ||
            !['diary', 'chat'].includes(unit.origin?.kind)
          )
            continue;
          if (
            unit.origin.kind === 'chat' &&
            (snapshot.withdrawn(unit.origin) || withdrawn.has(String(unit.origin.messageId)))
          )
            continue;
          if (!isUTCInstant(unit.eventTime?.instant)) {
            issues.push({ entryId: entry.id, unitId: unit.id, codes: ['source-time-unavailable'] });
            continue;
          }
          const ref = {
            entryId: entry.id,
            unitId: unit.id,
            ...(legacyIdentity ? { snapshot: legacyIdentity } : {}),
          };
          const source = freezeTree({ ref, unit, entry });
          if (visibleIds.has(unit.id)) sources.push(source);
          index.set(digest(ref), source);
        }
      }
      return Object.freeze({
        version: 1,
        catalog: freezeTree({ sources, issues }),
        resolve: (ref) => index.get(digest(ref)) || null,
        readDiary,
        asset: snapshot.asset,
      });
    },
  };
}
