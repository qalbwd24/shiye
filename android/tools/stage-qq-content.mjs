import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname, '../..'),
  out = path.join(root, 'outputs/2026-10-18-android-qq-018/content'),
  stage = path.join(root, 'tmp/android-qq-018/qq-content');
await fs.mkdir(out, { recursive: true });
await fs.mkdir(stage, { recursive: true });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const journalPath = 'previews/telegram-chat/shiye-journal.js',
  journal = await fs.readFile(path.join(root, journalPath), 'utf8');
const start = journal.indexOf('  function formatText(message) {'),
  end = journal.indexOf('\n  async function sync()', start);
if (start < 0 || end < 0) throw Error('Desktop entity format seam changed; review required');
const helper = journal.slice(start, end).trim();
if (!helper.endsWith('}')) throw Error('Invalid formatter seam');
const bundle = await build({
  absWorkingDir: root,
  entryPoints: ['android/qq-chat/content.js'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'chrome110',
  write: false,
  metafile: true,
  legalComments: 'eof',
  outfile: 'content.js',
  plugins: [
    {
      name: 'desktop-legacy-format',
      setup(b) {
        b.onResolve({ filter: /^shiye:desktop-legacy-format$/ }, () => ({
          path: 'desktop-legacy-format',
          namespace: 'shared',
        }));
        b.onLoad({ filter: /.*/, namespace: 'shared' }, () => ({
          contents: 'export ' + helper,
          loader: 'js',
        }));
      },
    },
  ],
});
const sources = {};
for (const p of Object.keys(bundle.metafile.inputs)) {
  if (p.startsWith('shared:')) continue;
  const bytes = await fs.readFile(path.join(root, p));
  sources[p] = sha(bytes);
  const target = path.join(out, 'source', p);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
}
sources[journalPath] = sha(await fs.readFile(path.join(root, journalPath)));
const bytes = bundle.outputFiles[0].contents;
await fs.writeFile(path.join(stage, 'content.js'), bytes);
await fs.writeFile(
  path.join(out, 'stage-manifest.json'),
  JSON.stringify(
    {
      sha256: sha(bytes),
      bytes: bytes.length,
      sources,
      legacyFormatterFunctionSha256: sha(helper),
      desktopRenderersReused: true,
      readProjectionOnly: true,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ contentBytes: bytes.length, sources: Object.keys(sources).length }));
