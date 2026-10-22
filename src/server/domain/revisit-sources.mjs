/** Compatibility facade. Source sessions are request-scoped and never persist a migration. */
import { createLibrarySourcePort } from './revisit/sources/library-port.mjs';
import { createDiarySourceAdapter } from './revisit/sources/diary-adapter.mjs';
import { createSourceReader } from './revisit/sources/catalog.mjs';
import { createSourceSessionCache } from './revisit/sources/session-cache.mjs';
import { digest } from './revisit/sources/identity.mjs';

export { digest } from './revisit/sources/identity.mjs';
export {
  presentRevisitSource,
  readSourceEntryHtml,
  sourceMediaIds,
} from './revisit/sources/presentation.mjs';

const diaryAdapter = createDiarySourceAdapter();
const sessions = new WeakMap();
const sourceCache = createSourceSessionCache({
  read: (db) =>
    createSourceReader(
      createLibrarySourcePort(() => db),
      { diaryAdapter },
    ).capture(),
});

export function openRevisitSources(db) {
  const session = sourceCache.capture(db);
  sessions.set(session.catalog, session);
  return session;
}

export function readRevisitDiary(db, entry) {
  const snapshot = createLibrarySourcePort(() => db).capture();
  return diaryAdapter.read(snapshot, structuredClone(entry));
}

export function revisitSources(db) {
  return openRevisitSources(db).catalog;
}

export function resolveRevisitSource(db, ref, catalog) {
  if (!catalog) return openRevisitSources(db).resolve(ref);
  const session = sessions.get(catalog);
  if (session) return session.resolve(ref);
  return catalog.sources.find((source) => digest(source.ref) === digest(ref)) || null;
}
