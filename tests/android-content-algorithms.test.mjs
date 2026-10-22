import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { prepareDiaryUnits, reassembleDiaryUnits } from '../public/shared/message-units.js';
import { projectDiaryParagraphMessages } from '../public/shared/diary-paragraph-messages.js';
import { revisitMarkdown } from '../src/server/domain/revisit-markdown.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = path.join(root, 'tmp/android-content-contract-010/algorithms');
const output = path.join(root, 'outputs/2026-10-18-android-content-contract/algorithms');
const fixturePath = path.join(root, 'tests/fixtures/cross-device-content-v1.json');
const sourceFacade = 'android/app/src/main/assets/content-algorithms.js';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('Android packaged shared closure matches desktop fixture without new algorithms or input mutations', async () => {
  await fs.mkdir(work, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(work, 'package.json'), '{"type":"module"}');
  const manifest = [];
  const seen = new Set();
  const gradle = await fs.readFile(path.join(root, 'android/app/build.gradle'), 'utf8');
  async function stage(relative, destination = relative) {
    if (seen.has(relative)) return;
    seen.add(relative);
    const bytes = await fs.readFile(path.join(root, relative));
    const target = path.join(work, destination);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    manifest.push({ file: relative, asset: destination, sha256: sha256(bytes) });
    if (relative.startsWith('public/'))
      assert.ok(gradle.includes(`'${relative}'`), `Missing Gradle include ${relative}`);
    const text = bytes.toString('utf8');
    for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)) {
      const dependency = path.posix.normalize(
        path.posix.join(path.posix.dirname(destination), match[1]),
      );
      await stage(dependency);
    }
  }
  await stage(sourceFacade, 'content-algorithms.js');
  const facade = await import(pathToFileURL(path.join(work, 'content-algorithms.js')));
  const fixtureBytes = await fs.readFile(fixturePath);
  const fixture = JSON.parse(fixtureBytes);
  const before = JSON.stringify(fixture);
  const actual = facade.runContentFixture(fixture);
  let id = 0;
  const prepared = prepareDiaryUnits(fixture.entry, {
    media: fixture.media,
    timeZone: fixture.timeZone,
    createId: () => 'fixture-unit-' + ++id,
  });
  assert.deepEqual(actual.prepared, prepared);
  assert.deepEqual(actual.projected, projectDiaryParagraphMessages(prepared.units));
  assert.deepEqual(actual.reassembled, reassembleDiaryUnits(prepared.units, prepared.layout));
  assert.deepEqual(actual.reassembled, fixture.entry.body);
  assert.deepEqual(actual.editorRoundtrip, fixture.entry.body);
  for (const key of [
    'firstManualInstant',
    'secondParagraphInstant',
    'knownMediaInstant',
    'unknownMediaFallbackInstant',
    'occurrenceIds',
  ])
    assert.deepEqual(actual.summary[key], fixture.expected[key]);
  assert.equal(actual.summary.unknownMediaInsertedAt, null);
  assert.equal(actual.currentCanonicalEnabled, false);
  assert.deepEqual(facade.inspectRichDocument(fixture.entry.body), {
    supported: true,
    readOnly: false,
  });
  const unknown = structuredClone(fixture.entry.body);
  unknown.content[0].attrs.futureAttribute = 'preserved';
  const unknownBefore = JSON.stringify(unknown);
  assert.equal(facade.inspectRichDocument(unknown).readOnly, true);
  assert.equal(JSON.stringify(unknown), unknownBefore);
  const group = actual.projected.filter(
    (u) => u.paragraphProjection?.parentUnitId === prepared.units[0].id,
  );
  assert.deepEqual(
    group.map((u) => revisitMarkdown(u.body, { normalizeDiaryParagraphIndent: true })),
    fixture.expected.paragraphMarkdown,
  );
  assert.equal(JSON.stringify(fixture), before);
  await fs.writeFile(path.join(output, 'desktop-expected.json'), JSON.stringify(actual, null, 2));
  await fs.writeFile(
    path.join(output, 'source-manifest.json'),
    JSON.stringify({ fixtureSha256: sha256(fixtureBytes), modules: manifest }, null, 2),
  );
  await fs.writeFile(
    path.join(output, 'node-report.json'),
    JSON.stringify(
      {
        ok: true,
        modules: manifest.length,
        inputUnchanged: true,
        desktopEqual: true,
        strictUnknownReadOnly: true,
        runtime: 'Node; Android WebView pending',
      },
      null,
      2,
    ),
  );
});
