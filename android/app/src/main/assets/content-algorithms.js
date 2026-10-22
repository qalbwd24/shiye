// Portable facade only. Shared modules are copied unchanged by syncEditorAssets.
import {
  validateRichDocument,
  richMediaReferences,
  toEditorJSON,
  fromEditorJSON,
} from './public/shared/rich-document.js';
import { validateRenderableRichDocument } from './public/shared/rich-document-renderer.js';
import {
  prepareDiaryUnits,
  reassembleDiaryUnits,
  validateMessageUnit,
} from './public/shared/message-units.js';
import { projectDiaryParagraphMessages } from './public/shared/diary-paragraph-messages.js';

export {
  validateRichDocument,
  validateRenderableRichDocument,
  richMediaReferences,
  toEditorJSON,
  fromEditorJSON,
  prepareDiaryUnits,
  reassembleDiaryUnits,
  validateMessageUnit,
  projectDiaryParagraphMessages,
};
export { buildLegacyTimeSegments } from './public/shared/legacy-time-segments.js';
export { readManualTime } from './public/shared/content-preparation.js';

// This describes the current Android write path, not a claim about any future server.
export const currentCanonicalEnabled = true;

/** Validate without converting, stripping fields, allocating IDs, or touching storage. */
export function inspectRichDocument(body) {
  try {
    validateRichDocument(body);
    validateRenderableRichDocument(body);
    return { supported: true, readOnly: false };
  } catch (error) {
    return { supported: false, readOnly: true, reason: String(error.message || error) };
  }
}

/** Synthetic QA only: deterministic IDs must never replace identities received from storage. */
export function runContentFixture(fixture) {
  if (fixture?.fixtureVersion !== 1) throw new Error('Unsupported synthetic fixture version');
  const original = JSON.stringify(fixture);
  const { entry, media, timeZone } = fixture;
  validateRichDocument(entry.body);
  validateRenderableRichDocument(entry.body);
  const editorRoundtrip = fromEditorJSON(toEditorJSON(entry.body));
  let nextId = 0;
  const prepared = prepareDiaryUnits(entry, {
    media,
    timeZone,
    createId: () => 'fixture-unit-' + ++nextId,
  });
  prepared.units.forEach(validateMessageUnit);
  const reassembled = reassembleDiaryUnits(prepared.units, prepared.layout);
  const projected = projectDiaryParagraphMessages(prepared.units);
  const firstGroup = projected.filter(
    (unit) => unit.paragraphProjection?.parentUnitId === prepared.units[0].id,
  );
  const images = projected.filter((unit) => richMediaReferences(unit.body).length);
  if (JSON.stringify(fixture) !== original) throw new Error('Shared algorithm mutated its input');
  return {
    fixtureVersion: fixture.fixtureVersion,
    currentCanonicalEnabled,
    prepared,
    projected,
    reassembled,
    editorRoundtrip,
    summary: {
      firstManualInstant: prepared.units[0].eventTime.instant,
      secondParagraphInstant: firstGroup[1]?.eventTime.instant,
      knownMediaInstant: images[0]?.eventTime.instant,
      unknownMediaFallbackInstant: images[1]?.eventTime.instant,
      occurrenceIds: images.map((unit) => richMediaReferences(unit.body)[0].occurrenceId),
      unknownMediaInsertedAt: richMediaReferences(images[1]?.body)[0]?.insertedAt,
    },
  };
}
