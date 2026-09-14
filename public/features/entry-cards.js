/** List covers only reference existing image attachments; never duplicate or modify media. */
export function entryCover(entry, mediaById) {
  for (const id of entry.attachments || []) {
    const media = mediaById.get(id);
    if (media?.type?.startsWith('image/')) return media;
  }
  return null;
}

export function coverMarkup(entry, mediaById, escape) {
  const cover = entryCover(entry, mediaById);
  return cover
    ? `<img class="entry-card-cover" src="/media/${escape(encodeURIComponent(cover.id))}" alt="" loading="lazy" decoding="async" draggable="false" aria-hidden="true">`
    : '';
}
