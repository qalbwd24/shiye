// Explicit new private review batches only. No HTTP writer or process control.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { reviewMessageCandidate } from './lib/message-unit-review.mjs';
import { candidateHash } from './lib/message-unit-candidate-validator.mjs';
import { renderRichDocument } from '../public/shared/rich-document-renderer.js';
import { sanitizeReadingHtml } from '../public/shared/reading-html.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inside = (base, target) => {
  const relative = path.relative(base, target);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};
const json = (file) => fs.readFile(file, 'utf8').then(JSON.parse);
const write = (file, data) =>
  fs.writeFile(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
async function inventory(root) {
  const files = {};
  async function visit(dir) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      const target = path.join(dir, item.name);
      if (item.isSymbolicLink()) throw Error('Batch links are prohibited');
      if (item.isDirectory()) await visit(target);
      else
        files[path.relative(root, target).replaceAll('\\', '/')] = sha(await fs.readFile(target));
    }
  }
  await visit(root);
  return files;
}
async function noLinks(root, target) {
  let current = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) throw Error('Batch links are prohibited');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
async function algorithmIdentity() {
  const files = {};
  for (const file of [
    'tools/message-unit-review.mjs',
    'tools/lib/message-unit-review.mjs',
    'public/shared/message-units.js',
    'public/shared/legacy-time-segments.js',
    'public/shared/content-preparation.js',
    'public/shared/rich-document.js',
    'public/shared/rich-document-renderer.js',
    'public/shared/reading-html.js',
    'src/server/domain/legacy-reading-converter.mjs',
    'tools/lib/legacy-conversion-validator.mjs',
    'tools/lib/message-unit-candidate-validator.mjs',
    'package-lock.json',
  ])
    files[file] = sha(await fs.readFile(path.join(ROOT, file)));
  return { sha256: candidateHash(files), files };
}
const statuses = {
  resolved: '已复核',
  'resolved-with-edit-fallback': '按编辑时间兜底（推定）',
  'resolved-with-compatibility': '保留兼容伴随信息',
};
function offlineComparison(items, assets) {
  const dom = new JSDOM('<!doctype html><body></body>');
  const safe = (html) => {
    const template = dom.window.document.createElement('template');
    template.innerHTML = sanitizeReadingHtml(html, dom.window.document);
    for (const node of template.content.querySelectorAll('[src]')) {
      const asset = assets.find((item) => '/media/' + item.id === node.getAttribute('src'));
      if (asset) node.setAttribute('src', 'media/' + asset.file);
      else node.removeAttribute('src');
    }
    return template.innerHTML;
  };
  const media = (entry) =>
    (entry.attachments || [])
      .map((value) => {
        const asset = assets.find(
          (item) => item.id === (typeof value === 'string' ? value : value.assetId || value.id),
        );
        if (!asset) return '<p>原附件引用保留；媒体字节未复制。</p>';
        const url = 'media/' + asset.file;
        return asset.type.startsWith('image/')
          ? `<img src="${url}" alt="原独立附件">`
          : asset.type.startsWith('audio/')
            ? `<audio controls preload="metadata" src="${url}"></audio>`
            : asset.type.startsWith('video/')
              ? `<video controls preload="metadata" src="${url}"></video>`
              : `<a href="${url}">查看原附件</a>`;
      })
      .join('');
  const panels = items
    .map((item, index) => {
      const original = item.original;
      const audio = item.generatedAttachments
        .map((ref) => {
          const asset = assets.find((value) => value.id === ref.assetId);
          return asset
            ? `<aside>独立${ref.kind === 'audio' ? '音频' : '文件'}：原文件及编号保留，时间按原内容编辑时刻兜底。${ref.kind === 'audio' ? `<audio controls preload="metadata" src="media/${asset.file}"></audio>` : ''}</aside>`
            : '';
        })
        .join('');
      return `<section id="item-${index + 1}"><h2>${index + 1}. ${escape(original.title || '未命名日记')} <small>${statuses[item.status]}</small></h2><p>原条目索引 ${item.source.index} · 仅副本 · ${item.decisions.length} 项处理说明</p><div class="columns"><article><h3>原文与独立附件</h3>${media(original)}${safe(original.content)}</article><article><h3>第二轮图文副本</h3>${audio}${safe(renderRichDocument(item.converted.body))}<details><summary>消息时间与复核依据</summary>${item.candidate.units.map((unit) => `<p>${escape(unit.id)}<br>${escape(unit.eventTime.instant || '未知')} · ${escape(unit.eventTime.source)} · ${escape(unit.eventTime.sourceField || '')}${unit.eventTime.inferred ? ' · 推定兜底' : ''}${unit.eventTime.recoveredSyntax ? ' · 标记语法恢复' : ''}</p>`).join('')}<pre>${escape(JSON.stringify(item.decisions, null, 2))}</pre></details>${item.compatibility ? `<details open><summary>原折叠排版（只读保留）</summary>${safe(item.compatibility.originalHTML)}</details>` : ''}</article></div></section>`;
    })
    .join('');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'"><title>12篇旧日记第二轮复核副本</title><style>body{margin:28px;background:#20292e;color:#dce5e7;font:16px/1.7 'Microsoft YaHei UI','Microsoft YaHei',sans-serif}h1,h2,h3{line-height:1.4}section{margin:32px 0;padding:20px;border:1px solid #4c5e62;border-radius:10px}.columns{display:grid;grid-template-columns:1fr 1fr;gap:24px}article{min-width:0;overflow-wrap:anywhere;background:#263238;padding:20px}small,aside{color:#9fd0cf}img,video{max-width:100%;max-height:460px}audio{display:block;max-width:100%;margin:12px 0}pre{white-space:pre-wrap;background:#182025;padding:12px}details{border-left:2px solid #618d90;padding-left:14px;margin:18px 0}a{color:#9fd0cf}@media(max-width:900px){.columns{grid-template-columns:1fr}}</style><h1>第二轮复核 · 独立副本</h1><p>未导入正式库，未覆盖旧日记或第一轮候选。缺日期不猜日期，兜底时间注明推定；原文顺序保留，原折叠信息和媒体原件一起保存。</p>${panels}</html>`;
}

