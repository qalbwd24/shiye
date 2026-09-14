import { legacyMood } from '../../../public/shared/legacy-content.js';
import { marked } from '../../../public/vendor/marked.js';
import { createDecipheriv, createHash, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { LEGACY_READER } from '../config.mjs';
export const sha = (b) => createHash('sha256').update(b).digest('hex');
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function zipMembers(raw) {
  let end = -1;
  for (let i = raw.length - 22; i >= Math.max(0, raw.length - 65557); i--)
    if (raw.readUInt32LE(i) === 0x06054b50 && i + 22 + raw.readUInt16LE(i + 20) === raw.length) {
      end = i;
      break;
    }
  if (end < 0) throw Error('ZIP 目录无效');
  const count = raw.readUInt16LE(end + 10);
  let pos = raw.readUInt32LE(end + 16),
    total = 0;
  if (
    count > 10000 ||
    count === 65535 ||
    raw.readUInt16LE(end + 4) !== 0 ||
    raw.readUInt16LE(end + 6) !== 0
  )
    throw Error('暂不支持分卷或 ZIP64 备份');
  const items = new Map(),
    names = new Set();
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || raw.readUInt32LE(pos) !== 0x02014b50) throw Error('ZIP 目录损坏');
    const flags = raw.readUInt16LE(pos + 8),
      method = raw.readUInt16LE(pos + 10),
      crc = raw.readUInt32LE(pos + 16),
      compressed = raw.readUInt32LE(pos + 20),
      size = raw.readUInt32LE(pos + 24),
      len = raw.readUInt16LE(pos + 28),
      extra = raw.readUInt16LE(pos + 30),
      comment = raw.readUInt16LE(pos + 32),
      local = raw.readUInt32LE(pos + 42);
    const name = raw.subarray(pos + 46, pos + 46 + len).toString('utf8');
    pos += 46 + len + extra + comment;
    if (
      !name ||
      /^[\\/]|^[a-z]:|\\|\x00/i.test(name) ||
      name.split('/').includes('..') ||
      names.has(name.toLowerCase())
    )
      throw Error('ZIP 文件名不安全或重复');
    names.add(name.toLowerCase());
    if (name.endsWith('/')) continue;
    total += size;
    if (total > 256 * 1024 * 1024 || size > 128 * 1024 * 1024)
      throw Error('当前导入上限为解压后 256 MB，请分批备份');
    if (flags & 1 || ![0, 8].includes(method)) throw Error('不支持该 ZIP 压缩格式');
    if (local + 30 > raw.length || raw.readUInt32LE(local) !== 0x04034b50)
      throw Error('ZIP 文件头损坏');
    const start = local + 30 + raw.readUInt16LE(local + 26) + raw.readUInt16LE(local + 28);
    if (start + compressed > raw.length) throw Error('ZIP 文件截断');
    const b = raw.subarray(start, start + compressed),
      data =
        method === 0 ? Buffer.from(b) : inflateRawSync(b, { maxOutputLength: Math.max(1, size) });
    if (data.length !== size || crc32(data) !== crc) throw Error('ZIP 文件校验失败');
    items.set(name, data);
  }
  return items;
}
async function keys() {
  // Reuse the version-specific compatibility constants already audited in the offline reader.
  const code = await readFile(LEGACY_READER, 'utf8');
  const block = code.match(/KEYS = (\{[^}]+\})/s)?.[1],
    win = code.match(/WINDOWS_KEY = '([a-fA-F0-9]{64})'/)?.[1];
  if (!block || !win) throw Error('旧格式兼容定义缺失');
  return {
    android: Object.fromEntries(
      [...block.matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]),
    ),
    win: Buffer.from(win, 'hex'),
  };
}
const parse = (b) => JSON.parse(b.toString('utf8').replace(/^\uFEFF/, ''));
function decrypt(raw, key, mode) {
  const d = createDecipheriv(mode, key, mode.endsWith('cbc') ? Buffer.alloc(16) : null);
  return Buffer.concat([d.update(raw), d.final()]);
}
const typeFor = (name) =>
  ({
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
  })[name.split('.').pop().toLowerCase()] || 'application/octet-stream';
