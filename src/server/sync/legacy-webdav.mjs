import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { decodeLegacy, sha } from '../imports/legacy.mjs';

const MAX_REMOTE_JSON = 128 * 1024 * 1024;
const MAX_REMOTE_MEDIA = 4 * 1024 * 1024 * 1024;
const IMAGE = /^image\/(png|jpeg|webp|gif|avif)$/;
const VIDEO = /^video\/(mp4|webm|quicktime)$/;
const AUDIO = /^audio\/(mpeg|mp4|ogg|wav|x-wav|webm|aac)$/;

const extensionType = (name) => {
  const ext = path.posix.extname(name).toLowerCase();
  return (
    {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.avif': 'image/avif',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.webm': 'video/webm',
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
    }[ext] || 'application/octet-stream'
  );
};

const plain = (value) =>
  String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

function normalizeBase(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw Error('请填写 WebDAV 地址');
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw Error('WebDAV 地址格式不正确');
  }
  if (!['https:', 'http:'].includes(url.protocol)) throw Error('WebDAV 只支持 HTTP 或 HTTPS');
  if (
    url.protocol === 'http:' &&
    !['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase())
  )
    throw Error('公网 WebDAV 必须使用 HTTPS');
  url.search = '';
  url.hash = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.toString();
}

const join = (base, relative) => new URL(relative.replace(/^\/+/, ''), base).toString();

function authorization(username, password) {
  if (typeof username !== 'string' || !username.trim()) throw Error('请填写 WebDAV 用户名');
  if (typeof password !== 'string' || !password) throw Error('请填写 WebDAV 密码');
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

async function davRequest(base, username, password, relative, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout ?? 120000);
  try {
    const headers = {
      Authorization: authorization(username, password),
      ...(options.headers || {}),
    };
    const response = await fetch(join(base, relative), {
      method: options.method || 'GET',
      headers,
      body: options.body,
      signal: controller.signal,
      redirect: 'error',
    });
    const chunks = [];
    let size = 0;
    const limit =
      options.maxBytes ?? (relative.endsWith('diary.json') ? MAX_REMOTE_JSON : MAX_REMOTE_MEDIA);
    for await (const chunk of response.body || []) {
      size += chunk.length;
      if (size > limit) {
        controller.abort();
        throw Error('WebDAV 响应超过允许大小');
      }
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks);
    return { ok: response.ok, status: response.status, headers: response.headers, data };
  } catch (error) {
    if (error.name === 'AbortError') throw Error('WebDAV 请求超时');
    throw Error('WebDAV 连接失败：' + error.message);
  } finally {
    clearTimeout(timer);
  }
}

function validateContainer(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('云端 diary.json 不是对象');
  for (const key of ['json', 'catagory', 'model', 'tag'])
    if (typeof value[key] !== 'string') throw Error(`云端 diary.json 缺少 ${key}`);
  for (const [key, valueText] of Object.entries({
    json: value.json,
    catagory: value.catagory,
    model: value.model,
    tag: value.tag,
  })) {
    try {
      if (!Array.isArray(JSON.parse(valueText))) throw Error('not an array');
    } catch {
      throw Error(`云端 diary.json 的 ${key} 不是有效 JSON`);
    }
  }
}

function stableId(name) {
  return createHash('sha256').update(`shiye-webdav:${name}`).digest('hex').slice(0, 32);
}

