import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { APP_ROOT, PUBLIC_ROOT } from '../src/server/config.mjs';

export function inspectModules() {
  const files = [];
  function scan(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (['vendor', 'archive', 'ui-test-data'].includes(item.name)) continue;
      const f = path.join(dir, item.name);
      if (item.isDirectory()) scan(f);
      else if (/\.(mjs|js)$/.test(f)) files.push(f);
    }
  }
  for (const folder of ['src', 'public', 'tools', 'tests']) scan(path.join(APP_ROOT, folder));
  files.push(path.join(APP_ROOT, 'server.mjs'));
  const errors = [];
  for (const file of files) {
    const code = readFileSync(file, 'utf8');
    for (const match of code.matchAll(/(?:\bfrom\s*|\bimport\s*)['"]([^'"]+)['"]/g)) {
      if (!match[1].startsWith('.')) continue;
      const target = path.resolve(path.dirname(file), match[1]);
      if (!existsSync(target)) errors.push(path.relative(APP_ROOT, file) + ': missing ' + match[1]);
      if (file.startsWith(PUBLIC_ROOT + path.sep) && !target.startsWith(PUBLIC_ROOT + path.sep))
        errors.push(path.relative(APP_ROOT, file) + ': browser imports private server file');
    }
  }
  return { modules: files.length, errors };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.join(APP_ROOT, 'tools', 'check-files.mjs')
) {
  const result = inspectModules();
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) process.exitCode = 1;
}
