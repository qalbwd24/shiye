import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';
const exec = promisify(execFile),
  id = randomUUID();
const work = path.resolve('tmp/shared-seed-native-host', id);
const output = path.resolve('outputs/2026-10-19-shared-business-integration', `native-seed-${id}`);
await fs.mkdir(work, { recursive: true });
await fs.mkdir(output, { recursive: true });
const jar = path.resolve('tmp/shared-business-native-host/deps/json-20240303.jar');
assert.equal(
  createHash('sha256')
    .update(await fs.readFile(jar))
    .digest('hex'),
  '3cf6cd6892e32e2b4c1c39e0f52f5248a2f5b37646fdfbb79a66b46b618414ed',
);
const javaHome = process.env.JAVA_HOME || 'D:/codex-tools/android-studio/jbr';
const sources = ['SharedSeedFile', 'SharedSeedBridge']
  .map((name) => `android/app/src/main/java/dev/shiye/app/${name}.java`)
  .concat('android/sync-tests/SharedSeedHostProbe.java');
const classes = path.join(work, 'classes');
await fs.mkdir(classes);
const compile = await exec(path.join(javaHome, 'bin/javac.exe'), [
  '-encoding',
  'UTF-8',
  '-cp',
  jar,
  '-d',
  classes,
  ...sources,
]);
await fs.writeFile(path.join(output, 'build.log'), compile.stdout + compile.stderr);
const run = await exec(path.join(javaHome, 'bin/java.exe'), [
  '-cp',
  classes + path.delimiter + jar,
  'dev.shiye.app.SharedSeedHostProbe',
  path.join(work, 'fixture'),
  path.join(output, 'summary.json'),
]);
await fs.writeFile(path.join(output, 'run.log'), run.stdout + run.stderr);
await fs.writeFile(
  path.join(output, 'sources.json'),
  JSON.stringify(
    await Promise.all(
      sources.map(async (file) => ({
        file,
        sha256: createHash('sha256')
          .update(await fs.readFile(file))
          .digest('hex'),
      })),
    ),
    null,
    2,
  ),
);
console.log(run.stdout.trim() + '; ' + output);
