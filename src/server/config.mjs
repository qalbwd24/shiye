import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

export const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const PUBLIC_ROOT = path.join(APP_ROOT, 'public');
export const DEFAULT_DATA_DIR = path.join(APP_ROOT, 'data');
export const LEGACY_READER = path.join(APP_ROOT, 'resources', 'legacy', 'backup_reader.py');
export const APP = Object.freeze(
  JSON.parse(readFileSync(path.join(APP_ROOT, 'config', 'app.json'), 'utf8')),
);
export const VERSION = JSON.parse(
  readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'),
).version;

/** Runtime overrides are explicit; tests must pass an isolated dataDir. */
export function runtimeConfig(env = process.env) {
  const port = Number(env.DIARY_PORT || APP.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error('DIARY_PORT must be 1..65535');
  return {
    host: APP.host,
    port,
    dataDir: env.DIARY_DATA_DIR ? path.resolve(env.DIARY_DATA_DIR) : DEFAULT_DATA_DIR,
  };
}
