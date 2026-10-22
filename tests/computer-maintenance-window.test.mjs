import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  maintenanceTemplate,
  verifyPreparation,
  runMaintenanceStep,
} from '../tools/computer-maintenance-window.mjs';
import { fileSha256 } from '../src/server/shared-sync/rollout-guard.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shiye-maintenance-window-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = async (name, value) => {
    const file = path.join(root, name);
    await fs.writeFile(file, JSON.stringify(value));
    return { file, sha256: await fileSha256(file) };
  };
  const raw = await write('original-observation.json', {
    observed: 'synthetic no pending file preparation',
  });
  const preparation = {
    version: 1,
    kind: 'frontend-preparation-observed',
    observedAt: new Date().toISOString(),
    visibleUnsaved: false,
    pendingFilePreparation: false,
    pendingAttachments: false,
    pendingEditor: false,
    externalRequestSourcesPaused: true,
    references: [raw],
  };
  const window = maintenanceTemplate(root, root);
  window.windowGranted = true;
  window.windowReceipt = await write('grant.json', {
    version: 1,
    kind: 'maintenance-window-granted',
    exclusive: true,
    observedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600000).toISOString(),
  });
  window.frontendPreparation = await write('preparation.json', preparation);
  return { root, raw, preparation, window, write };
}

test('template cannot close a frontend or invoke deployment with omitted evidence', async () => {
  let called = 0;
  await assert.rejects(
    runMaintenanceStep('stop-frontends', maintenanceTemplate(process.cwd(), process.cwd()), {
      desktop: async () => {
        called++;
      },
    }),
    { code: 'MAINTENANCE_WINDOW_NOT_GRANTED' },
  );
  assert.equal(called, 0);
});

test('unknown File preparation, expired observation and changed raw proof refuse normal stop', async (t) => {
  const f = await fixture(t);
  const missing = { ...f.preparation };
  delete missing.pendingFilePreparation;
  await assert.rejects(verifyPreparation(await f.write('missing.json', missing)), {
    code: 'MAINTENANCE_PREPARATION_UNKNOWN',
  });
  await assert.rejects(
    verifyPreparation(
      await f.write('expired.json', {
        ...f.preparation,
        observedAt: new Date(Date.now() - 121000).toISOString(),
      }),
    ),
    { code: 'MAINTENANCE_EVIDENCE_EXPIRED' },
  );
  await fs.writeFile(f.raw.file, '{}');
  await assert.rejects(verifyPreparation(f.window.frontendPreparation), {
    code: 'MAINTENANCE_EVIDENCE_CHANGED',
  });
});

test('normal save refusal propagates and never attempts force stop, start or backend switch', async (t) => {
  const { window } = await fixture(t),
    actions = [];
  await assert.rejects(
    runMaintenanceStep('stop-frontends', window, {
      desktop: async (_root, action) => {
        actions.push(action);
        if (action === 'status')
          return { readiness: { ready: true }, maintenanceLock: null, foreignWindows: [] };
        throw Object.assign(Error('normal save protection refused'), { code: 'SAVE_REFUSED' });
      },
    }),
    { code: 'SAVE_REFUSED' },
  );
  assert.deepEqual(actions, ['status', 'stop']);
});

test('normal stop still requires actual empty process inventory and does not mark drain proven', async (t) => {
  const { window } = await fixture(t),
    actions = [];
  const result = await runMaintenanceStep('stop-frontends', window, {
    desktop: async (_root, action) => {
      actions.push(action);
      return action === 'stop'
        ? { stopped: true, pids: [7] }
        : { readiness: { ready: true }, processes: actions.length > 2 ? [] : [{ pid: 7 }] };
    },
  });
  assert.deepEqual(actions, ['status', 'stop', 'status']);
  assert.equal(result.clientsMayResume, false);
  assert.equal(result.drainProven, undefined);
});
