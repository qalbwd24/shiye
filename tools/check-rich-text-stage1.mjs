// Safe during another task's desktop work: no native-window test or app restart.
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'outputs/rich-text-stage1');
mkdirSync(output, { recursive: true });
const collect = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((item) =>
    item.name === 'ui-test-data'
      ? []
      : item.isDirectory()
        ? collect(path.join(dir, item.name))
        : item.name.endsWith('.test.mjs') && item.name !== 'quick-desktop.test.mjs'
          ? [path.join(dir, item.name)]
          : [],
  );
const commands = [
  ['module-paths', ['tools/check-files.mjs']],
  ['lint', ['node_modules/eslint/bin/eslint.js', '.']],
  ['format', ['node_modules/prettier/bin/prettier.cjs', '--check', '.']],
  ['node-tests', ['--test', ...collect(path.join(root, 'tests')).sort()]],
];
const result = {
  at: new Date().toISOString(),
  kind: 'headless-only',
  excluded: ['tests/quick-desktop.test.mjs (opens native windows)'],
  checks: [],
};
for (const [name, args] of commands) {
  const run = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', windowsHide: true });
  writeFileSync(path.join(output, `${name}.txt`), (run.stdout || '') + (run.stderr || ''));
  result.checks.push({ name, exitCode: run.status });
  console.log(`${name}: ${run.status}`);
  if (run.status !== 0) {
    console.log(run.stdout, run.stderr);
    process.exitCode = 1;
    break;
  }
}
writeFileSync(path.join(output, 'checks.json'), JSON.stringify(result, null, 2) + '\n');
