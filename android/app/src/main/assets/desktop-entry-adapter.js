/* Capability/merge seam only. No transport, HTML conversion or data migration. */
const copy = (value) => structuredClone(value);
const editableFields = new Set([
  'title',
  'date',
  'category',
  'categoryId',
  'tags',
  'attachments',
  'body',
  'location',
]);
const localFields = new Set([
  'id',
  'revision',
  'title',
  'date',
  'categoryId',
  'category',
  'tags',
  'attachments',
  'body',
  'contentFormat',
  'createdAt',
  'updatedAt',
  'contentEditedAt',
  'preview',
  'searchText',
  'wordCount',
  'deleted',
  'pinned',
  'draftOnly',
]);

export function inspectEntryEnvelope(
  raw,
  {
    validateRenderableRichDocument,
    inspectRichDocument,
    richMediaReferences,
    validateCanonicalEntry,
    sink = 'desktop-entry',
  } = {},
) {
  const rawOriginal = copy(raw);
  const original = raw?.entry && typeof raw.entry === 'object' ? raw.entry : raw;
  const entryOriginal = copy(original);
  const entry = copy(original);
  const result = {
    sink,
    supported: false,
    readOnly: true,
    reason: '',
    rawOriginal,
    entryOriginal,
    entry,
  };
  if (!original || typeof original !== 'object' || Array.isArray(original)) {
    result.reason = '正文信封无效，原件保持完整。';
    return result;
  }
  const readingDocument = original.format === 'shiye-entry-reading-document';
  if (readingDocument && original.version !== 1) {
    result.reason = '未知阅读信封版本，原件保持完整。';
    return result;
  }
  const format =
    original.contentFormat ?? (original.body?.format === 'shiye-richdoc' ? 'richdoc' : null);
  if (format !== 'richdoc') {
    result.reason = '当前编辑器不支持此原始格式，请使用完整只读原文入口。';
    return result;
  }
  try {
    if (typeof inspectRichDocument === 'function') {
      const capability = inspectRichDocument(original.body);
      if (!capability.supported || capability.readOnly)
        throw new Error(capability.reason || '正文只能只读保留。');
    } else if (typeof validateRenderableRichDocument !== 'function')
      throw new Error('正文能力校验尚未准备好。');
    else validateRenderableRichDocument(original.body);
    result.supported = true;
    entry.contentFormat = 'richdoc'; // UI projection only; never normalizes the original.
  } catch (error) {
    result.reason = error.message || '当前编辑器无法完整表达正文，原件保持完整。';
    return result;
  }
  if (
    readingDocument ||
    raw?.readOnly === true ||
    original.readOnly === true ||
    raw?.bodyComplete === false ||
    original.bodyComplete === false
  )
    result.reason = '这是只读阅读投影，不能作为完整原文回存。';
  else if (
    original.messageUnits?.authority === 'messageStore' &&
    !(
      sink === 'android-product' &&
      typeof validateCanonicalEntry === 'function' &&
      validateCanonicalEntry(raw)
    )
  )
    result.reason = '正文权威属于规范消息存储，请使用对应的共用写入能力。';
  else if (original.chatJournal) result.reason = '聊天归篇正文只读，请从原聊天修改。';
  else if (!Number.isSafeInteger(original.revision) || original.revision < 0)
    result.reason = '缺少有效的原始版本，不能安全保存。';
  else if (
    sink === 'android-local' &&
    (!Object.hasOwn(original, 'categoryId') || !/^\d{4}-\d{2}-\d{2}$/.test(original.date || ''))
  )
    result.reason = '本地写入接口尚不能完整保存此桌面日期或分类信封，请使用完整原文入口。';
  else if (sink === 'android-local' && Object.keys(original).some((key) => !localFields.has(key)))
    result.reason = '本地写入接口尚不能保留此信封的扩展字段，原件只读。';
  else if (
    sink === 'android-local' &&
    Object.hasOwn(original, 'attachments') &&
    (!Array.isArray(original.attachments) ||
      typeof richMediaReferences !== 'function' ||
      JSON.stringify([...new Set(original.attachments)].sort()) !==
        JSON.stringify(
          [...new Set(richMediaReferences(original.body).map((ref) => ref.assetId))].sort(),
        ))
  )
    result.reason = '独立附件尚不能由本地正文写入口完整保存，原件只读。';
  else result.readOnly = false;
  return result;
}

export function mergeEntryChanges(capability, changes, { validateRenderableRichDocument } = {}) {
  if (!capability?.supported || capability.readOnly)
    throw new Error(capability?.reason || '原件当前只读。');
  if (!changes || typeof changes !== 'object' || Array.isArray(changes))
    throw new Error('更改字段无效。');
  const merged = copy(capability.entryOriginal);
  for (const [key, value] of Object.entries(changes)) {
    if (!editableFields.has(key)) throw new Error(`不能通过此编辑入口修改字段：${key}`);
    if (key === 'location') {
      if (capability.sink === 'android-local')
        throw new Error('旧本机保存入口不能完整保存地点，请使用产品日记入口。');
      if (typeof value !== 'string' || value.length > 100)
        throw new Error('地点须为100字以内的文字。');
    }
    merged[key] = copy(value);
  }
  if (Object.hasOwn(changes, 'body')) {
    if (typeof validateRenderableRichDocument !== 'function')
      throw new Error('正文能力校验尚未准备好。');
    validateRenderableRichDocument(merged.body);
  }
  // UI dirty counters never become an Entry revision. The Repository must ACK a new revision.
  merged.revision = capability.entryOriginal.revision;
  return merged;
}