export function legacyEntry(entry, mediaNames) {
  const original = structuredClone(entry.legacy?.original || {});
  const date = Date.parse(entry.date);
  const created = Date.parse(entry.createdAt || entry.date);
  const updated = Date.parse(entry.updatedAt || entry.date);
  const images = [];
  const audio = [];
  const draw = [];
  for (const name of mediaNames) {
    const type = extensionType(name);
    if (AUDIO.test(type)) audio.push(name);
    else if (IMAGE.test(type) || VIDEO.test(type)) images.push(name);
  }
  // Missing downloads must never silently remove references from the cloud copy.
  for (const ref of entry.legacy?.mediaReferences || []) {
    if (ref.mediaId && (entry.attachments || []).includes(ref.mediaId)) continue;
    if (ref.mediaId && ref.status !== 'unresolved') continue;
    const name = String(ref.reference || '')
      .split(/[\\/]/)
      .pop();
    if (!name) continue;
    const target = /audio/i.test(ref.field) ? audio : /draw/i.test(ref.field) ? draw : images;
    target.push(name);
  }
  return {
    ...original,
    uuid: String(original.uuid || original.id || entry.id),
    title: String(entry.title || ''),
    content:
      entry.markdownSource !== null &&
      entry.markdownSource !== undefined &&
      (entry.contentFormat === 'markdown' ||
        (!entry.contentFormat && Number(original.contentType) === 1))
        ? entry.markdownSource
        : plain(entry.content),
    contentType:
      entry.markdownSource !== null &&
      entry.markdownSource !== undefined &&
      (entry.contentFormat === 'markdown' ||
        (!entry.contentFormat && Number(original.contentType) === 1))
        ? 1
        : 0,
    createTime: Number.isFinite(date) ? date : Date.now(),
    recordTime: Number.isFinite(created) ? created : Number.isFinite(date) ? date : Date.now(),
    updateTime: Number.isFinite(updated) ? updated : Number.isFinite(date) ? date : Date.now(),
    category: original.category ?? null,
    type: String(entry.category || ''),
    tag: (entry.tags || []).join('|'),
    images: [...new Set(images)].join('|'),
    localImages: '',
    audio: [...new Set(audio)].join('|'),
    draw: [...new Set(draw)].join('|'),
    localAudio: '',
    localDraw: '',
    deleted: !!entry.deleted,
    isHidden: !!entry.hidden,
    top: entry.pinned ? 1 : 0,
    weather: String(entry.weather || ''),
    address: String(entry.location || ''),
    m: original.m ?? 0,
    device: '拾页电脑端',
  };
}

/** Convert the desktop library to the DiarySource container used by the Android client. */
export function toDiarySource(db, { previousSource } = {}) {
  const excluded = new Set();
  const split = new Set();
  for (const conflict of db.conflicts || []) {
    if (conflict.kind !== 'entry' || conflict.status !== 'resolved') continue;
    if (conflict.choice === 'both') split.add(conflict.right);
    if (conflict.choice === 'left') excluded.add(conflict.right);
    if (conflict.choice === 'right') excluded.add(conflict.left);
  }
  const eligible = (db.entries || []).filter((e) => !e.demo && !e.draft && !excluded.has(e.id));
  if (eligible.some((entry) => entry.contentFormat === 'richdoc'))
    throw Object.assign(
      new Error(
        '当前安卓兼容同步无法保留富文档正文、格式和图片出现信息，已阻止有损上传；本地原件未改变。',
      ),
      { status: 409 },
    );
  const referenced = new Set(eligible.flatMap((e) => e.attachments || []));
  const names = new Map();
  const mediaFiles = [];
  for (const media of db.media || []) {
    if (!referenced.has(media.id)) continue;
    const ext = path.posix
      .extname(media.name || '')
      .toLowerCase()
      .replace(/[^.a-z0-9]/g, '');
    const name = `shiye-${media.sha256 || stableId(media.id)}${ext}`;
    names.set(media.id, name);
    mediaFiles.push({ ...media, remoteName: name });
  }
  const entries = eligible.map((entry) => {
    const projected = legacyEntry(
      entry,
      (entry.attachments || []).map((id) => names.get(id)).filter(Boolean),
    );
    if (split.has(entry.id)) projected.uuid = entry.id;
    return projected;
  });
  const prior = (key) => {
    const rows = new Map();
    for (const archive of db.imports || []) {
      for (const row of archive.tables?.[key] || []) rows.set(row.uuid || row.name, row);
    }
    return [...rows.values()];
  };
  const preserveNamed = (rows, labels, kind, deletedKey) => {
    const result = rows.map((row) => structuredClone(row));
    for (const name of labels) {
      if (!result.some((row) => row.name === name && !row[deletedKey]))
        result.push({ uuid: stableId(kind + ':' + name), name, [deletedKey]: false });
    }
    return result;
  };
  const categories = preserveNamed(
    prior('category.json'),
    [
      ...new Set(
        [...(db.categories || []), ...(db.entries || []).map((e) => e.category)]
          .filter(Boolean)
          .map(String),
      ),
    ],
    'category',
    'isDeleted',
  );
  const tags = [
    ...new Set(
      [
        ...(db.tags || []),
        ...(db.entries || []).flatMap((entry) => (entry.tags || []).map(String)),
      ].filter(Boolean),
    ),
  ];
  const tagRows = preserveNamed(prior('tag.json'), tags, 'tag', 'deleted');
  const models = (db.templates || []).map((template) => ({
    ...structuredClone(template.legacy || {}),
    uuid: String(template.legacy?.uuid || template.id),
    name: String(template.name || ''),
    content:
      Number(template.legacy?.contentType) === 1
        ? template.legacy.content
        : plain(template.content),
    contentType: Number(template.legacy?.contentType) === 1 ? 1 : 0,
    isDelete: !!template.deleted,
  }));
  return {
    source: {
      ...structuredClone((db.imports || []).at(-1)?.tables?._original || {}),
      json: JSON.stringify(entries),
      catagory: JSON.stringify(categories),
      model: JSON.stringify(models),
      tag: JSON.stringify(tagRows),
      dataVersion: (db.imports || []).at(-1)?.tables?._original?.dataVersion ?? 1,
      // The Android client accepts this field as metadata. Keeping it stable
      // when the projected diary is unchanged lets the desktop client use a
      // content hash to skip a redundant full diary.json PUT.
      st: previousSource?.st ?? (db.imports || []).at(-1)?.tables?._original?.st ?? Date.now(),
    },
    mediaFiles,
  };
}

