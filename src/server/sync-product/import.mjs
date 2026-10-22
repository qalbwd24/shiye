import { createReadStream } from 'node:fs';
import { readFile, open, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { planLegacyProductImport } from './legacy-adapter.mjs';

/** Explicit one-time read-only seed; reruns resume originals but never overwrite later edits. */
export async function seedProductLibrary(service, { libraryFile, mediaDir, sourceId } = {}) {
  if (!path.isAbsolute(libraryFile || '') || !path.isAbsolute(mediaDir || ''))
    throw Object.assign(new Error('EXPLICIT_SOURCE_REQUIRED'), {
      code: 'EXPLICIT_SOURCE_REQUIRED',
    });
  sourceId ||= service.store.info().libraryId;
  const stateKey = `seed:${sourceId}`;
  let state = service.store.readProductState(stateKey);
  if (!state?.imported) {
    const bytes = await readFile(libraryFile);
    const library = JSON.parse(bytes.toString('utf8'));
    const plan = planLegacyProductImport(library, { sourceId });
    const report = await service.extension.importPlan(plan);
    await service.extension.importRuntime(library.revisit);
    state = {
      imported: true,
      sourceSha256: createHash('sha256').update(bytes).digest('hex'),
      sourceId,
      counts: plan.counts,
      issues: report.issues,
      taxonomyIdentity: plan.taxonomyIdentity,
      coverage: plan.coverage,
      assets: library.media.map(({ id, type, name, size, sha256 }) => ({
        id,
        type,
        name,
        size,
        ...(sha256 ? { sha256 } : {}),
      })),
    };
    service.store.push('product-server', [], {
      atomic: true,
      productState: { key: stateKey, value: state },
    });
  }
  const report = {
    imported: true,
    counts: state.counts,
    issues: state.issues,
    coverage: state.coverage || {
      version: 1,
      completeComputerExport: false,
      reason: 'legacy-seed-without-coverage',
    },
    originals: 0,
    failures: [],
  };
  for (const item of state.assets) {
    try {
      try {
        await service.media.getAsset(item.id);
        report.originals++;
        continue;
      } catch (error) {
        if (error.statusCode !== 404 && error.status !== 404) throw error;
      }
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(item.id)) throw new Error('INVALID_ASSET_ID');
      const file = path.join(mediaDir, item.id);
      const info = await stat(file);
      const hash = createHash('sha256');
      for await (const bytes of createReadStream(file)) hash.update(bytes);
      const sha256 = hash.digest('hex');
      if (
        item.sha256 &&
        /^[a-f0-9]{64}$/i.test(item.sha256) &&
        item.sha256.toLowerCase() !== sha256
      )
        throw new Error('SOURCE_HASH_MISMATCH');
      if (Number.isSafeInteger(item.size) && item.size !== info.size)
        throw new Error('SOURCE_SIZE_MISMATCH');
      const upload = await service.media.begin({
        assetId: item.id,
        sha256,
        size: info.size,
        mime: item.type || 'application/octet-stream',
        name: item.name || '',
      });
      const handle = await open(file, 'r');
      try {
        for (const index of upload.missingChunks) {
          const bytes = Buffer.alloc(
            Math.min(upload.chunkSize, info.size - index * upload.chunkSize),
          );
          const { bytesRead } = await handle.read(bytes, 0, bytes.length, index * upload.chunkSize);
          if (bytesRead !== bytes.length) throw new Error('SOURCE_CHANGED_DURING_READ');
          await service.media.putChunk(upload.uploadId, index, bytes);
        }
      } finally {
        await handle.close();
      }
      await service.media.complete(upload.uploadId);
      await service.publishPending();
      report.originals++;
    } catch (error) {
      report.failures.push({
        id: item.id,
        code: /^[A-Z0-9_-]+$/i.test(error.code || error.message || '')
          ? error.code || error.message
          : 'ORIGINAL_UNAVAILABLE',
      });
    }
  }
  return report;
}
