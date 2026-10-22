import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = await build({
  entryPoints: [path.join(root, 'tools/rich-editor-vendor-entry.mjs')],
  outfile: path.join(root, 'public/vendor/rich-editor.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
  metafile: true,
});
const dirs = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const parts = input.replaceAll('\\', '/').match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)/);
  if (parts) dirs.add(parts[1]);
}
const notices = [];
for (const dir of [...dirs].sort()) {
  const absolute = path.resolve(root, dir);
  const pkg = JSON.parse(await fs.readFile(path.join(absolute, 'package.json'), 'utf8'));
  const license = (await fs.readdir(absolute)).find((name) => /^licen[sc]e(?:\.|$)/i.test(name));
  notices.push(
    `## ${pkg.name} ${pkg.version} (${pkg.license})\n\n${license ? await fs.readFile(path.join(absolute, license), 'utf8') : 'License stated in package metadata.'}`,
  );
}
await fs.writeFile(path.join(root, 'public/vendor/RICH-EDITOR-LICENSES.txt'), notices.join('\n\n'));
console.log(`Built offline rich editor; ${dirs.size} dependency notices.`);
