import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { maintenanceTemplate, rolloutPlanTemplate } from './computer-maintenance-window.mjs';
import { assertNoReparse, fileSha256 } from '../src/server/shared-sync/rollout-guard.mjs';

// Preparation writes only new private export files, never the active pointer,
// data, shared configuration or process state. Missing evidence stays null.
const root = process.cwd();
const deploymentFile = path.join(root, 'config', 'deployment.local.json');
await assertNoReparse(deploymentFile);
const deployment = JSON.parse(await fs.readFile(deploymentFile, 'utf8'));
const exportsDir = path.join(deployment.stateDirectory, 'exports');
await assertNoReparse(exportsDir);
const directory = path.join(exportsDir, 'controlled-rollout-' + randomUUID());
await fs.mkdir(directory);
const plan = rolloutPlanTemplate(root, deployment.dataDir, deployment.stateDirectory, directory);
const config = {
  enabled: true,
  remote: false,
  listenHost: '127.0.0.1',
  sourceCollection: { exportsDir },
};
const write = (name, value) =>
  fs.writeFile(path.join(directory, name), JSON.stringify(value, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
await write('shared-config.json', config);
plan.sharedConfigSha256 = await fileSha256(plan.sharedConfig);
await write('rollout-plan.json', plan);
const window = maintenanceTemplate(root, exportsDir);
window.rolloutPlan = path.join(directory, 'rollout-plan.json');
await write('window.json', window);
// A locator is private as well; stdout reports only readiness booleans.
await fs.writeFile(
  path.join(exportsDir, 'current-maintenance-locator.json'),
  JSON.stringify({ version: 1, directory }, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify({ prepared: true, maintenanceReady: false, formalChanged: false }));
