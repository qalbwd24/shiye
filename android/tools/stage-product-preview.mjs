import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname, '../..');
const stage = path.join(root, 'tmp/android-product-017/assets');
const out = path.join(root, 'outputs/2026-10-18-android-product-017');
await fs.mkdir(out, { recursive: true });
const source = 'outputs/2026-10-18-android-qq-016/Shiye-Android-0.16.0-623f5665.apk';
execFileSync(
  'python',
  [
    '-c',
    `from pathlib import Path\nimport hashlib,zipfile\nr=Path(${JSON.stringify(root)});p=r/${JSON.stringify(source)};assert hashlib.sha256(p.read_bytes()).hexdigest()=='623f5665db8e9afeaf871ce0ab0e5aff4500390d5d568cf7daeb137919612752'\nt=(r/'tmp/android-product-017/assets').resolve()\nwith zipfile.ZipFile(p) as z:\n for n in z.namelist():\n  if n.startswith('assets/') and not n.endswith('/'):\n   q=(t/n[7:]).resolve();assert q.is_relative_to(t);q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(z.read(n))\n`,
  ],
  { cwd: root, windowsHide: true },
);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const options = {
  absWorkingDir: root,
  entryPoints: ['android/product-adapter/product-content.js'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'chrome110',
  write: false,
  metafile: true,
  legalComments: 'eof',
  outfile: 'product-content.js',
};
const discover = await build(options);
const files = Object.keys(discover.metafile.inputs);
const before = Object.fromEntries(
  await Promise.all(files.map(async (f) => [f, sha(await fs.readFile(path.join(root, f)))])),
);
const result = await build(options);
const sources = {};
for (const file of Object.keys(result.metafile.inputs)) {
  const data = await fs.readFile(path.join(root, file));
  if (sha(data) !== before[file]) throw Error('Shared source changed during freeze: ' + file);
  sources[file] = sha(data);
  const target = path.join(out, 'content-source', file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
}
const bytes = result.outputFiles[0].contents,
  hash = sha(bytes),
  name = 'product-content-' + hash.slice(0, 24) + '.js';
await fs.writeFile(path.join(stage, 'telegram', name), bytes);
await fs.copyFile(
  path.join(root, 'public/vendor/RICH-EDITOR-LICENSES.txt'),
  path.join(out, 'content-source/RICH-EDITOR-LICENSES.txt'),
);
await fs.writeFile(
  path.join(out, 'content-stage-manifest.json'),
  JSON.stringify(
    {
      sourceApk: source,
      sourceApkSha256: '623f5665db8e9afeaf871ce0ab0e5aff4500390d5d568cf7daeb137919612752',
      module: '/telegram/' + name,
      sha256: hash,
      bytes: bytes.length,
      sources,
      legacyEditorChanged: false,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ module: name, bytes: bytes.length, sourceFiles: files.length }));
