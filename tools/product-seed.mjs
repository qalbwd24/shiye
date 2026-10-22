import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createProductSeedClient } from '../public/shared/product-seed-client.js';
import { readSeedPackage, seedFileHash } from '../src/server/sync-product/seed-package.mjs';

const [command, ...args] = process.argv.slice(2),
  options = {};
for (let i = 0; i < args.length; i += 2) {
  if (
    !['--server', '--token-file', '--file', '--work-dir', '--operation-id', '--scope'].includes(
      args[i],
    ) ||
    !args[i + 1]
  )
    throw Error('INVALID_SEED_ARGUMENT');
  options[args[i]] = args[i + 1];
}
if (options['--scope'] && !['library', 'computer'].includes(options['--scope']))
  throw Error('INVALID_EXPORT_SCOPE');
async function wait(client, kind, job) {
  for (;;) {
    job = await client[kind === 'export' ? 'exportStatus' : 'importStatus'](job.id);
    if (['failed', 'interrupted', 'revoked'].includes(job.status))
      throw Error(job.error || 'SEED_JOB_INTERRUPTED');
    if (['ready', 'committed'].includes(job.status)) return job;
    await delay(300);
  }
}
try {
  if (
    !['export', 'initialize-empty', 'inspect'].includes(command) ||
    !path.isAbsolute(options['--file'] || '')
  )
    throw Error(
      'Usage: product-seed export|initialize-empty|inspect --file ABSOLUTE [--server ROOT --token-file ABSOLUTE --work-dir ABSOLUTE]',
    );
  const file = path.resolve(options['--file']);
  if (command === 'inspect') {
    if (!path.isAbsolute(options['--work-dir'] || ''))
      throw Error('EXPLICIT_PRIVATE_WORK_DIRECTORY_REQUIRED');
    const result = await readSeedPackage({
      file,
      directory: path.join(options['--work-dir'], 'inspect-' + randomUUID()),
    });
    console.log(
      JSON.stringify({
        format: result.manifest.format,
        version: 1,
        entities: result.manifest.entityCount,
        assets: result.manifest.assetCount,
        size: result.size,
        sha256: result.sha256,
        policy: result.manifest.policy,
      }),
    );
  } else {
    if (!path.isAbsolute(options['--token-file'] || ''))
      throw Error('EXPLICIT_PRIVATE_TOKEN_FILE_REQUIRED');
    const secret = (await fs.readFile(options['--token-file'], 'utf8')).trim();
    const token = secret.startsWith('{') ? JSON.parse(secret).token : secret;
    const client = createProductSeedClient({
      baseUrl: options['--server'],
      token,
      timeoutMs: 120000,
    });
    if (command === 'export') {
      // An ordinary library seed must never masquerade as all desktop data.
      if (options['--scope'] === 'computer') {
        const response = await fetch(
          new URL('api/product/v1/migration/coverage', options['--server']),
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (!response.ok) throw Error('COMPUTER_EXPORT_COVERAGE_UNAVAILABLE');
        const coverage = await response.json();
        if (coverage.completeComputerExport !== true)
          throw Error('COMPUTER_EXPORT_SOURCES_INCOMPLETE');
      }
      try {
        await fs.access(file);
        throw Error('OUTPUT_ALREADY_EXISTS');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await fs.mkdir(path.dirname(file), { recursive: true });
      const job = await wait(
        client,
        'export',
        await client.createExport(options['--operation-id'] || randomUUID()),
      );
      console.log(
        JSON.stringify({
          exportId: job.id,
          operationId: job.operationId,
          file,
          size: job.size,
          status: 'downloading',
        }),
      );
      const partial = file + '.' + job.id + '.partial';
      let offset = 0;
      try {
        offset = (await fs.stat(partial)).size;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (offset > job.size) throw Error('SEED_PARTIAL_TOO_LARGE');
      if (offset < job.size) {
        const response = await client.download(job.id, offset ? { range: `bytes=${offset}-` } : {});
        if (offset && response.status !== 206) throw Error('SEED_RANGE_REQUIRED');
        await pipeline(
          Readable.fromWeb(response.body),
          createWriteStream(partial, { flags: offset ? 'a' : 'wx' }),
        );
      }
      if (
        (await fs.stat(partial)).size !== job.size ||
        (await seedFileHash(partial)) !== job.sha256
      )
        throw Error('SEED_DOWNLOAD_HASH_MISMATCH');
      // Same-directory hard link publishes without overwriting a competing output.
      await fs.link(partial, file);
      await fs.unlink(partial);
      console.log(
        JSON.stringify({
          file,
          exportId: job.id,
          operationId: job.operationId,
          entities: job.manifest.entityCount,
          assets: job.manifest.assetCount,
          size: job.size,
          sha256: job.sha256,
        }),
      );
    } else {
      const info = await fs.stat(file),
        sha256 = await seedFileHash(file);
      let job = await client.createImport({ mode: 'initialize-empty', size: info.size, sha256 });
      if (job.status !== 'committed') {
        const received = new Set(job.received),
          source = await fs.open(file, 'r');
        try {
          for (let i = 0; i < Math.ceil(info.size / job.chunkSize); i++) {
            if (received.has(i)) continue;
            const bytes = Buffer.alloc(Math.min(job.chunkSize, info.size - i * job.chunkSize));
            const { bytesRead } = await source.read(bytes, 0, bytes.length, i * job.chunkSize);
            if (bytesRead !== bytes.length) throw Error('SEED_SOURCE_CHANGED');
            await client.uploadChunk(job.id, i, bytes);
          }
        } finally {
          await source.close();
        }
        job = await wait(client, 'import', await client.commit(job.id));
      }
      console.log(JSON.stringify({ importId: job.id, status: job.status, receipt: job.receipt }));
    }
  }
} catch (error) {
  console.error(
    /^[A-Z0-9_]+$/.test(error.code || error.message || '')
      ? error.code || error.message
      : 'PRODUCT_SEED_COMMAND_FAILED',
  );
  process.exitCode = 1;
}
