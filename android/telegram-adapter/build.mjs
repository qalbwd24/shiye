import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const adapter = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(adapter, '../..');
const source = path.join(
  root,
  'outputs/desktop-maintenance/releases/2026-10-17T18-38-43-932Z-3b4b2c77',
);
const sourceApp = path.join(source, 'app');
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--'))
    throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
};
const within = (base, value) => {
  const resolved = path.resolve(root, value),
    boundary = path.resolve(root, base) + path.sep;
  if (!resolved.toLowerCase().startsWith(boundary.toLowerCase()))
    throw new Error(`Output must remain under ${boundary}`);
  return resolved;
};
const work = within('tmp', argument('--work-dir', 'tmp/android-frontend-v2/telegram-build'));
const target = path.join(work, 'assets/telegram');
const output = within(
  'outputs',
  argument('--output-dir', 'outputs/2026-10-17-android-frontend-v2/telegram'),
);
const corresponding = path.join(output, 'corresponding-source');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const origin = 'https://appassets.androidplatform.net';
const storageDescription =
  'chat messages: isolated IndexedDB shiye-android-telegram-v2; UI pins: native load/commit authority; old IDB preference key is migration-only; no SQLite message synchronization or desktop diary/API bridge';
const attachmentModulePath = 'assets/useConnectionStatus-Dy1kHT8L.js';
const adapterFiles = [
  'android-network-guard.js',
  'android-chat.js',
  'android-chat.css',
  'android-stickers.js',
  'android-sticker-transport.js',
  'android-sticker-suggestions.js',
  'android-sticker-suggestions.css',
  'android-sticker-panel.js',
  'android-sticker-panel.css',
  'android-qq-skin.js',
  'android-qq-skin.css',
  'android-qq-gestures.js',
];
const sharedInputFiles = [
  'shiye-local-assets.js',
  'shiye-input.js',
  'shiye-stickers.js',
  'shiye-media-drop.js',
];
function versionAttachmentImports(html, moduleBytes, extra = new Map()) {
  const maps = [...html.matchAll(/<script\b[^>]*type="importmap"[^>]*>[\s\S]*?<\/script>/g)];
  const ownedMap =
    /<script type="importmap" data-shiye-attachment-version="1">([\s\S]*?)<\/script>\r?\n?/g;
  const previous = [...html.matchAll(ownedMap)];
  const policies = [
    ...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/g),
  ];
  const scriptSource = "script-src 'self' 'wasm-unsafe-eval'";
  if (
    html.split('<head>').length !== 2 ||
    policies.length !== 1 ||
    !/<script src="\.\/android-network-guard\.js(?:\?v=[a-f0-9]+)?"><\/script>/.test(html) ||
    policies[0][1].split(scriptSource).length !== 2 ||
    maps.length !== previous.length ||
    previous.length > 1
  )
    throw new Error(
      'Android index/import-map seam changed; remove --adapter-only and run a full audited build',
    );
  let policy = policies[0][1];
  for (const old of previous) {
    const oldHash = createHash('sha256').update(old[1]).digest('base64');
    policy = policy.replace(` 'sha256-${oldHash}'`, '');
  }
  const version = hash(moduleBytes).slice(0, 24);
  const moduleUrl = `/telegram/${attachmentModulePath}`;
  const imports = { [moduleUrl]: `${moduleUrl}?v=${version}` };
  for (const [name, bytes] of extra) {
    const url = `/telegram/${name}`;
    imports[url] = `${url}?v=${hash(bytes).slice(0, 24)}`;
  }
  const map = JSON.stringify({ imports });
  const cspHash = createHash('sha256').update(map).digest('base64');
  policy = policy.replace(scriptSource, `${scriptSource} 'sha256-${cspHash}'`);
  html = html
    .replace(policies[0][0], `<meta http-equiv="Content-Security-Policy" content="${policy}">`)
    .replace(ownedMap, '')
    .replace(
      '<head>',
      `<head>\n<script type="importmap" data-shiye-attachment-version="1">${map}</script>`,
    );
  // CSP must precede its import map; the complete pair still precedes every module/preload.
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  html = html.replace(meta, '').replace('<head>', `<head>${meta}`);
  // Classic script and stylesheet fetches do not consult import maps.
  html = html.replace(/(src|href)="\.\/([^"?]+)(?:\?v=[a-f0-9]+)?"/g, (all, attr, name) =>
    extra.has(name) ? `${attr}="./${name}?v=${hash(extra.get(name)).slice(0, 24)}"` : all,
  );
  return { html, version, moduleUrl, cspHash };
}
async function installAdapterAssets(files) {
  for (const name of adapterFiles) {
    const bytes = await fs.readFile(path.join(adapter, name));
    await fs.writeFile(path.join(target, name), bytes);
    const entry = {
      file: name,
      size: bytes.length,
      sha256: hash(bytes),
      source: `android/telegram-adapter/${name}`,
    };
    const index = files.findIndex((item) => item.file === name);
    if (index >= 0) files[index] = entry;
    else files.push(entry);
  }
  const name = 'shared/sticker-suggestions.js';
  const bytes = await fs.readFile(path.join(root, 'public/shared/sticker-suggestions.js'));
  await fs.mkdir(path.join(target, 'shared'), { recursive: true });
  await fs.writeFile(path.join(target, name), bytes);
  const entry = {
    file: name,
    size: bytes.length,
    sha256: hash(bytes),
    source: 'public/shared/sticker-suggestions.js',
  };
  const index = files.findIndex((item) => item.file === name);
  if (index >= 0) files[index] = entry;
  else files.push(entry);
}
async function versionAndroidAssets(html, moduleBytes) {
  const extra = new Map();
  for (const name of [...adapterFiles, ...sharedInputFiles, 'shared/sticker-suggestions.js'])
    extra.set(name, await fs.readFile(path.join(target, name)));
  html = html.replace(
    /<(?:script|link)\b[^>]*data-shiye-media-entry="1"[^>]*>(?:<\/script>)?/g,
    '',
  );
  html = html
    .replace(
      '</head>',
      '<link data-shiye-media-entry="1" rel="stylesheet" href="./android-sticker-suggestions.css"><link data-shiye-media-entry="1" rel="stylesheet" href="./android-sticker-panel.css"><link data-shiye-media-entry="1" rel="stylesheet" href="./android-qq-skin.css"></head>',
    )
    .replace(
      '</body>',
      '<script data-shiye-media-entry="1" type="module" src="./android-sticker-transport.js"></script><script data-shiye-media-entry="1" type="module" src="./android-sticker-suggestions.js"></script></body>',
    );
  return versionAttachmentImports(html, moduleBytes, extra);
}
async function installFrozenLocalInput(files) {
  const references = [];
  const destination = path.join(corresponding, 'frozen-local-input');
  await fs.mkdir(destination, { recursive: true });
  for (const file of sharedInputFiles) {
    const original = await fs.readFile(path.join(root, 'previews/telegram-chat', file));
    let bytes = original;
    if (file === 'shiye-input.js') {
      let text = original.toString('utf8');
      const anchor = 'function makeDialog(title, html) {';
      if (!text.includes(anchor)) throw new Error('Frozen local-input dialog seam changed');
      text = text
        .replace(
          anchor,
          `${anchor}\n    if (['输入与快捷命令', '自定义 / 表情映射'].includes(title))\n      return window.shiyeSettingsUi.open({ page: title, title, content: html });`,
        )
        .replace(
          /    const back = document.createElement\('button'\);[\s\S]*?    element.querySelector\('header'\).prepend\(back\);\r?\n/,
          '',
        )
        .replace(
          /      element\.close\(\);\r?\n      openMappingManager\(\);/,
          '      openMappingManager();',
        )
        .replace(
          /(const element = makeDialog\([\s\S]*?\r?\n    \);)/g,
          "$1\n    if (element.dataset.settingsRestored === 'true') return;",
        )
        .replace('<p>机器人和服务命令在后续接入后配置。</p>', '');
      bytes = Buffer.from(text);
    }
    await fs.writeFile(path.join(target, file), bytes);
    await fs.writeFile(path.join(destination, file), original);
    const entry = { file, sha256: hash(bytes), sourceSha256: hash(original), size: bytes.length };
    const index = files.findIndex((item) => item.file === file);
    if (index >= 0) files[index] = entry;
    else files.push(entry);
    references.push({
      ...entry,
      source: path
        .relative(root, path.join(root, 'previews/telegram-chat', file))
        .replaceAll('\\', '/'),
    });
  }
  return references;
}
if (process.argv.includes('--adapter-only')) {
  // Wrapper-only refresh cannot apply frozen vendor transformations. Validate
  // before any asset/source/manifest write so an old package cannot look current.
  let attachmentModule;
  try {
    attachmentModule = await fs.readFile(path.join(target, attachmentModulePath), 'utf8');
  } catch {
    throw new Error(
      'Frozen sticker attachment module missing; remove --adapter-only and run a full build',
    );
  }
  const requiredSeams = [
    'quality:t.shiyeOriginalSticker?`original`:localStorage.getItem(`shiye-image-quality`)||`original`',
    'export { em as shiyePrepareAttachment, tm as shiyePrepareAttachmentsToSend };',
  ];
  if (requiredSeams.some((seam) => attachmentModule.split(seam).length !== 2))
    throw new Error(
      'Frozen sticker attachment module is outdated; remove --adapter-only and run a full build',
    );
  const manifestPath = path.join(output, 'build-manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const indexEntry = manifest.files.find((item) => item.file === 'index.html');
  if (!indexEntry)
    throw new Error('Android index manifest missing; remove --adapter-only and run a full build');
  const indexHtml = await fs.readFile(path.join(target, 'index.html'), 'utf8');
  versionAttachmentImports(indexHtml, Buffer.from(attachmentModule));
  // Preflight every new source before refreshing an existing package.
  for (const name of adapterFiles) await fs.access(path.join(adapter, name));
  for (const name of sharedInputFiles)
    await fs.access(path.join(root, 'previews/telegram-chat', name));
  await fs.access(path.join(root, 'public/shared/sticker-suggestions.js'));
  manifest.reusedLocalInput = await installFrozenLocalInput(manifest.files);
  await installAdapterAssets(manifest.files);
  const mappedIndex = await versionAndroidAssets(indexHtml, Buffer.from(attachmentModule));
  const indexBytes = Buffer.from(mappedIndex.html);
  manifest.storage = storageDescription;
  manifest.assets = path.relative(root, path.dirname(target)).replaceAll('\\', '/');
  manifest.target = path.relative(root, target).replaceAll('\\', '/');
  await fs.writeFile(path.join(target, 'index.html'), indexBytes);
  indexEntry.sha256 = hash(indexBytes);
  indexEntry.size = indexBytes.length;
  const indexTransformation = manifest.transformations?.find((item) => item.file === 'index.html');
  if (indexTransformation) indexTransformation.targetSha256 = indexEntry.sha256;
  manifest.attachmentImportVersion = mappedIndex.version;
  for (const name of ['Telegram-Web-A-LICENSE.txt', 'THIRD-PARTY-LICENSES.txt']) {
    const bytes = await fs.readFile(path.join(target, name));
    const item = manifest.files.find((item) => item.file === name);
    if (item) {
      item.sha256 = hash(bytes);
      item.size = bytes.length;
    } else manifest.files.push({ file: name, sha256: hash(bytes), size: bytes.length });
  }
  await fs.mkdir(path.join(corresponding, 'android-adapter'), { recursive: true });
  for (const name of await fs.readdir(adapter))
    await fs.copyFile(path.join(adapter, name), path.join(corresponding, 'android-adapter', name));
  manifest.atUtc = new Date().toISOString();
  manifest.totalBytes = manifest.files.reduce((sum, f) => sum + f.size, 0);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ adapterOnly: true, atUtc: manifest.atUtc, target }));
  process.exit(0);
}
const drop = new Set([
  'build-stats.json',
  'statoscope-report.html',
  'shiye-preview.js',
  'shiye-preview.css',
  'shiye-chat-ui.js',
  'shiye-ime.js',
  'shiye-room-workspace.js',
  'shiye-journal.js',
  'shiye-image-viewer.html',
  'shiye-image-viewer.js',
  'shiye-network-guard.js',
]);
await fs.mkdir(target, { recursive: true });
await fs.mkdir(corresponding, { recursive: true });
const guard = await fs.readFile(path.join(adapter, 'android-network-guard.js'), 'utf8');
const files = [],
  transformations = [],
  sourceMaps = [];
