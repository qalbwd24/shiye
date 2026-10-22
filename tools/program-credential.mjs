import { readFile } from 'node:fs/promises';
import { openSync, writeFileSync, fsyncSync, closeSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createProgramAuth } from '../src/server/conversation-services/program-auth.mjs';

/** Explicit trusted server CLI. It never discovers/starts a server or reads a
 * default library. Credential files stay under the private auth directory. */
export async function programCredential({
  dataDir,
  action,
  instanceId,
  scopes,
  credentialId,
  output,
}) {
  if (!path.isAbsolute(dataDir || '')) throw Error('PROGRAM_EXPLICIT_DATA_DIR_REQUIRED');
  const auth = await createProgramAuth({ dataDir });
  let createdOutput = false;
  try {
    if (action === 'revoke') return auth.revoke(credentialId);
    const privateRoot = path.join(dataDir, '.program-auth') + path.sep;
    if (
      !path.isAbsolute(output || '') ||
      !path.resolve(output).startsWith(privateRoot) ||
      !output.endsWith('.credential.json')
    )
      throw Error('PROGRAM_PRIVATE_OUTPUT_REQUIRED');
    const db = JSON.parse(await readFile(path.join(dataDir, 'diary.json'), 'utf8'));
    const persist = (issued) => {
      const fd = openSync(output, 'wx', 0o600);
      createdOutput = true;
      try {
        writeFileSync(fd, JSON.stringify(issued), { encoding: 'utf8' });
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    };
    const issued =
      action === 'issue'
        ? auth.issue(db, { instanceId, scopes }, persist)
        : action === 'rotate'
          ? auth.rotate(db, credentialId, persist)
          : null;
    if (!issued) throw Error('PROGRAM_INVALID_CREDENTIAL_ACTION');
    return { credentialId: issued.credentialId, instanceId: issued.instanceId, output };
  } catch (error) {
    if (createdOutput) {
      try {
        unlinkSync(output);
      } catch {
        /* A failed private file is never a valid grant. */
      }
    }
    throw error;
  } finally {
    auth.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = {};
    for (let i = 2; i < process.argv.length; i += 2)
      args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
    const result = await programCredential({
      dataDir: args['data-dir'],
      action: args.action,
      instanceId: args.instance,
      scopes: args.scopes?.split(','),
      credentialId: args.credential,
      output: args.output,
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write(
      (/^PROGRAM_/.test(error.message) ? error.message : 'PROGRAM_CREDENTIAL_FAILED') + '\n',
    );
    process.exitCode = 1;
  }
}