function references(entry) {
  return [...(entry.legacy?.mediaReferences || [])]
    .map((ref) =>
      String(ref.reference || '')
        .split(/[\\/]/)
        .pop(),
    )
    .filter(Boolean);
}

/** Download an Android-compatible cloud copy, including media referenced by diary.json. */
export async function fetchDiarySource(config, { etag, mediaManifest = {} } = {}) {
  const base = normalizeBase(config.url);
  const result = await davRequest(base, config.username, config.password, 'diary/diary.json', {
    headers: etag ? { 'If-None-Match': etag } : undefined,
  });
  if (result.status === 304)
    return {
      empty: false,
      notModified: true,
      base,
      etag: result.headers.get('etag') || etag || null,
      sha256: null,
      raw: null,
      imported: null,
      source: null,
      mediaBytes: 0,
      bytes: 0,
    };
  if (result.status === 404) {
    const directory = await davRequest(base, config.username, config.password, '', {
      method: 'PROPFIND',
      headers: { Depth: '0' },
    });
    if (
      directory.status !== 207 ||
      !/<(?:[\w-]+:)?collection\b/i.test(directory.data.toString('utf8'))
    )
      throw Error('无法确认 WebDAV 根目录；拒绝将 404 当作空日记库');
    return { empty: true, base, sha256: null, raw: null, imported: null };
  }
  if (!result.ok && result.status !== 200) throw Error(`读取云端日记失败（HTTP ${result.status}）`);
  if (result.data.length > MAX_REMOTE_JSON) throw Error('云端 diary.json 超过 128 MB');
  const raw = result.data;
  let source;
  try {
    source = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
  } catch {
    throw Error('云端 diary.json 不是有效 UTF-8 JSON');
  }
  validateContainer(source);
  const imported = await decodeLegacy(raw, 'WebDAV diary.json');
  const refs = new Set(imported.entries.flatMap(references));
  let total = 0;
  const media = [];
  for (const name of refs) {
    const known = mediaManifest[name];
    let item;
    // A strong ETag is the only safe way to reuse a local media file without
    // downloading it again. Servers without HEAD support fall back to GET.
    if (known?.etag) {
      const head = await davRequest(
        base,
        config.username,
        config.password,
        'diary/' + encodeURIComponent(name),
        { method: 'HEAD', maxBytes: 0 },
      );
      if (head.ok && head.headers.get('etag') === known.etag) {
        item = {
          status: head.status,
          ok: true,
          headers: head.headers,
          data: null,
          reused: true,
        };
      } else if (head.status === 404) {
        item = head;
      }
    }
    if (!item)
      item = await davRequest(
        base,
        config.username,
        config.password,
        'diary/' + encodeURIComponent(name),
        { maxBytes: MAX_REMOTE_MEDIA - total },
      );
    if (item.status === 404) continue;
    if (!item.ok) throw Error(`读取云端媒体失败（${name}，HTTP ${item.status}）`);
    if (item.reused) {
      media.push({
        id: known.mediaId || randomUUID(),
        name,
        type: known.type || extensionType(name),
        size: Number(known.size || 0),
        sha256: known.sha256,
        etag: known.etag,
        reused: true,
      });
      continue;
    }
    total += item.data.length;
    if (total > MAX_REMOTE_MEDIA) throw Error('云端媒体总量超过 4 GB');
    media.push({
      id: randomUUID(),
      name,
      type: extensionType(name),
      size: item.data.length,
      sha256: sha(item.data),
      etag: item.headers.get('etag') || null,
      data: item.data,
    });
  }
  const byName = new Map(media.map((item) => [item.name, item]));
  for (const entry of imported.entries) {
    entry.attachments = references(entry)
      .map((name) => byName.get(name)?.id)
      .filter(Boolean);
    entry.legacy.mediaReferences = (entry.legacy.mediaReferences || []).map((ref) => ({
      ...ref,
      mediaId: byName.get(String(ref.reference).split(/[\\/]/).pop())?.id || null,
      status: byName.has(String(ref.reference).split(/[\\/]/).pop()) ? 'remote' : 'unresolved',
    }));
  }
  imported.media = media;
  imported.report.media = media.length;
  const mediaManifestResult = Object.fromEntries(
    media.map((item) => [
      item.name,
      {
        sha256: item.sha256 || null,
        size: item.size,
        type: item.type,
        etag: item.etag || null,
        mediaId: item.id,
      },
    ]),
  );
  return {
    empty: false,
    base,
    etag: result.headers.get('etag'),
    sha256: sha(raw),
    raw,
    imported,
    source,
    mediaManifest: mediaManifestResult,
    bytes: raw.length,
    mediaBytes: total,
  };
}

