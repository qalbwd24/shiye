import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { createDiaryServer } from '../src/server/app.mjs';
import { configureRevisit, tickRevisit } from '../src/server/domain/revisit.mjs';

const root = path.resolve(import.meta.dirname, '..');
const labName = process.env.SHIYE_REVISIT_LAB_NAME || 'revisit-ui-preview';
if (!/^revisit-[a-z0-9-]{1,55}$/.test(labName)) throw Error('独立实验室名称不正确');
const dataDir = path.join(root, 'tmp', labName, 'data');
const output = path.join(root, 'outputs', labName);
await fs.mkdir(path.join(dataDir, 'media'), { recursive: true });
await fs.mkdir(output, { recursive: true });

function chunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const size = Buffer.alloc(4),
    tail = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, payload, tail]);
}
function image() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(640);
  header.writeUInt32BE(360, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Array.from({ length: 360 }, (_, y) =>
    Buffer.from([
      0,
      ...Array.from({ length: 640 }, (_, x) => [
        38 + Math.floor(x / 8),
        88 + Math.floor(y / 5),
        110 + Math.floor(x / 12),
      ]).flat(),
    ]),
  );
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
try {
  await fs.access(path.join(dataDir, 'diary.json'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const now = new Date();
  const earlier = new Date(now.getTime() - 40 * 60000);
  const date = (years, delta = 0) => {
    const d = new Date(earlier.getTime() + delta * 60000);
    d.setUTCFullYear(d.getUTCFullYear() - years);
    return d.toISOString();
  };
  const stamp = (iso) =>
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Shanghai',
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(new Date(iso));
  const entry = (id, years, category, title, text, media = false, delta = 0) => ({
    id,
    title,
    category,
    tags: ['体验样例'],
    date: date(years, delta),
    updatedAt: date(years, delta),
    contentEditedAt: date(years, delta),
    revision: 1,
    contentFormat: 'html',
    content: `<p>[${stamp(date(years, delta))}]</p><p>${text}</p>`,
    attachments: media ? ['lab-landscape'] : [],
  });
  const db = {
    schema: 1,
    categories: ['日常', '灵感'],
    entries: [
      entry(
        'lab-last-year',
        1,
        '日常',
        '去年：给未来留一句话',
        '今天留下一个小念头：不需要写得完整，先记录下来就好。<br>这是独立测试库里的虚构内容。',
        true,
      ),
      entry(
        'lab-two-years',
        2,
        '日常',
        '前年：慢慢来',
        '回头看时，也许会发现当时的自己已经很努力了。<br><em>这段斜体文字用于检查原日记格式。</em>',
      ),
      entry(
        'lab-idea',
        1,
        '灵感',
        '去年：一个小想法',
        '把长篇日记和随想连接起来：看到过去的消息，在今天留下评论。',
        false,
        20,
      ),
    ],
    media: [{ id: 'lab-landscape', name: '图文体验.png', type: 'image/png' }],
    migrations: { legacyMetadataV06: true },
  };
  configureRevisit(db, {
    expectedRevision: 1,
    enabled: true,
    title: '朝花夕拾',
    sender: { name: '往日的我' },
  });
  tickRevisit(
    db,
    {
      manual: true,
      from: new Date(earlier.getTime() - 60000).toISOString(),
      to: now.toISOString(),
    },
    now.getTime(),
  );
  await fs.writeFile(path.join(dataDir, 'media/lab-landscape'), image());
  await fs.writeFile(path.join(dataDir, 'diary.json'), JSON.stringify(db, null, 2), { flag: 'wx' });
}
const server = await createDiaryServer({ dataDir, seed: false, messageUnits: true });
const instance = randomUUID();
const handler = server.listeners('request')[0];
server.removeListener('request', handler);
server.on('request', (req, res) => {
  if (req.url === '/api/revisit-lab-health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ purpose: 'shiye-isolated-revisit-lab', instance }));
  } else handler(req, res);
});
const port = Number(process.env.SHIYE_REVISIT_LAB_PORT || 0);
if (!Number.isSafeInteger(port) || (port && (port < 20000 || port > 65535)))
  throw Error('测试端口必须为0或20000以上，不允许使用日常端口');
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
});
await fs.writeFile(
  path.join(output, 'runtime.json'),
  JSON.stringify(
    {
      purpose: 'shiye-isolated-revisit-lab',
      instance,
      pid: process.pid,
      port: server.address().port,
      dataDir,
      startedAtUtc: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log('Independent revisit lab ready on loopback; runtime recorded.');