function array(value, name) {
  const v = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(v) || v.some((x) => !x || typeof x !== 'object' || Array.isArray(x)))
    throw Error(name + ' 应为对象数组');
  return v;
}
function dateOf(value) {
  let v = value;
  if (typeof v === 'number' && v > 0 && v < 100000000000) v *= 1000;
  const d = new Date(v);
  return v && Number.isFinite(d.valueOf()) ? d.toISOString() : null;
}
export async function decodeLegacy(raw, name = 'backup', options = {}) {
  let kind,
    tables,
    encoding = {},
    files = new Map();
  if (raw.length >= 4 && raw.readUInt32LE(0) === 0x04034b50) {
    kind = 'android-backup';
    files = options.members || zipMembers(raw);
    const sources = [...files.keys()].filter((x) => path.posix.basename(x) === 'source.json');
    if (sources.length !== 1) throw Error('备份需要包含唯一的 source.json');
    const prefix = path.posix.dirname(sources[0]),
      k = await keys();
    tables = {};
    for (const [file, key] of Object.entries(k.android)) {
      const full = prefix === '.' ? file : prefix + '/' + file;
      if (!files.has(full)) continue;
      const bytes = files.get(full),
        text = bytes
          .toString('utf8')
          .replace(/^\uFEFF/, '')
          .trim();
      if (
        text.startsWith('[') ||
        text.startsWith('{') ||
        (file === 'version' && /^\d+$/.test(text))
      ) {
        tables[file] = JSON.parse(text);
        encoding[file] = 'plaintext';
      } else {
        const b64 = text.replace(/\s/g, '');
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4)
          throw Error('旧备份密文格式不正确');
        tables[file] = parse(
          decrypt(
            Buffer.from(b64, 'base64'),
            createHash('sha256').update(key).digest(),
            'aes-256-cbc',
          ),
        );
        encoding[file] = 'AES-256-CBC / SHA-256 / zero-IV / PKCS7 / Base64';
      }
      if (file === 'version' && ![0, 1, 2, 3].includes(tables[file]))
        throw Error('尚未支持这个备份版本');
      if (file !== 'version') array(tables[file], file);
    }
  } else {
    const text = raw
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .trim();
    let obj;
    if (text.startsWith('{') || text.startsWith('[')) {
      obj = JSON.parse(text);
      kind = 'legacy-json';
    } else {
      if (!/^[a-fA-F0-9]+$/.test(text) || text.length % 32) throw Error('未识别的数据格式');
      const k = await keys();
      obj = parse(decrypt(Buffer.from(text, 'hex'), k.win, 'aes-256-ecb'));
      kind = 'windows-data';
      encoding.windows = 'AES-256-ECB / PKCS7 / Hex';
    }
    if (Array.isArray(obj)) tables = { 'source.json': obj };
    else if (obj.diaryList)
      tables = {
        'source.json': obj.diaryList,
        'category.json': obj.categoryList || [],
        'tag.json': obj.tagList || [],
        'model.json': obj.modelList || [],
        _original: obj,
      };
    else if (obj.json)
      tables = {
        'source.json': array(obj.json, 'json'),
        'category.json': array(obj.catagory || obj.category || [], 'catagory'),
        'tag.json': array(obj.tag || [], 'tag'),
        'model.json': array(obj.model || [], 'model'),
        _original: obj,
      };
    else throw Error('未识别的日记 JSON 结构');
  }
  const diaries = array(tables['source.json'], '日记'),
    cats = array(tables['category.json'] || [], '分类'),
    tags = array(tables['tag.json'] || [], '标签');
  const lookup = (list, key) => {
    const v = list.find((x) =>
      [x.uuid, x.id, x._id, x.name, x.title].some(
        (k) => k !== null && k !== undefined && String(k) === String(key),
      ),
    );
    return v?.name || v?.title || v?.content || String(key || '');
  };
  const media = [],
    byName = new Map();
  for (const [filename, data] of files) {
    if (
      ['source.json', 'category.json', 'tag.json', 'model.json', 'version'].includes(
        path.posix.basename(filename),
      )
    )
      continue;
    const m = {
      id: randomUUID(),
      name: path.posix.basename(filename),
      type: typeFor(filename),
      size: Buffer.isBuffer(data) ? data.length : data.size,
      ...(Buffer.isBuffer(data) ? { data, sha256: sha(data) } : data),
    };
    media.push(m);
    const b = path.posix.basename(filename);
    byName.set(b, [...(byName.get(b) || []), m]);
  }
  let unresolved = 0,
    candidates = 0;
  const now = new Date().toISOString();
  const entries = diaries.map((e, index) => {
    const references = [],
      attachments = [];
    for (const field of ['images', 'localImages', 'audio', 'localAudio', 'draw', 'localDraw'])
      for (const ref of String(e[field] || '')
        .split('|')
        .filter(Boolean)) {
        const base = ref.split(/[\\/]/).pop(),
          match = byName.get(base) || [];
        const status =
          match.length === 1 ? 'basename_candidate' : match.length ? 'ambiguous' : 'unresolved';
        if (match.length === 1) {
          attachments.push(match[0].id);
          candidates++;
        } else unresolved++;
        references.push({
          field,
          reference: ref,
          status,
          mediaId: match.length === 1 ? match[0].id : null,
        });
      }
    const originalContent = String(e.content || '');
    return {
      id: randomUUID(),
      title: String(e.title || ''),
      content:
        e.contentType === 1
          ? marked.parse(originalContent)
          : originalContent
              .split(/\r?\n/)
              .map((s) => '<p>' + esc(s) + '</p>')
              .join(''),
      ...(Number(e.contentType) === 1
        ? { markdownSource: originalContent, markdownHtml: marked.parse(originalContent) }
        : {}),
      hidden: !!e.isHidden,
      date: dateOf(e.createTime) || dateOf(e.recordTime) || now,
      createdAt: dateOf(e.recordTime) || dateOf(e.createTime) || now,
      updatedAt: dateOf(e.updateTime) || now,
      revision: 1,
      category: lookup(cats, e.category || e.type) || '未分类',
      tags: String(e.tag || '')
        .split('|')
        .filter(Boolean)
        .map((t) => lookup(tags, t)),
      attachments: [...new Set(attachments)],
      history: [],
      weather: String(e.weather ?? ''),
      mood: String(e.mood ?? legacyMood(e.m)),
      location: String(e.address || e.city || ''),
      pinned: !!e.top,
      deleted: !!e.deleted,
      demo: false,
      legacy: {
        original: e,
        index,
        kind,
        mediaReferences: references,
        contentType: e.contentType,
        display: e.contentType === 1 ? 'markdown-rendered' : 'plain-preserving-original',
        isHidden: !!e.isHidden,
      },
    };
  });
  const templates = array(tables['model.json'] || [], '模板').map((t) => ({
    id: randomUUID(),
    name: String(t.name || t.title || '导入模板'),
    content:
      t.contentType === 1
        ? marked.parse(String(t.content || ''))
        : '<p>' + esc(t.content || '') + '</p>',
    category: '',
    deleted: !!t.isDelete,
    legacy: t,
  }));
  return {
    kind,
    entries,
    media,
    templates,
    tags: tags
      .filter((t) => !t.isDeleted && !t.isDelete)
      .map((t) => lookup(tags, t.uuid ?? t.id ?? t.name)),
    categories: cats.map((c) => String(c.name || c.title || c.uuid || '未分类')),
    archive: {
      id: randomUUID(),
      name,
      kind,
      sha256: options.sha256 || sha(raw),
      encoding,
      tables,
      importedAt: now,
    },
    report: {
      entries: entries.length,
      media: media.length,
      unresolved,
      candidateMatches: candidates,
      formatting: 'Markdown 已转为富文本；原始字段与格式标记仍保留。自定义排版与媒体关联需要核对',
    },
  };
}
