// Resolve a frozen build's public ESM getGlobal export from its source map.
// This never imports the app, changes assets, or uses the DEBUG window global.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sourceMap from 'source-map-js';

const app = path.resolve(process.argv[2] || '');
if (!process.argv[2])
  throw Error('Usage: node tools/resolve-telegram-state-contract.mjs <app-directory>');
const assets = path.join(app, 'assets');
const results = [];
for (const file of (await fs.readdir(assets)).filter((name) => name.endsWith('.js.map'))) {
  const raw = await fs.readFile(path.join(assets, file), 'utf8');
  if (!raw.includes('/global/index.ts')) continue;
  const map = JSON.parse(raw);
  const index = map.sources.findIndex((source) => source.endsWith('/global/index.ts'));
  if (index < 0) continue;
  const lines = map.sourcesContent[index].split('\n');
  const line =
    lines.findIndex((text) => /^export const getGlobal = typed\.getGlobal;/.test(text)) + 1;
  if (!line) throw Error(`Missing getGlobal source contract in ${file}`);
  const consumer = new sourceMap.SourceMapConsumer(map);
  const position = consumer.generatedPositionFor({
    source: map.sources[index],
    line,
    column: 13,
    bias: sourceMap.SourceMapConsumer.LEAST_UPPER_BOUND,
  });
  const bytes = await fs.readFile(path.join(assets, file.slice(0, -4)));
  const code = bytes.toString('utf8');
  const mapped = code.split('\n')[position.line - 1].slice(position.column);
  const variable = /^([\w$]+)=[\w$]+\.getGlobal\b/.exec(mapped)?.[1];
  if (!variable) throw Error(`Unrecognized generated getGlobal assignment in ${file}`);
  const exports = code.slice(code.lastIndexOf('export{'));
  const exportName = new RegExp(
    `(?:\\{|,)${variable.replaceAll('$', '\\$')} as ([\\w$]+)(?:,|})`,
  ).exec(exports)?.[1];
  if (!exportName) throw Error(`getGlobal is not a public ESM export in ${file}`);
  results.push({
    module: `./assets/${file.slice(0, -4)}`,
    exportName,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: map.sources[index],
    sourceLine: line,
    contract:
      'global/index.ts exports typed.getGlobal; resolver validates source-map assignment and final ESM export',
  });
}
if (results.length !== 1) throw Error(`Expected one getGlobal contract, found ${results.length}`);
console.log(JSON.stringify(results[0], null, 2));
