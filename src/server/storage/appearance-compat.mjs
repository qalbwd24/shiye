import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { imageType } from '../../../public/shared/appearance.js';
import { LIMITS } from '../../../public/shared/limits.js';

/** Import v0.4 referenced backgrounds once. Keep all old files and unknown fields. */
export async function preserveOldBackgrounds({ dataDir, getDb, mutate }) {
  const backgrounds = getDb().settings?.preferences?.appearance?.backgrounds || [];
  const mapped = new Map();
  for (const b of backgrounds) {
    if (!/^[a-f0-9-]{36}$/i.test(b.id) || mapped.has(b.id)) continue;
    if (getDb().media.some((m) => m.id === b.id && m.purpose === 'background')) continue;
    const source = path.join(dataDir, 'backgrounds', b.id);
    let stat;
    try {
      stat = await fs.stat(source);
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    if (!stat.isFile() || stat.size > LIMITS.backgroundBytes) continue;
    const handle = await fs.open(source, 'r');
    const head = Buffer.alloc(12);
    try {
      await handle.read(head, 0, 12, 0);
    } finally {
      await handle.close();
    }
    const type = imageType(head);
    if (!type) continue;
    const id = randomUUID();
    await fs.copyFile(source, path.join(dataDir, 'media', id), constants.COPYFILE_EXCL);
    mapped.set(b.id, { id, type, name: '旧版背景图片', size: stat.size, purpose: 'background' });
  }
  if (mapped.size)
    await mutate((d) => {
      d.media.push(...mapped.values());
      d.settings.preferences.appearance.backgrounds = backgrounds.map((b) => ({
        ...b,
        id: mapped.get(b.id)?.id || b.id,
      }));
    });
}
