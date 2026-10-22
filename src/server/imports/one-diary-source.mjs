/** Explicit opt-in provenance. A source UUID identifies an export lineage/account,
 * never an archive filename, title, row number or current content. */
export function legacySourceOptions(headers = {}) {
  const policy = headers['x-import-source'];
  if (policy === undefined && headers['x-import-source-id'] === undefined) return {};
  const sourceId = headers['x-import-source-id'];
  if (
    policy !== 'one-diary' ||
    typeof sourceId !== 'string' ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(sourceId)
  )
    throw Object.assign(Error('ONE_DIARY_SOURCE_REQUIRED'), {
      status: 400,
      code: 'ONE_DIARY_SOURCE_REQUIRED',
    });
  return { sourcePolicy: 'one-diary', sourceId };
}

function primaryRecord(original = {}) {
  for (const recordType of ['uuid', 'id']) {
    const value = original[recordType];
    if ((typeof value === 'string' && value.trim().length > 0) || Number.isSafeInteger(value))
      return { recordType, recordId: String(value) };
  }
  return { recordType: null, recordId: null };
}

export function oneDiarySource(options, original) {
  if (options.sourcePolicy === undefined) return undefined;
  const normalized = legacySourceOptions({
    'x-import-source': options.sourcePolicy,
    'x-import-source-id': options.sourceId,
  });
  return {
    provider: 'one-diary',
    sourceId: normalized.sourceId,
    ...primaryRecord(original),
  };
}

export function oneDiaryCandidates(entries, incoming) {
  const source = incoming.legacy?.source;
  if (source?.provider !== 'one-diary') return null;
  if (source.recordId === null) return [];
  const recordType = source.recordType ?? primaryRecord(incoming.legacy?.original).recordType;
  if (!recordType) return [];
  return entries.filter((entry) => {
    const previous = entry.legacy?.source;
    if (previous)
      return (
        previous.provider === source.provider &&
        previous.sourceId === source.sourceId &&
        (previous.recordType ?? primaryRecord(entry.legacy?.original).recordType) === recordType &&
        previous.recordId === source.recordId
      );
    // Existing pre-provenance imports retain their real entry IDs. Never match
    // a native entry merely because its generated ID or title happens to agree.
    const original = entry.legacy?.original;
    const selected = primaryRecord(original);
    return original && selected.recordType === recordType && selected.recordId === source.recordId;
  });
}
