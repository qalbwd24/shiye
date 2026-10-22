import { renderRichDocument } from '../../../../../public/shared/rich-document-renderer.js';
import { richMediaReferences } from '../../../../../public/shared/rich-document.js';
import { reassembleDiaryUnits } from '../../../../../public/shared/message-units.js';
import { revisitMarkdown } from '../../revisit-markdown.mjs';

export function presentRevisitSource(source) {
  if (!source) return { available: false, html: '<p>原记录已变化或不可查看</p>', media: [] };
  const { unit, entry } = source;
  const media = [
    ...new Set([
      ...richMediaReferences(unit.body).map((item) => item.assetId),
      ...(unit.attachments || []),
    ]),
  ];
  return {
    available: true,
    ref: source.ref,
    revision: unit.revision,
    title: entry.title,
    category: entry.category,
    tags: entry.tags || [],
    eventTime: unit.eventTime,
    html: renderRichDocument(unit.body),
    body: unit.body,
    markdown: revisitMarkdown(unit.body, {
      normalizeDiaryParagraphIndent: unit.origin?.kind === 'diary',
    }),
    media,
  };
}

// Original HTML remains untrusted: the frontend must sanitize before display.
export function readSourceEntryHtml(source, session) {
  if (!source) return null;
  const candidate = session.readDiary(source.entry.id);
  return candidate?.layout
    ? renderRichDocument(reassembleDiaryUnits(candidate.units, candidate.layout))
    : source.entry.content;
}

export function sourceMediaIds(source) {
  if (!source) return new Set();
  return new Set([
    ...richMediaReferences(source.unit.body).map((item) => item.assetId),
    ...(source.unit.attachments || []),
    ...(source.entry.attachments || []),
    ...(source.entry.body
      ? richMediaReferences(source.entry.body).map((item) => item.assetId)
      : []),
  ]);
}