async function copyDirectory(from, relative = '') {
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name),
      input = path.join(from, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(input, name);
      continue;
    }
    if (drop.has(name) || name.startsWith('get/') || name.startsWith('shiye-revisit')) continue;
    const original = await fs.readFile(input);
    if (name.endsWith('.map')) {
      const to = path.join(corresponding, 'source-maps', name);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.writeFile(to, original);
      sourceMaps.push({ file: name, sha256: hash(original) });
      continue;
    }
    let bytes = original;
    if (/\.(js|html|webmanifest|json|css)$/.test(name)) {
      let text = original.toString('utf8');
      text = text
        .replaceAll('https://shiye-preview.local', `${origin}`)
        .replaceAll('shiye-telegram-preview-v1', 'shiye-android-telegram-v2')
        .replaceAll('//# sourceMappingURL=', '// source map retained in corresponding-source: ');
      // Current shared sticker input marks its original File. Teach only the
      // audited frozen attachment builder that flag; do not import a moving vendor build.
      if (name === 'assets/useConnectionStatus-Dy1kHT8L.js') {
        const anchor = 'quality:localStorage.getItem(`shiye-image-quality`)||`original`';
        if (
          text.split(anchor).length !== 2 ||
          !text.includes('async function Qp(e,t,n){if(ds.has(t.type)')
        )
          throw new Error('Frozen original-sticker attachment seam changed; re-audit');
        text = text.replace(
          anchor,
          'quality:t.shiyeOriginalSticker?`original`:localStorage.getItem(`shiye-image-quality`)||`original`',
        );
        // Expose the existing frozen attachment preparation only to Android's
        // local sticker editor hook. Ordinary picker files still open confirmation.
        const preparationAnchor = 'function tm(e,t){return e.map(';
        if (
          text.split('async function em(e){if(!e.isPreparing)return e;').length !== 2 ||
          text.split(preparationAnchor).length !== 2
        )
          throw new Error('Frozen direct-sticker preparation seam changed; re-audit');
        text += '\nexport { em as shiyePrepareAttachment, tm as shiyePrepareAttachmentsToSend };\n';
      }
      if (name.includes('worker') && name.endsWith('.js') && !name.includes('/'))
        text = `${guard}\n${text}`;
      if (name === 'index.html') {
        text = text
          .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/gi, '')
          .replace(/<script[^>]*src="\.\/shiye-[^"]*"[^>]*><\/script>/g, '')
          .replace(/<link[^>]*href="\.\/shiye-preview\.css[^"]*"[^>]*>/g, '')
          .replace(/<script type="importmap">[\s\S]*?<\/script>/g, '')
          .replace(/<link rel="(?:canonical|manifest)"[^>]*>/g, '')
          .replace(
            '<head>',
            `<head>\n<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' blob: data:; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; media-src 'self' blob: data:; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'">\n<script src="./android-network-guard.js"></script>`,
          )
          .replace('</head>', '<link rel="stylesheet" href="./android-chat.css"></head>')
          .replace('</body>', '<script src="./android-chat.js"></script></body>');
        // Final Android import mapping is added after the attachment transformation
        // below. APK upgrades reuse the same WebView origin, service worker and IDB.
      }
      bytes = Buffer.from(text);
      if (!bytes.equals(original))
        transformations.push({
          file: name,
          sourceSha256: hash(original),
          targetSha256: hash(bytes),
        });
    }
    const destination = path.join(target, name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes);
    files.push({
      file: name,
      size: bytes.length,
      sourceSha256: hash(original),
      sha256: hash(bytes),
    });
  }
}
await copyDirectory(sourceApp);
const reusedLocalInput = await installFrozenLocalInput(files);
await installAdapterAssets(files);
const mappedIndex = await versionAndroidAssets(
  await fs.readFile(path.join(target, 'index.html'), 'utf8'),
  await fs.readFile(path.join(target, attachmentModulePath)),
);
const indexBytes = Buffer.from(mappedIndex.html);
await fs.writeFile(path.join(target, 'index.html'), indexBytes);
Object.assign(
  files.find((item) => item.file === 'index.html'),
  { size: indexBytes.length, sha256: hash(indexBytes) },
);
transformations.find((item) => item.file === 'index.html').targetSha256 = hash(indexBytes);
await fs.copyFile(
  path.join(source, 'Telegram-Web-A-LICENSE'),
  path.join(target, 'Telegram-Web-A-LICENSE.txt'),
);
await fs.copyFile(
  path.join(source, 'UPSTREAM.json'),
  path.join(corresponding, 'UPSTREAM-ui18.json'),
);
const vendor = path.join(root, 'previews/telegram-chat/vendor/web-a');
for (const name of ['package.json', 'package-lock.json', 'LICENSE'])
  await fs.copyFile(path.join(vendor, name), path.join(corresponding, name));
