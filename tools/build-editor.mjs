import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { APP_ROOT } from '../src/server/config.mjs';

await build({
  entryPoints: [path.join(APP_ROOT, 'tools/editor-vendor-entry.mjs')],
  outfile: path.join(APP_ROOT, 'public/vendor/codemirror.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
});
await build({
  stdin: { contents: "export {default} from 'turndown';", resolveDir: APP_ROOT },
  outfile: path.join(APP_ROOT, 'public/vendor/turndown.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
});
const lock = JSON.parse(await fs.readFile(path.join(APP_ROOT, 'package-lock.json'), 'utf8'));
const records = [];
for (const [relative, item] of Object.entries(lock.packages)) {
  if (
    !/^node_modules\/(?:@codemirror\/|@lezer\/|style-mod$|w3c-keyname$|crelt$|turndown$|@mixmark-io\/domino$)/.test(
      relative,
    )
  )
    continue;
  const dir = path.join(APP_ROOT, relative);
  const license = (await fs.readdir(dir)).find((name) => /^licen[sc]e(?:\.|$)/i.test(name));
  records.push(
    `## ${relative.slice(13)} ${item.version}\n\n${license ? await fs.readFile(path.join(dir, license), 'utf8') : 'See package metadata: ' + item.license}`,
  );
}
await fs.writeFile(
  path.join(APP_ROOT, 'public/vendor/EDITOR-LICENSES.txt'),
  records.join('\n\n'),
  'utf8',
);
console.log('Built offline CodeMirror and Turndown bundles and license notices.');
