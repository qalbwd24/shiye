import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoReparse, fileSha256 } from '../../src/server/shared-sync/rollout-guard.mjs';

/** First publication only. Atomic no-replace link closes the absent-target race. */
export async function publishAbsentSharedConfig({ sourceFile, targetFile, sourceSha256 }) {
  await assertNoReparse(sourceFile);
  await assertNoReparse(path.dirname(targetFile));
  if ((await fileSha256(sourceFile)) !== sourceSha256) throw Error('SHARED_CONFIG_SOURCE_CHANGED');
  const bytes = await fs.readFile(sourceFile);
  const value = JSON.parse(bytes.toString('utf8'));
  if (
    value.enabled !== true ||
    value.remote !== false ||
    value.listenHost !== '127.0.0.1' ||
    !path.isAbsolute(value.sourceCollection?.exportsDir || '') ||
    Object.keys(value).sort().join(',') !== 'enabled,listenHost,remote,sourceCollection' ||
    Object.keys(value.sourceCollection).join(',') !== 'exportsDir'
  )
    throw Error('SHARED_CONFIG_INVALID');
  const temporary = path.join(path.dirname(targetFile), '.shared-config-' + randomUUID() + '.json');
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    // Both paths are in the same target directory/volume. EEXIST is a hard abort;
    // never rename-over an unexpected concurrent configuration.
    await fs.link(temporary, targetFile);
  } finally {
    await fs.unlink(temporary);
  }
  if ((await fileSha256(targetFile)) !== sourceSha256)
    throw Error('SHARED_CONFIG_PUBLISHED_CHANGED');
  return { version: 1, expectedAbsent: true, atomicNoReplace: true, sha256: sourceSha256 };
}
