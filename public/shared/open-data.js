import { getEditorDocument } from './editor-document.js';
import { isHidden } from './entry-state.js';

export const OPEN_DATA_API_VERSION = 1;
export const OPEN_DATA_SCHEMA_VERSION = 1;
export const OPEN_DATA_TIME_ZONE = 'Asia/Shanghai';

const string = (value) => (typeof value === 'string' ? value : '');
const revision = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
const formatters = new Map();

/** Recorded calendar date in an explicit zone; invalid legacy dates stay unknown. */
export function openRecordedDate(value, timeZone = OPEN_DATA_TIME_ZONE) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return null;
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    if (formatters.size >= 64) formatters.clear();
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(value)).map((p) => [p.type, p.value]),
  );
  return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`;
}

/** Copy a public allowlist only. No filesystem paths or import metadata are exposed. */
function projectMedia(media) {
  if (!media || typeof media.id !== 'string') return null;
  const result = {
    id: media.id,
    name: string(media.name),
    type: string(media.type),
    size: Number.isFinite(media.size) && media.size >= 0 ? media.size : null,
    sha256: string(media.sha256) || null,
    url: '/media/' + encodeURIComponent(media.id),
  };
  for (const key of [
    'lastModified',
    'sourceLastModified',
    'importedAt',
    'creationTime',
    'originalSize',
    'originalSha256',
    'compressionQuality',
    'sourceCapturedAtRaw',
    'sourceCapturedOffset',
    'sourceCapturedTag',
  ]) {
    if (
      typeof media[key] === 'string' ||
      (typeof media[key] === 'number' && Number.isFinite(media[key]))
    )
      result[key] = media[key];
  }
  if (typeof media.compressed === 'boolean') result.compressed = media.compressed;
  if (media.compression && typeof media.compression === 'object') {
    result.compression = { method: string(media.compression.method) };
    if (Number.isFinite(media.compression.originalSize) && media.compression.originalSize >= 0)
      result.compression.originalSize = media.compression.originalSize;
  }
  return result;
}

/** Stable, read-only browser/server projection. HTML is preserved, never converted to text. */
export function projectOpenEntry(
  entry,
  mediaMap = new Map(),
  { includeComments = false, timeZone = OPEN_DATA_TIME_ZONE } = {},
) {
  const lookup =
    mediaMap instanceof Map
      ? mediaMap
      : new Map((Array.isArray(mediaMap) ? mediaMap : []).map((m) => [m.id, m]));
  const media = (id) => projectMedia(lookup.get(id));
  const attachments = (ids) =>
    [...new Set(Array.isArray(ids) ? ids : [])].map(media).filter(Boolean);
  const document = getEditorDocument(entry);
  if (document.format === 'richdoc') document.body = structuredClone(document.body);
  const result = {
    id: string(entry.id),
    revision: revision(entry.revision),
    title: string(entry.title),
    date: string(entry.date),
    recordedDate: openRecordedDate(entry.date, timeZone),
    createdAt: string(entry.createdAt),
    updatedAt: string(entry.updatedAt),
    ...(entry.contentEditedAt !== undefined
      ? { contentEditedAt: string(entry.contentEditedAt) || null }
      : {}),
    category: string(entry.category),
    tags: Array.isArray(entry.tags) ? entry.tags.filter((tag) => typeof tag === 'string') : [],
    mood: string(entry.mood),
    weather: string(entry.weather),
    location: string(entry.location),
    document: { ...document, html: string(entry.content) },
    state: {
      hidden: isHidden(entry),
      draft: !!entry.draft,
      deleted: !!entry.deleted,
      pinned: !!entry.pinned,
    },
    attachments: attachments(entry.attachments),
  };
  if (includeComments) {
    const comments = (Array.isArray(entry.comments) ? entry.comments : []).filter(
      (c) => c && !c.deleted,
    );
    const visible = new Set(comments.map((c) => c.id));
    result.comments = comments.map((comment) => {
      const projected = {
        id: string(comment.id),
        revision: revision(comment.revision),
        body: string(comment.body),
        authorName: string(comment.authorName),
        authorAvatar: media(comment.authorAvatarId),
        createdAt: string(comment.createdAt),
        updatedAt: string(comment.updatedAt),
        attachments: attachments(comment.attachments),
      };
      if (comment.replyTo && visible.has(comment.replyTo)) {
        projected.replyTo = string(comment.replyTo);
        if (comment.replyPreview)
          projected.replyPreview = {
            id: string(comment.replyPreview.id),
            body: string(comment.replyPreview.body),
            authorName: string(comment.replyPreview.authorName),
          };
      }
      return projected;
    });
  }
  return result;
}

export const OPEN_DATA_SCHEMA = {
  apiVersion: OPEN_DATA_API_VERSION,
  schemaVersion: OPEN_DATA_SCHEMA_VERSION,
  format: 'shiye-open-data',
  basePath: '/api/open/v1',
  defaultTimeZone: OPEN_DATA_TIME_ZONE,
  capabilities: {
    readOnly: true,
    localOnly: true,
    requiresExistingUnlockSession: true,
    cors: false,
    uploadsToAI: false,
    mediaBytesIncluded: false,
    fullBackup: false,
    anniversaryCycles: ['year'],
  },
  endpoints: {
    schema: 'GET /schema',
    entries: 'GET /entries',
    entry: 'GET /entries/:id',
    random: 'GET /random',
    anniversary: 'GET /anniversary',
    export: 'GET /export',
  },
  query: {
    from: 'YYYY-MM-DD inclusive recordedDate lower bound',
    to: 'YYYY-MM-DD inclusive recordedDate upper bound',
    timeZone: 'Intl-supported time zone; default Asia/Shanghai',
    category: 'Exact category name',
    tag: 'Exact tag name',
    q: 'Case-insensitive substring of title, document.source, category, tags, mood, weather or location; HTML source is not converted to plain text',
    ids: 'Comma-separated UUIDs; at most 200',
    includeHidden: 'true|false; default false',
    includeDrafts: 'true|false; default false',
    includeDeleted: 'true|false; default false',
    includeComments:
      'true|false; default false; deleted comments and their quoted previews are omitted',
    sort: 'date-desc (default), date-asc, updated-desc; ID breaks ties; random uses snapshot-stable pseudorandom order',
    limit: '1..200; default 50; random default 1',
    offset: 'Nonnegative safe integer; default 0',
    snapshot:
      'Optional previous response SHA-256; mismatch is HTTP 409; preserves pagination consistency, not an archived library',
    exclude: 'random only: comma-separated UUIDs, at most 200',
    seed: 'random only: 1..128 letters, digits, underscores or hyphens; newly generated by default; reuse returned seed and snapshot for consistent pagination',
    date: 'anniversary only: YYYY-MM-DD; default today in timeZone; matches previous years on the same month/day',
  },
  response: {
    list: [
      'apiVersion',
      'schemaVersion',
      'entries',
      'total',
      'limit',
      'offset',
      'nextOffset',
      'snapshot',
      'timeZone',
    ],
    entry: ['apiVersion', 'schemaVersion', 'entry', 'snapshot', 'timeZone'],
    random: 'List response plus seed; reuse seed and snapshot when requesting the next page',
    export:
      'List response plus format and exportedAt; paginated JSON download, not a complete backup',
  },
  fields: {
    entry: {
      id: 'string, stable entry identifier',
      revision: 'integer',
      title: 'string',
      date: 'Original recorded timestamp, unchanged',
      recordedDate: 'YYYY-MM-DD in requested timeZone, or null for invalid legacy date',
      createdAt: 'Original creation timestamp',
      updatedAt: 'Original update timestamp',
      contentEditedAt:
        'Optional original content edit timestamp, or explicit null when unknown; metadata edits do not advance it',
      category: 'string',
      tags: 'string[]',
      mood: 'string',
      weather: 'string',
      location: 'string',
      document:
        '{format: markdown|html, source: exact editable source, html: original stored HTML projection} or {format: richdoc, body: exact shiye-richdoc v1 tree including image/video, html: compatibility projection}; sanitize HTML before rendering',
      state: '{hidden:boolean,draft:boolean,deleted:boolean,pinned:boolean}',
      attachments: 'Media[]; registered attachments only',
      comments: 'Optional Comment[]; body and replyPreview.body are plain text',
    },
    media: {
      id: 'string',
      name: 'string',
      type: 'MIME string',
      size: 'number|null',
      sha256: 'string|null',
      url: 'Same-origin /media/:id; existing lock applies',
      lastModified: 'optional source timestamp',
      importedAt: 'optional import timestamp',
      sourceCapturedAtRaw: 'optional original EXIF date, not implicitly UTC',
      sourceCapturedOffset: 'optional original EXIF offset',
      sourceCapturedTag: 'optional EXIF field name',
      sourceLastModified: 'optional source timestamp',
      creationTime: 'optional video creation timestamp',
      originalSize: 'optional original byte size',
      originalSha256: 'optional original content hash',
      compressionQuality: 'optional compression quality',
      compressed: 'optional boolean',
      compression: 'optional {method,originalSize}; explicit metadata only',
    },
    comment: {
      id: 'string',
      revision: 'integer',
      body: 'plain text',
      authorName: 'string',
      authorAvatar: 'Media|null',
      createdAt: 'string',
      updatedAt: 'string',
      attachments: 'Media[]',
      replyTo: 'optional visible comment ID',
      replyPreview: 'optional {id,body,authorName} snapshot for a visible reply target',
    },
  },
  excluded: [
    'settings',
    'legacy',
    'history',
    'editorOriginalHtml',
    'originals',
    'imports',
    'access credentials',
    'media filesystem paths',
  ],
};
