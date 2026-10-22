import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stage = path.resolve(process.argv[2] || '');
const boundary = path.join(root, 'tmp') + path.sep;
if (
  !stage.toLowerCase().startsWith(boundary.toLowerCase()) ||
  /android-ui-continuation[\\/]stage/i.test(stage)
)
  throw new Error('Explicit isolated tmp stage required; UI022 stage is protected');
const target = path.join(stage, 'assets/telegram/qq-chat');
await fs.mkdir(target, { recursive: true });
const bundle = await build({
  entryPoints: [path.join(root, 'android/qq-chat/shared-runtime.js')],
  outfile: path.join(target, 'shared-runtime.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome100'],
  metafile: true,
});
await fs.copyFile(
  path.join(root, 'android/qq-chat/shared-directory-view.js'),
  path.join(target, 'shared-directory-view.js'),
);
await fs.copyFile(path.join(root, 'android/qq-chat/install.js'), path.join(target, 'install.js'));
await fs.copyFile(
  path.join(root, 'android/telegram-adapter/android-chat.js'),
  path.join(target, '../android-chat.js'),
);
await fs.writeFile(
  path.join(stage, 'shared-runtime-bundle.json'),
  JSON.stringify(
    {
      source: 'android/qq-chat/shared-runtime.js',
      includesPublicDependencies: true,
      overlayOnly: true,
      retainedAssetsRequired: true,
      inputs: Object.keys(bundle.metafile.inputs),
    },
    null,
    2,
  ),
);
console.log(target);
