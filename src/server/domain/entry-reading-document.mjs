import { createHash } from 'node:crypto';
import { convertLegacyReadingEntry } from './legacy-reading-converter.mjs';
import { sanitizeLegacyReadingHTML } from './legacy-reading-html.mjs';
import {
  validateRenderableRichDocument,
  renderRichDocument,
} from '../../../public/shared/rich-document-renderer.js';

const VERSION = 'entry-reading-v1';
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const mediaKind = (asset) => {
  const mime = String(asset?.type || asset?.mimeType || asset?.mime || '');
  return /^image\//.test(mime)
    ? 'image'
    : /^video\//.test(mime)
      ? 'video'
      : /^audio\//.test(mime)
        ? 'audio'
        : asset
          ? 'file'
          : 'missing';
};
function associatedMedia(entry, media) {
  const ids = new Set(Array.isArray(entry.attachments) ? entry.attachments : []);
  for (const match of String(entry.content || '').matchAll(/\/media\/([^/?#"'<>\s]+)/g))
    try {
      ids.add(decodeURIComponent(match[1]));
    } catch {
      /* Converter reports unresolved media separately. */
    }
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.attrs?.assetId) ids.add(node.attrs.assetId);
    if (Array.isArray(node.content)) node.content.forEach(visit);
  };
  if (Array.isArray(entry.body?.content)) entry.body.content.forEach(visit);
  return media.filter((asset) => ids.has(asset.id));
}
function renderPlacements(placements, body) {
  const placedBlocks = new Set();
  const html = placements
    .map((placement) => {
      if (placement.blockId) {
        const block = body?.content.find((node) => node.attrs?.blockId === placement.blockId);
        if (block) {
          placedBlocks.add(placement.blockId);
          return renderRichDocument({ ...body, content: [block] });
        }
      }
      const label = esc(placement.description?.name || placement.description?.fileName || '附件');
      if (!/^[\w:-]+$/.test(placement.assetId) || placement.kind === 'missing')
        return `<p data-missing-attachment>附件原件缺失 · ${label}</p>`;
      const href = '/media/' + encodeURIComponent(placement.assetId);
      const player =
        placement.kind === 'image'
          ? `<img src="${href}" alt="${label}">`
          : ['video', 'audio'].includes(placement.kind)
            ? `<${placement.kind} src="${href}" controls preload="metadata"></${placement.kind}>`
            : '';
      return `<figure data-reading-attachment="${placement.sourceIndex}">${player}<figcaption><a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a></figcaption></figure>`;
    })
    .join('');
  return { html, placedBlocks };
}
function buildProjection(entry, media, timeZone) {
  const attachments = Array.isArray(entry.attachments) ? entry.attachments : [];
  let body = null,
    placements = [],
    issues = [],
    mode = 'richdoc',
    fallback = false;
  if (entry.chatJournal) {
    fallback = true;
    const inBody = new Set();
    for (const match of String(entry.content || '').matchAll(/\/media\/([^/?#"'<>\s]+)/g))
      try {
        inBody.add(decodeURIComponent(match[1]));
      } catch {
        /* Sanitizer handles invalid local references. */
      }
    placements = attachments
      .filter((id) => !inBody.has(id))
      .map((id, sourceIndex) => {
        const asset = media.find((m) => m.id === id);
        return {
          assetId: id,
          kind: mediaKind(asset),
          sourceIndex,
          blockId: null,
          occurrenceId: null,
          insertedAt: null,
          description: asset ? structuredClone(asset) : null,
          placementSource: 'chat-canonical-associated-resource',
        };
      });
  } else if (entry.contentFormat === 'richdoc') {
    try {
      validateRenderableRichDocument(entry.body);
      body = structuredClone(entry.body);
    } catch {
      issues.push({ code: 'invalid-native-richdoc', severity: 'warning' });
      fallback = true;
    }
    const referenced = new Set();
    const visit = (node) => {
      if (node.attrs?.assetId) referenced.add(node.attrs.assetId);
      (node.content || []).forEach(visit);
    };
    (body?.content || []).forEach(visit);
    placements = attachments
      .filter((id) => !referenced.has(id))
      .map((id, sourceIndex) => {
        const asset = media.find((m) => m.id === id);
        return {
          assetId: id,
          kind: mediaKind(asset),
          sourceIndex,
          blockId: null,
          occurrenceId: null,
          insertedAt: null,
          description: asset ? structuredClone(asset) : null,
          placementSource: 'native-associated-resource',
        };
      });
  } else {
    try {
      const converted = convertLegacyReadingEntry(entry, { media, timeZone });
      validateRenderableRichDocument(converted.body);
      body = converted.body;
      placements = converted.attachmentPlacements;
      issues = converted.issues;
      // Explicit preservation fallback, including details, style, malformed nesting, and unknown tags.
      fallback = issues.some(
        (issue) =>
          ![
            'non-image-attachment-body-unsupported',
            'attachment-inline-reference-overlap',
          ].includes(issue.code),
      );
      if (/<(?:details|summary|video|audio)\b/i.test(entry.content || '')) fallback = true;
    } catch {
      fallback = true;
      issues.push({ code: 'legacy-reading-conversion-incomplete', severity: 'warning' });
    }
  }
  if (!placements.length && !body && !entry.chatJournal)
    placements = attachments.map((assetId, sourceIndex) => {
      const asset = media.find((m) => m.id === assetId);
      return {
        assetId,
        sourceIndex,
        kind: mediaKind(asset),
        blockId: null,
        occurrenceId: null,
        insertedAt: null,
        description: asset ? structuredClone(asset) : null,
        placementSource: 'legacy-default-start',
      };
    });
  const region = renderPlacements(placements, body);
  let bodyHtml = '';
  if (fallback) {
    const safe = sanitizeLegacyReadingHTML(entry.content, media);
    bodyHtml = safe.html;
    issues.push(...safe.issues);
    mode = 'compatibility';
  } else {
    const content = body.content.filter((node) => !region.placedBlocks.has(node.attrs?.blockId));
    if (content.length) bodyHtml = renderRichDocument({ ...body, content });
  }
  if (placements.some((placement) => ['audio', 'file', 'missing'].includes(placement.kind)))
    mode = 'compatibility';
  return {
    format: 'shiye-entry-reading-document',
    version: 1,
    algorithmVersion: VERSION,
    readOnly: true,
    mode,
    body,
    bodyComplete:
      !fallback && !placements.some((p) => ['audio', 'file', 'missing'].includes(p.kind)),
    html: `<section data-entry-reading="readonly"><div data-reading-attachment-region>${region.html}</div><div data-reading-body>${bodyHtml}</div></section>`,
    attachmentPlacements: placements.map((placement) => ({ ...placement, insertedAt: null })),
    attachmentRegion: {
      placementSource:
        entry.contentFormat === 'richdoc' ? 'native-associated-resource' : 'legacy-default-start',
      html: region.html,
    },
    issues: issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity || 'warning',
      ...(issue.path ? { path: issue.path } : {}),
    })),
  };
}

/** Bounded in-memory view cache. Source metadata is always read after cache lookup. */
export function createEntryReadingDocumentReader({
  maxEntries = 32,
  maxCacheBytes = 8 * 1024 * 1024,
} = {}) {
  const cache = new Map();
  let cacheBytes = 0;
  return function read(entry, { media = [], timeZone = 'Asia/Shanghai' } = {}) {
    const resources = associatedMedia(entry, media);
    const contentFingerprint = sha({
      id: entry.id,
      content: entry.content,
      contentFormat: entry.contentFormat,
      markdownSource: entry.markdownSource,
      markdownHtml: entry.markdownHtml,
      body: entry.body,
      attachments: entry.attachments,
      chatJournal: entry.chatJournal,
    });
    const mediaFingerprint = sha(resources);
    const fingerprint = sha({ version: VERSION, contentFingerprint, mediaFingerprint, timeZone });
    let item = cache.get(fingerprint);
    if (item) {
      cache.delete(fingerprint);
      cache.set(fingerprint, item);
    } else {
      const projection = buildProjection(entry, resources, timeZone);
      const bytes = Buffer.byteLength(JSON.stringify(projection));
      item = { projection, bytes };
      if (bytes <= maxCacheBytes && maxEntries > 0) {
        while (cache.size && (cache.size >= maxEntries || cacheBytes + bytes > maxCacheBytes)) {
          const oldest = cache.keys().next().value;
          cacheBytes -= cache.get(oldest).bytes;
          cache.delete(oldest);
        }
        cache.set(fingerprint, item);
        cacheBytes += bytes;
      }
    }
    return {
      ...structuredClone(item.projection),
      source: {
        id: entry.id,
        revision: entry.revision ?? null,
        fingerprint,
        contentFingerprint,
        mediaFingerprint,
        contentFormat: entry.contentFormat || 'html',
      },
      metadata: {
        id: entry.id,
        title: entry.title || '',
        category: entry.category || '',
        tags: structuredClone(entry.tags || []),
        date: entry.date ?? null,
        updatedAt: entry.updatedAt ?? null,
        contentEditedAt: entry.contentEditedAt ?? null,
        deleted: !!entry.deleted,
        hidden: !!entry.hidden,
        draft: !!entry.draft,
        comments: structuredClone(entry.comments || []),
        editableSource: !entry.deleted && !entry.chatJournal,
      },
    };
  };
}
