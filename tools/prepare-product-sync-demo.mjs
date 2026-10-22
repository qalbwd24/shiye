import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '../var/product-sync-demo-source');
await mkdir(path.join(root, 'media'), { recursive: true });
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
await writeFile(path.join(root, 'media', 'demo-image'), gif);
const when = new Date().toISOString();
const db = {
  schema: 1,
  categories: ['同步测试', '日常'],
  tags: ['合成测试'],
  entries: [
    {
      id: 'demo-entry',
      title: '电脑与手机同步测试',
      date: when,
      createdAt: when,
      updatedAt: when,
      revision: 1,
      category: '同步测试',
      tags: ['合成测试'],
      attachments: ['demo-image'],
      contentFormat: 'html',
      content: '<p>这是独立合成测试库，可以在客户端接入后修改。正式日记未导入。</p>',
      history: [],
    },
  ],
  media: [
    {
      id: 'demo-image',
      type: 'image/gif',
      name: '测试原件.gif',
      size: gif.length,
      importedAt: when,
    },
  ],
  stickers: [{ id: 'demo-sticker', mediaId: 'demo-image', name: '同步测试', note: '保留GIF原件' }],
  chatJournal: {
    version: 1,
    rooms: [
      {
        sourceId: randomUUID(),
        id: '1',
        title: '随想同步测试',
        category: '同步测试',
        idleHours: 5,
        configuration: {
          wallpaperAssetId: 'demo-image',
          messageAlign: 'right',
          bubbleOpacity: 0.8,
        },
      },
    ],
    withdrawals: [],
  },
  settings: { preferences: { theme: 'dark', timeZone: 'Asia/Shanghai' } },
};
await writeFile(path.join(root, 'diary.json'), JSON.stringify(db, null, 2));
console.log(JSON.stringify({ source: root, synthetic: true, entries: 1, assets: 1 }));