let notices =
  'Telegram Web A 12.0.46, GPL-3.0-or-later\nUpstream https://github.com/Ajaxy/telegram-tt\nCommit 090e38f1dffec3e0a9aefbec8159a9931fbeec8f\nModified local client by Shiye; Android adapter source: android/telegram-adapter.\n\nThis APK includes the complete GPLv3 text. Corresponding frozen source maps, upstream original archive reference, dependency manifests and Android adapter are supplied beside the APK in the project outputs. The following package notices cover the installed dependency graph; inclusion does not imply every package is used at runtime.\n';
const licenseFiles = [];
async function packages(nodeModules) {
  for (const entry of await fs.readdir(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      await packages(path.join(nodeModules, entry.name));
      continue;
    }
    const dir = path.join(nodeModules, entry.name);
    let pkg;
    try {
      pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    const texts = [];
    for (const name of await fs.readdir(dir))
      if (/^(licen[sc]e|copying|notice|copyright)([.\-_]|$)/i.test(name)) {
        const input = path.join(dir, name);
        if (!(await fs.stat(input)).isFile()) continue;
        const bytes = await fs.readFile(input);
        texts.push(`\n--- ${name} ---\n${bytes.toString('utf8')}`);
        licenseFiles.push({
          package: pkg.name,
          version: pkg.version,
          file: path.relative(vendor, input).replaceAll('\\', '/'),
          sha256: hash(bytes),
        });
      }
    notices += `\n\n===== ${pkg.name}@${pkg.version} | ${JSON.stringify(pkg.license || pkg.licenses || 'see package')} =====\n${texts.length ? texts.join('\n') : 'No root license text in installed package; inspect original package distribution.'}\n`;
    try {
      await packages(path.join(dir, 'node_modules'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
}
await packages(path.join(vendor, 'node_modules'));
await fs.writeFile(path.join(target, 'THIRD-PARTY-LICENSES.txt'), notices);
await fs.writeFile(
  path.join(output, 'dependency-license-manifest.json'),
  JSON.stringify(licenseFiles, null, 2),
);
await fs.writeFile(
  path.join(corresponding, 'README.txt'),
  'Frozen ui18 compiled assets are reused without rebuilding parallel source candidates. Source-map files include the exact sourcesContent used by the frozen build. Original unmodified upstream archive: resources/vendor/telegram-sources/telegram-web-a-090e38f1.zip; SHA-256 f24c2b46ac8ba5e9366a11114d9d2e7108b4587e31599738f6f19574fa80c47c. Apply the inspectable transformations in android/telegram-adapter/build.mjs. Current vendor package manifests and full dependency license texts are included for dependency identification; current worktree is not claimed as the frozen ui18 source. Desktop wrappers are excluded.\n',
);
const result = {
  atUtc: new Date().toISOString(),
  source: path.relative(root, source).replaceAll('\\', '/'),
  sourceManifestSha256: hash(await fs.readFile(path.join(source, 'manifest.json'))),
  origin,
  entry: `${origin}/telegram/index.html`,
  assets: path.relative(root, path.dirname(target)).replaceAll('\\', '/'),
  target: path.relative(root, target).replaceAll('\\', '/'),
  storage: storageDescription,
  attachmentImportVersion: mappedIndex.version,
  telegramAccount: false,
  files,
  transformations,
  sourceMaps,
  reusedLocalInput,
  totalBytes: files.reduce((sum, f) => sum + f.size, 0),
  licenseTextSha256: hash(Buffer.from(notices)),
};
await fs.writeFile(path.join(output, 'build-manifest.json'), JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    entry: result.entry,
    target: result.target,
    files: files.length,
    bytes: result.totalBytes,
    transformed: transformations.length,
    sourceMaps: sourceMaps.length,
    licenseFiles: licenseFiles.length,
  }),
);
