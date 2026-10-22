import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  runMessageUnitCandidates,
  resolveCandidateClock,
  validateMessageSourceUrl,
} from '../tools/message-unit-candidates.mjs';
import {
  candidateHash,
  validateMessageUnitCandidate,
} from '../tools/lib/message-unit-candidate-validator.mjs';
import * as model from '../public/shared/message-units.js';
import { convertLegacyReadingEntry } from '../src/server/domain/legacy-reading-converter.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const media = [
  { id: 'image', type: 'image/png', name: '虚构图片' },
  { id: 'video', type: 'video/mp4' },
  { id: 'audio', type: 'audio/wav' },
];
const entry = (id, extra = {}) => ({
  id,
  title: '只存在私有候选中的虚构标题',
  revision: 1,
  date: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-03T00:00:00.000Z',
  content: '<p>2026-10-01 10:00</p><p><b>虚构 正文</b>\t与空白<br>下一行</p>',
  ...extra,
});
async function workspace(t) {
  const base = path.join(ROOT, 'tmp', 'message-unification', 'legacy');
  await fs.mkdir(base, { recursive: true });
  const workspaceRoot = await fs.mkdtemp(path.join(base, 'test-'));
  t.after(async () => {
    assert.ok(path.resolve(workspaceRoot).startsWith(base + path.sep));
    await fs.rm(workspaceRoot, { recursive: true });
  });
  return {
    workspaceRoot,
    runDir: path.join(workspaceRoot, 'var', 'message-unit-candidates', 'batch-a'),
  };
}
function audit(original, mutate = () => {}) {
  const converted = convertLegacyReadingEntry(original, { media });
  const preparedEntry = { ...original, contentFormat: 'richdoc', body: converted.body };
  let next = 0;
  const createId = () => `unit:synthetic:${++next}`;
  const candidate = model.prepareDiaryUnits(preparedEntry, { media, createId });
  const repeated = model.prepareDiaryUnits(preparedEntry, {
    previousUnits: candidate.units,
    media,
    createId,
  });
  const reassembled = model.reassembleDiaryUnits(candidate.units, candidate.layout);
  mutate(candidate, reassembled);
  return validateMessageUnitCandidate({
    original,
    converted,
    preparedEntry,
    candidate,
    repeated,
    reassembled,
    media,
    validateMessageUnit: model.validateMessageUnit,
    originalSha256: candidateHash(original),
  });
}

test('adversarial HTML keeps exact text, whitespace, marks, duplicate occurrences and manual/reversed times', () => {
  const result = audit(
    entry('mixed', {
      attachments: ['image', 'image'],
      content:
        '<p>2026-10-01 10:00</p><p><b>虚构 正文</b>\t<br>尾部  </p><p>2026-10-01 09:00</p><p>倒序原样</p><pre><code>2026-10-02 20:00</code></pre><blockquote><p>2026-10-02 21:00</p></blockquote>',
    }),
  );
  assert.equal(result.status, 'review');
  for (const value of Object.values(result.checks)) assert.equal(value, true);
  assert.ok(result.issueCodes.includes('time-order-reversed'));
  assert.equal(result.mediaOccurrences, 2);
});
test('independent validator rejects media timestamp invention, modified whitespace and schema corruption', () => {
  assert.equal(
    audit(entry('time', { attachments: ['image'] }), (candidate) => {
      candidate.units[0].eventTime.source = 'manual-marker';
    }).checks.oldAttachmentTime,
    false,
  );
  assert.equal(
    audit(entry('spaces'), (_candidate, body) => {
      body.content[1].content[0].text += ' ';
    }).checks.reassembly,
    false,
  );
  assert.equal(
    audit(entry('schema'), (candidate) => {
      candidate.units[0].replyTo = undefined;
    }).checks.structure,
    false,
  );
});

test('individual units retain list, table, quote and code semantics and render through the real schema', () => {
  const complex = entry('containers', {
    content:
      '<ol start="3"><li><p>2026-10-01 10:00</p><p><em>列表</em></p></li></ol><table><tr><th colspan="2"><p>表头</p></th></tr><tr><td><p>值甲</p></td><td><p>值乙</p></td></tr></table><blockquote><p>2026-10-02 10:00</p></blockquote><pre><code>2026-10-03 10:00\n  code</code></pre>',
  });
  const result = audit(complex);
  assert.equal(result.checks.unitRenderable, true);
  assert.equal(result.checks.unitSemanticContext, true);
  assert.equal(result.checks.reassembly, true);
  const changed = audit(complex, (candidate) => {
    const list = candidate.units
      .flatMap((unit) => unit.body.content)
      .find((node) => node.type === 'orderedList');
    list.attrs.start = 1;
  });
  assert.equal(changed.checks.unitRenderable, true);
  assert.equal(changed.checks.unitSemanticContext, false);
  assert.equal(changed.status, 'failed');
});

