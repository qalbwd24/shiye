const STORAGE_KEY = 'shiye-qq-reading-position-v1';
const MAX_ROOMS = 50;
const MAX_PART = 200;

export function readingScope(snapshot) {
  const room = String(snapshot?.roomId ?? '');
  const owner = snapshot?.storage;
  const source = owner === 'legacy-idb' ? 'legacy' : snapshot?.sourceId;
  if (
    !room ||
    room.length > MAX_PART ||
    !['legacy-idb', 'product-sqlite'].includes(owner) ||
    typeof source !== 'string' ||
    !source ||
    source.length > MAX_PART
  )
    return null;
  return JSON.stringify([owner, source, room]);
}

export function createReadingPositions(storage) {
  const readAll = () => {
    try {
      const value = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(value) ? value.slice(-MAX_ROOMS) : [];
    } catch {
      return [];
    }
  };
  const valid = (value) =>
    value &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.id.length <= MAX_PART &&
    Number.isFinite(value.offset) &&
    Math.abs(value.offset) <= 10000;
  return {
    get(scope) {
      if (!scope) return null;
      const value = readAll().findLast((item) => item?.scope === scope)?.position;
      return valid(value) ? { id: value.id, offset: value.offset } : null;
    },
    put(scope, position) {
      if (!scope || !valid(position)) return;
      try {
        const items = readAll().filter((item) => item?.scope !== scope);
        items.push({ scope, position: { id: position.id, offset: position.offset } });
        storage?.setItem(STORAGE_KEY, JSON.stringify(items.slice(-MAX_ROOMS)));
      } catch {
        /* Private/disabled storage leaves this session usable. */
      }
    },
    remove(scope) {
      if (!scope) return;
      try {
        storage?.setItem(
          STORAGE_KEY,
          JSON.stringify(readAll().filter((item) => item?.scope !== scope)),
        );
      } catch {
        /* Storage failure cannot affect reading. */
      }
    },
  };
}
