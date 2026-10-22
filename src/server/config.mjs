import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { sharedBusinessConfig } from './shared-sync/config.mjs';

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
export function parseDeploymentConfig(value) {
  if (
    !value ||
    value.mode !== 'production' ||
    !path.isAbsolute(value.dataDir || '') ||
    !path.isAbsolute(value.stateDirectory || '')
  )
    throw Error('Deployment requires production mode and absolute dataDir/stateDirectory');
  return {
    dataDir: path.resolve(value.dataDir),
    stateDirectory: path.resolve(value.stateDirectory),
  };
}

function localDeployment() {
  let content;
  try {
    content = readFileSync(path.join(APP_ROOT, 'config', 'deployment.local.json'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  const deployment = parseDeploymentConfig(JSON.parse(content));
  if (!existsSync(path.join(deployment.dataDir, 'diary.json')))
    throw Error(
      'Configured production library is missing; refusing to create an empty replacement',
    );
  return deployment;
}

export function runtimeConfig(env = process.env, deployment) {
  const port = Number(env.DIARY_PORT || APP.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error('DIARY_PORT must be 1..65535');
  deployment ??= env.DIARY_DATA_DIR ? undefined : localDeployment();
  let shared;
  const sharedFile =
    env.DIARY_SHARED_CONFIG || path.join(APP_ROOT, 'config/shared-backend.local.json');
  try {
    shared = JSON.parse(readFileSync(sharedFile, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error.code !== 'ENOENT' || env.DIARY_SHARED_CONFIG) throw error;
  }
  const sharedOptions = sharedBusinessConfig(shared);
  return {
    host: APP.host,
    port,
    dataDir: env.DIARY_DATA_DIR
      ? path.resolve(env.DIARY_DATA_DIR)
      : deployment?.dataDir || DEFAULT_DATA_DIR,
    ...sharedOptions,
  };
}