test('legacy video attachments are independent renderable units with exact descriptors and fallback time', () => {
  const result = audit(entry('videos', { attachments: ['video', 'image', 'video'] }));
  assert.equal(result.status, 'normal');
  for (const value of Object.values(result.checks)) assert.equal(value, true);
  assert.equal(result.mediaOccurrences, 3);
});
test('unknown structures and non-body media are compatibility cases with originals retained', async (t) => {
  const options = await workspace(t);
  const library = {
    entries: [
      entry('unsupported', {
        content: '<details><summary>虚构摘要</summary><p>保留原件</p></details>',
        attachments: ['audio'],
      }),
      entry('chat', { chatJournal: { messages: [] } }),
    ],
    media,
  };
  const { report, runDir } = await runMessageUnitCandidates({ ...options, library });
  assert.equal(report.statuses['compatibility-review'], 1);
  assert.equal(report.statuses['canonical-chat-preserved'], 1);
  const manifest = JSON.parse(await fs.readFile(path.join(runDir, 'manifest.json'), 'utf8'));
  const pack = JSON.parse(
    await fs.readFile(path.join(runDir, 'entries', manifest.rows[0].key + '.json'), 'utf8'),
  );
  assert.deepEqual(pack.original, library.entries[0]);
  assert.ok(!JSON.stringify(report).includes('虚构'));
  assert.equal(report.rows, undefined);
});
test('new batches reproduce stable IDs; existing batch is refused and source objects remain untouched', async (t) => {
  const options = await workspace(t);
  const library = {
    entries: [entry('one', { attachments: ['image'] }), entry('two')],
    media,
    unknown: { retained: true },
  };
  const before = structuredClone(library);
  const first = await runMessageUnitCandidates({ ...options, library });
  assert.deepEqual(first.report.statuses, { normal: 2 });
  assert.deepEqual(library, before);
  await assert.rejects(runMessageUnitCandidates({ ...options, library }), { code: 'EEXIST' });
  const second = await runMessageUnitCandidates({
    ...options,
    runDir: path.join(path.dirname(options.runDir), 'batch-b'),
    library,
  });
  const getIds = async (runDir) => {
    const manifest = JSON.parse(await fs.readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    return Promise.all(
      manifest.rows.map(async (row) =>
        JSON.parse(
          await fs.readFile(path.join(runDir, 'entries', row.key + '.json'), 'utf8'),
        ).candidate.units.map((u) => u.id),
      ),
    );
  };
  assert.deepEqual(await getIds(first.runDir), await getIds(second.runDir));
});
test('source origin, output boundaries and source clocks are explicit', async (t) => {
  for (const value of [
    'https://127.0.0.1',
    'http://localhost:18765',
    'http://127.0.0.1/private',
    'http://user:pass@127.0.0.1',
    'http://127.0.0.1/?x=1',
  ])
    assert.throws(() => validateMessageSourceUrl(value));
  assert.equal(validateMessageSourceUrl('http://127.0.0.1:18765/'), 'http://127.0.0.1:18765');
  const options = await workspace(t);
  await assert.rejects(
    runMessageUnitCandidates({
      ...options,
      library: { entries: [], media: [] },
      runDir: path.join(options.workspaceRoot, 'data', 'wrong'),
    }),
  );
  const clock = resolveCandidateClock(
    entry('clock', {
      contentEditedAt: '2026-10-02T00:00:00.000Z',
      legacy: { original: { updateTime: 1790899200 } },
    }),
  );
  assert.equal(clock.sourceField, 'contentEditedAt');
  assert.ok(clock.issueCodes.includes('conflicting-content-edit-clock'));
  assert.ok(resolveCandidateClock({}).issueCodes.includes('missing-content-edit-clock'));
  assert.ok(
    resolveCandidateClock({ updatedAt: '2026-10-01 10:00' }).issueCodes.includes(
      'ambiguous-content-edit-clock-zone',
    ),
  );
});
