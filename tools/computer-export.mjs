import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  readDesktopCapture,
  planDesktopSource,
} from '../src/server/shared-sync/desktop-source-plan.mjs';
import {
  captureComputerSource,
  exportComputerSeed,
  computerOwnerTransport,
  registerComputerSourceConflicts,
  applyComputerSourceCollection,
} from '../src/server/shared-sync/computer-export.mjs';

export async function runComputerExport(args) {
  const [mode, ...rest] = args,
    options = {};
  const allowed = [
    '--data-dir',
    '--exports-dir',
    '--file',
    '--work-dir',
    '--server',
    '--credential-file',
    '--source-operation',
    '--capture-dir',
    '--plan-file',
  ];
  for (let i = 0; i < rest.length; i += 2) {
    if (!allowed.includes(rest[i]) || !rest[i + 1] || Object.hasOwn(options, rest[i]))
      throw Error('COMPUTER_EXPORT_INVALID_ARGUMENT');
    options[rest[i]] = rest[i + 1];
  }
  if (mode === 'capture') {
    const result = await captureComputerSource({
      dataDir: options['--data-dir'],
      exportsDir: options['--exports-dir'],
    });
    return result.report;
  }
  if (mode === 'plan') {
    for (const key of ['--data-dir', '--capture-dir', '--exports-dir', '--plan-file'])
      if (!path.isAbsolute(options[key] || '')) throw Error('COMPUTER_EXPLICIT_PATH_REQUIRED');
    const privateRoot = path.resolve(options['--exports-dir']) + path.sep;
    if (!path.resolve(options['--plan-file']).startsWith(privateRoot))
      throw Error('COMPUTER_PRIVATE_PLAN_REQUIRED');
    const captured = await readDesktopCapture(options['--capture-dir']);
    const db = JSON.parse(await readFile(path.join(options['--data-dir'], 'diary.json'), 'utf8'));
    const plan = planDesktopSource(db, captured);
    await mkdir(path.dirname(options['--plan-file']), { recursive: true, mode: 0o700 });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(options['--plan-file'], JSON.stringify(plan, null, 2), {
      flag: 'wx',
      mode: 0o600,
    });
    return plan.summary;
  }
  if (!['export', 'register-conflicts', 'apply'].includes(mode))
    throw Error('COMPUTER_EXPORT_EXPECTED_CAPTURE_PLAN_OR_EXPORT');
  if (['register-conflicts', 'apply'].includes(mode)) {
    let credential = {};
    if (options['--credential-file']) {
      if (!path.isAbsolute(options['--credential-file']))
        throw Error('COMPUTER_EXPLICIT_PATH_REQUIRED');
      credential = JSON.parse(await readFile(options['--credential-file'], 'utf8'));
    }
    if (credential.token) throw Error('COMPUTER_LOCAL_ADMIN_COOKIE_REQUIRED');
    const execute =
      mode === 'apply' ? applyComputerSourceCollection : registerComputerSourceConflicts;
    const result = await execute({
      dataDir: options['--data-dir'],
      captureDir: options['--capture-dir'],
      exportsDir: options['--exports-dir'],
      requestFile: options['--plan-file'],
      request: computerOwnerTransport({ baseUrl: options['--server'], cookie: credential.cookie }),
    });
    return mode === 'apply'
      ? {
          registered: result.registered,
          replayed: result.replayed,
          backendMapped: result.receipt?.coverage.backendMapped,
          completeComputerExport: false,
          rendererRestoration: result.receipt?.coverage.rendererRestoration,
        }
      : result;
  }
  for (const key of ['--data-dir', '--file', '--work-dir'])
    if (!path.isAbsolute(options[key] || '')) throw Error('COMPUTER_EXPLICIT_PATH_REQUIRED');
  let credential = {};
  if (options['--credential-file']) {
    if (!path.isAbsolute(options['--credential-file']))
      throw Error('COMPUTER_EXPLICIT_PATH_REQUIRED');
    credential = JSON.parse(await readFile(options['--credential-file'], 'utf8'));
  }
  await mkdir(path.dirname(options['--file']), { recursive: true, mode: 0o700 });
  const result = await exportComputerSeed({
    dataDir: options['--data-dir'],
    file: options['--file'],
    directory: options['--work-dir'],
    sourceOperationId: options['--source-operation'],
    request: computerOwnerTransport({
      baseUrl: options['--server'],
      token: credential.token,
      cookie: credential.cookie,
      deviceId: credential.deviceId,
    }),
  });
  return {
    version: 1,
    kind: 'shared-bootstrap',
    sha256: result.sha256,
    size: result.size,
    entityCount: result.manifest.entityCount,
    assetCount: result.manifest.assetCount,
    libraryId: result.manifest.libraryId,
    epoch: result.manifest.epoch,
    watermark: result.manifest.watermark,
    registered: !!result.registration?.registered,
    completeComputerExport: result.coverage.completeComputerExport,
    coverage: result.coverage,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(JSON.stringify(await runComputerExport(process.argv.slice(2))) + '\n');
  } catch (error) {
    // Do not leak source filenames, paths, file content or credential details.
    process.stderr.write(
      (/^((COMPUTER|SHARED|SOURCE)_)[A-Z0-9_]+$/.test(error.code || error.message)
        ? error.code || error.message
        : 'COMPUTER_EXPORT_FAILED') + '\n',
    );
    process.exitCode = 1;
  }
}
