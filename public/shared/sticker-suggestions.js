/** Local metadata-only inverted index. Query text never leaves this module. */
const MAX_BYTES = 64 * 1024 * 1024;
const IMAGE = /^image\/(png|jpeg|webp|gif|avif)$/u;
export function normalizeStickerText(value) {
  return typeof value === 'string'
    ? value
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
        .trim()
    : '';
}
export function hasLocalStickerOriginal(asset) {
  const blob = asset?.blob;
  return Boolean(
    typeof asset?.id === 'string' &&
    asset.id.startsWith('sticker:') &&
    !asset.removed &&
    blob &&
    Number.isSafeInteger(blob.size) &&
    blob.size > 0 &&
    blob.size <= MAX_BYTES &&
    IMAGE.test(blob.type || ''),
  );
}
function terms(value, indexing = false) {
  const result = new Set();
  for (const word of normalizeStickerText(value).match(/[\p{L}\p{N}_-]+/gu) || []) {
    result.add('word:' + word);
    const chars = [...word];
    if (/\p{Script=Han}/u.test(word)) {
      for (let i = 0; i < chars.length; i++) {
        if (/\p{Script=Han}/u.test(chars[i])) result.add('char:' + chars[i]);
        if (i + 1 < chars.length) result.add('pair:' + chars[i] + chars[i + 1]);
      }
    } else if (indexing) {
      for (let length = 2; length < Math.min(chars.length, 32); length++)
        result.add('word:' + chars.slice(0, length).join(''));
    }
  }
  return result;
}
export function createStickerSuggestionIndex(assets = [], mappings = []) {
  const documents = new Map(),
    postings = new Map();
  function add(id, text, weight) {
    for (const term of terms(text, true)) {
      if (!postings.has(term)) postings.set(term, new Map());
      const hits = postings.get(term);
      hits.set(id, Math.max(hits.get(id) || 0, weight));
    }
  }
  for (const asset of assets) {
    if (!hasLocalStickerOriginal(asset) || documents.has(asset.id)) continue;
    const name = typeof asset.name === 'string' ? asset.name : '表情包';
    documents.set(asset.id, { id: asset.id, name });
    add(asset.id, name.replace(/\.(png|jpe?g|webp|gif|avif)$/iu, ''), 5);
    add(asset.id, typeof asset.note === 'string' ? asset.note.slice(0, 2000) : '', 3);
  }
  for (const mapping of mappings) {
    if (mapping?.kind !== 'sticker' || !documents.has(mapping.assetId)) continue;
    add(mapping.assetId, mapping.name || String(mapping.id || '').replace(/^mapping:/u, ''), 8);
  }
  return Object.freeze({
    size: documents.size,
    search(text, limit = 5) {
      const tail = typeof text === 'string' ? text.slice(-640) : '';
      const normalized = [...normalizeStickerText(tail)].slice(-160).join('');
      if (!normalized) return [];
      const keys = terms(normalized);
      const singleHan = [...normalized].length === 1;
      const scores = new Map();
      for (const term of keys) {
        // One-character matches are useful on their own, too noisy inside a sentence.
        if (term.startsWith('char:') && !singleHan) continue;
        const weight = term.startsWith('word:') ? 4 : term.startsWith('pair:') ? 2 : 1;
        for (const [id, rank] of postings.get(term) || [])
          scores.set(id, (scores.get(id) || 0) + weight * rank);
      }
      return [...scores]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))
        .slice(0, Math.min(50, Math.max(1, Number.isInteger(limit) ? limit : 5)))
        .map(([id, score]) => ({ ...documents.get(id), score }));
    },
  });
}