export async function putDiarySource(config, payload, { remote } = {}) {
  const base = normalizeBase(config.url);
  if (!remote || remote.base !== base) throw Error('上传前必须读取并验证同一个 WebDAV 目录');
  if (
    !remote.empty &&
    (!remote.etag || remote.etag.startsWith('W/') || !/^".*"$/.test(remote.etag))
  )
    throw Error('WebDAV 未提供强 ETag，无法安全覆盖；请仅拉取或更换支持条件写入的服务器');
  const source = Buffer.from(JSON.stringify(payload.source));
  // A fresh WebDAV share may not have the Android client's diary collection yet.
  // MKCOL is idempotent for our purposes: existing collections commonly answer
  // 405 or 409, both of which are safe to continue past.
  const collection = await davRequest(base, config.username, config.password, 'diary/', {
    method: 'MKCOL',
  });
  if (!collection.ok && ![405, 409].includes(collection.status))
    throw Error(`创建云端日记目录失败（HTTP ${collection.status}）`);
  let uploadedMedia = 0;
  let uploadedMediaBytes = 0;
  const mediaManifest = {};
  for (const media of payload.mediaFiles) {
    const data = media.data || (media.filePath ? await fs.readFile(media.filePath) : null);
    if (!data) throw Error(`缺少本地媒体内容：${media.remoteName}`);
    const known = remote.mediaManifest?.[media.remoteName];
    if (known?.etag && known.sha256 === media.sha256) {
      const head = await davRequest(
        base,
        config.username,
        config.password,
        'diary/' + encodeURIComponent(media.remoteName),
        { method: 'HEAD', maxBytes: 0 },
      );
      if (head.ok && head.headers.get('etag') === known.etag) {
        mediaManifest[media.remoteName] = { ...known, mediaId: media.id };
        continue;
      }
    }
    const response = await davRequest(
      base,
      config.username,
      config.password,
      'diary/' + encodeURIComponent(media.remoteName),
      {
        method: 'PUT',
        headers: { 'Content-Type': media.type || 'application/octet-stream', 'If-None-Match': '*' },
        body: data,
      },
    );
    if (response.status === 412) {
      const existing = await davRequest(
        base,
        config.username,
        config.password,
        'diary/' + encodeURIComponent(media.remoteName),
      );
      if (!existing.ok || sha(existing.data) !== sha(data))
        throw Error(`云端同名媒体内容不同，拒绝覆盖：${media.remoteName}`);
      mediaManifest[media.remoteName] = {
        sha256: media.sha256 || sha(data),
        size: data.length,
        type: media.type,
        etag: existing.headers.get('etag') || null,
        mediaId: media.id,
      };
    } else if (!response.ok)
      throw Error(`上传媒体失败（${media.remoteName}，HTTP ${response.status}）`);
    else {
      uploadedMedia++;
      uploadedMediaBytes += data.length;
      mediaManifest[media.remoteName] = {
        sha256: media.sha256 || sha(data),
        size: data.length,
        type: media.type,
        etag: response.headers.get('etag') || null,
        mediaId: media.id,
      };
    }
  }
  const response = await davRequest(base, config.username, config.password, 'diary/diary.json', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream;charset=UTF-8',
      ...(remote.empty ? { 'If-None-Match': '*' } : { 'If-Match': remote.etag }),
    },
    body: source,
  });
  if (!response.ok) throw Error(`上传日记失败（HTTP ${response.status}）`);
  return {
    base,
    sha256: sha(source),
    bytes: source.length,
    uploadedMedia,
    uploadedMediaBytes,
    mediaManifest,
    etag: response.headers.get('etag') || null,
  };
}

export { normalizeBase };
