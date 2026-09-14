import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
/** Serializes copy-on-write updates. Never mutate the result of getDb directly. */
export async function createLibraryStore({ dataDir, seed = true }) {
  await fs.mkdir(path.join(dataDir, 'media'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'originals'), { recursive: true });
  const dbFile = path.join(dataDir, 'diary.json');
  let db;
  try {
    db = JSON.parse(await fs.readFile(dbFile, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    db = { schema: 1, categories: ['日常', '学习', '旅行', '灵感'], entries: [], media: [] };
    if (seed) {
      const now = new Date();
      const when = (d) => {
        const t = new Date(now);
        t.setDate(t.getDate() - d);
        t.setHours(18 - d, 30, 0, 0);
        return t.toISOString();
      };
      db.entries = [
        {
          title: '把生活，慢慢写下来',
          content:
            '<p>不必等到特别的一天，才开始记录。</p><p>窗外的光、读到的一句话、今天完成的一件小事，都值得留下一页。</p><blockquote>给自己留一点时间，也给记忆一个落脚的地方。</blockquote><p>这是可以编辑的体验示例。试着写下今天的第一句话吧。</p>',
          category: '日常',
          tags: ['日常碎片', '慢生活'],
          mood: '平静',
          weather: '晴',
          location: '',
          cover: 'morning',
          offset: 0,
        },
        {
          title: '给专注留一段空白',
          content:
            '<p>把任务拆小以后，开始就没有想象中那么难。</p><p>今天的三个小目标：</p><ul><li>读完计划中的章节</li><li>整理一页笔记</li><li>留一点时间给自己</li></ul>',
          category: '学习',
          tags: ['专注'],
          mood: '充实',
          weather: '多云',
          location: '',
          offset: 1,
        },
        {
          title: '不赶时间的傍晚',
          content:
            '<p>路过熟悉的街角，发现夕阳把窗户染成了蜂蜜的颜色。</p><p>有些风景，一直在那里，只是今天终于有空看见。</p>',
          category: '日常',
          tags: ['慢生活'],
          mood: '开心',
          weather: '晴',
          location: '',
          cover: 'evening',
          offset: 3,
        },
        {
          title: '一个想法的开始',
          content:
            '<p>想要一个打开就能写的地方。少一点切换，多一点专注。</p><p>把灵感记下来，剩下的以后再说。</p>',
          category: '灵感',
          tags: ['想法'],
          mood: '期待',
          weather: '阴',
          location: '',
          offset: 5,
        },
      ].map((e) => ({
        ...e,
        id: randomUUID(),
        date: when(e.offset),
        createdAt: when(e.offset),
        updatedAt: when(e.offset),
        revision: 1,
        attachments: [],
        history: [],
        deleted: false,
        pinned: false,
        demo: true,
      }));
    }
    await fs.writeFile(dbFile, JSON.stringify(db, null, 2), 'utf8');
  }
  db.imports ||= [];
  db.templates ||= [];
  db.settings ||= { shortcuts: {} };
  let queue = Promise.resolve();
  async function mutate(fn) {
    const work = queue.then(async () => {
      const next = structuredClone(db);
      const result = fn(next);
      await fs.writeFile(dbFile + '.tmp', JSON.stringify(next, null, 2), 'utf8');
      await fs.rename(dbFile + '.tmp', dbFile);
      db = next;
      return result;
    });
    queue = work.catch(() => {});
    return work;
  }

  return { getDb: () => db, mutate };
}
