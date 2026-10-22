import { promises as fs, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { APP_ROOT, VERSION } from '../src/server/config.mjs';

/** Copies an explicit source allowlist. No library, user backup, log, or dependency directory. */
const roots = [
  'server.mjs',
  'package.json',
  'package-lock.json',
  'README.md',
  'AGENTS.md',
  'CHANGELOG.md',
  '.gitignore',
  '.editorconfig',
  '.prettierrc.json',
  '.prettierignore',
  'eslint.config.mjs',
  'config',
  'src',
  'public',
  'desktop',
  'resources',
  'tools',
  'tests',
  'docs',
];
const destination = path.join(APP_ROOT, 'var', 'packages', `shiye-source-${VERSION}-${Date.now()}`),
  files = [];
async function copy(relative) {
  if (relative.replaceAll('\\', '/') === 'config/deployment.local.json') return;
  const source = path.join(APP_ROOT, relative),
    stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) throw Error('Source package contains symlink: ' + relative);
  if (stat.isDirectory()) {
    for (const name of await fs.readdir(source)) {
      if (['archive', 'ui-test-data', 'node_modules', 'data', 'var', 'build'].includes(name))
        continue;
      await copy(path.join(relative, name));
    }
    return;
  }
  const out = path.join(destination, relative);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.copyFile(source, out);
  const hash = createHash('sha256');
  for await (const b of createReadStream(out)) hash.update(b);
  files.push({
    path: relative.replaceAll('\\', '/'),
    bytes: stat.size,
    sha256: hash.digest('hex'),
  });
}
for (const item of roots) await copy(item);
await fs.writeFile(
  path.join(destination, 'SOURCE-MANIFEST.json'),
  JSON.stringify({ version: VERSION, files }, null, 2),
  'utf8',
);
console.log(
  JSON.stringify(
    { directory: destination, files: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0) },
    null,
    2,
  ),
);