export async function runMessageUnitReview({
  sourceBatch,
  runDir,
  mediaDir,
  workspaceRoot = ROOT,
  expectedCount = 12,
}) {
  const base = path.join(path.resolve(workspaceRoot), 'var', 'message-unit-candidates');
  const source = path.resolve(sourceBatch || ''),
    target = path.resolve(runDir || '');
  if (
    !sourceBatch ||
    !runDir ||
    !inside(base, source) ||
    !inside(base, target) ||
    source === target ||
    inside(source, target)
  )
    throw Error('Explicit distinct private candidate batch paths are required');
  await noLinks(path.resolve(workspaceRoot), source);
  await noLinks(path.resolve(workspaceRoot), target);
  const before = await inventory(source);
  const algorithm = await algorithmIdentity();
  const manifest = await json(path.join(source, 'manifest.json'));
  const snapshot = await json(path.join(source, 'source-snapshot.json'));
  if (
    candidateHash(snapshot.library) !== manifest.sourceSha256 ||
    snapshot.sourceSha256 !== manifest.sourceSha256
  )
    throw Error('Frozen source snapshot mismatch');
  const rows = manifest.rows.filter((row) =>
    ['review', 'compatibility-review'].includes(row.status),
  );
  if (rows.length !== expectedCount)
    throw Error('Review count changed; inspect a new batch explicitly');
  const reportDir = path.join(
    path.resolve(workspaceRoot),
    'outputs',
    'message-unification',
    'legacy',
    path.basename(target),
  );
  await noLinks(path.resolve(workspaceRoot), reportDir);
  await fs.mkdir(target);
  await fs.mkdir(path.join(target, 'entries'));
  await fs.mkdir(path.join(target, 'media'));
  await fs.mkdir(reportDir);
  await write(path.join(target, 'algorithm.json'), algorithm);
  const reviewed = [],
    assets = [];
  for (const row of rows) {
    const payload = await json(path.join(source, 'entries', row.key + '.json'));
    const copy = cloneWithoutHash(payload);
    if (
      candidateHash(copy) !== payload.packageSha256 ||
      candidateHash(snapshot.library.entries[row.sourceIndex]) !== payload.source.sha256
    )
      throw Error('Frozen candidate package mismatch');
    const item = reviewMessageCandidate(payload, { media: snapshot.library.media });
    const repeated = reviewMessageCandidate(payload, { media: snapshot.library.media });
    if (candidateHash(item) !== candidateHash(repeated)) throw Error('Review repeat is unstable');
    item.checks.repeatStable = true;
    reviewed.push(item);
    await write(path.join(target, 'entries', row.key + '.json'), item);
    for (const value of item.original.attachments || []) {
      const id = typeof value === 'string' ? value : value.assetId || value.id;
      if (assets.some((asset) => asset.id === id)) continue;
      if (!mediaDir || !/^[a-f0-9-]+$/i.test(id))
        throw Error('Explicit original media directory and valid IDs required');
      const metadata = snapshot.library.media.find((asset) => asset.id === id);
      if (!metadata) throw Error('Original media metadata missing');
      const from = path.resolve(mediaDir, id);
      if (!inside(path.resolve(mediaDir), from) || (await fs.lstat(from)).isSymbolicLink())
        throw Error('Media path escaped original resource folder');
      const bytes = await fs.readFile(from),
        hash = sha(bytes);
      if (metadata.sha256 && metadata.sha256 !== hash)
        throw Error('Original media byte hash differs from metadata');
      const suffix =
        {
          'image/png': '.png',
          'image/jpeg': '.jpg',
          'image/webp': '.webp',
          'image/gif': '.gif',
          'audio/mpeg': '.mp3',
          'audio/mp4': '.m4a',
          'audio/ogg': '.ogg',
          'audio/wav': '.wav',
          'video/mp4': '.mp4',
          'video/webm': '.webm',
        }[metadata.type] || '.bin';
      const file = id + suffix,
        to = path.join(target, 'media', file);
      await fs.copyFile(from, to, constants.COPYFILE_EXCL);
      if (sha(await fs.readFile(to)) !== hash || sha(await fs.readFile(from)) !== hash)
        throw Error('Media byte preservation failed');
      assets.push({ id, file, type: metadata.type, size: bytes.length, sha256: hash });
    }
  }
  await fs.writeFile(
    path.join(target, 'comparison-offline.html'),
    offlineComparison(reviewed, assets),
    { flag: 'wx' },
  );
  const after = await inventory(source);
  if (candidateHash(before) !== candidateHash(after))
    throw Error('Frozen source batch changed during review');
  if ((await algorithmIdentity()).sha256 !== algorithm.sha256)
    throw Error('Review algorithm changed; retain this batch and run a new one');
  const counts = {};
  for (const item of reviewed) counts[item.status] = (counts[item.status] || 0) + 1;
  const report = {
    format: 'shiye-message-unit-second-review',
    version: 1,
    total: rows.length,
    statuses: counts,
    sourceBatchUnchanged: true,
    frozenFilesChecked: Object.keys(before).length,
    sourceSha256: manifest.sourceSha256,
    sourceInventorySha256: candidateHash(before),
    algorithmSha256: algorithm.sha256,
    noProductionWrites: true,
    noProcessControl: true,
    mediaCopied: assets.length,
    mediaBytesVerified: true,
    sourceWarningsRetained: true,
    checks: Object.fromEntries(
      Object.keys(reviewed[0].checks).map((key) => [
        key,
        reviewed.filter((item) => item.checks[key]).length,
      ]),
    ),
    rows: reviewed.map((item) => ({
      key: rows.find((row) => row.sourceIndex === item.source.index).key,
      sourceIndex: item.source.index,
      status: item.status,
      originalIssueCodes: item.originalIssueCodes,
      decisions: item.decisions.map((decision) => decision.code),
      checks: item.checks,
    })),
  };
  await write(path.join(target, 'manifest.json'), { ...report, assets, frozenFiles: before });
  await write(path.join(reportDir, 'report.json'), report);
  return { report, runDir: target, reportDir };
}
function cloneWithoutHash(value) {
  const copy = structuredClone(value);
  delete copy.packageSha256;
  return copy;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      if (
        !['--source-batch', '--run-dir', '--media-dir'].includes(process.argv[i]) ||
        !process.argv[i + 1]
      )
        throw Error('Explicit review arguments required');
      args[process.argv[i]] = process.argv[i + 1];
    }
    const result = await runMessageUnitReview({
      sourceBatch: args['--source-batch'],
      runDir: args['--run-dir'],
      mediaDir: args['--media-dir'],
    });
    console.log(
      JSON.stringify({
        total: result.report.total,
        statuses: result.report.statuses,
        sourceBatchUnchanged: result.report.sourceBatchUnchanged,
        mediaCopied: result.report.mediaCopied,
      }),
    );
  } catch (error) {
    console.error('Second review failed without production writes: ' + error.message);
    process.exitCode = 1;
  }
}
