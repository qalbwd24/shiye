import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { APP_ROOT } from '../src/server/config.mjs';
function collect(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) =>
    item.name === 'ui-test-data'
      ? []
      : item.isDirectory()
        ? collect(path.join(dir, item.name))
        : item.name.endsWith('.test.mjs')
          ? [path.join(dir, item.name)]
          : [],
  );
}
const files = collect(path.join(APP_ROOT, 'tests')).sort();
if (!files.length) throw Error('No automated tests found');
const concurrency = process.env.SHIYE_TEST_CONCURRENCY;
if (concurrency && !/^(?:[1-9]|[12]\d|3[0-2])$/.test(concurrency))
  throw Error('SHIYE_TEST_CONCURRENCY must be an integer from 1 to 32');
const result = spawnSync(
  process.execPath,
  ['--test', ...(concurrency ? [`--test-concurrency=${concurrency}`] : []), ...files],
  {
    cwd: APP_ROOT,
    stdio: 'inherit',
  },
);
process.exitCode = result.status ?? 1;
