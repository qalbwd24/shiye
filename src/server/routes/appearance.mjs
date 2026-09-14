import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { imageType } from '../../../public/shared/appearance.js';
import { LIMITS } from '../../../public/shared/limits.js';

// Backgrounds share the authenticated media store and encrypted backup pipeline.
export function createAppearanceRoutes({ dataDir, mutate, reply, fail, body }) {
  return async (req, res, p) => {
    if (p !== '/api/backgrounds' || req.method !== 'POST') return false;
    const bytes = await body(req, LIMITS.backgroundBytes);
    const type = imageType(bytes);
    if (!type) throw fail(415, '请选择 PNG、JPEG、WebP 或 GIF 图片');
    const id = randomUUID(),
      file = path.join(dataDir, 'media', id);
    let name;
    try {
      name = decodeURIComponent(req.headers['x-file-name'] || '背景图片').slice(0, 250);
    } catch {
      throw fail(400, '文件名格式错误');
    }
    const item = {
      id,
      name,
      type,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      purpose: 'background',
    };
    await fs.writeFile(file, bytes, { flag: 'wx' });
    try {
      await mutate((d) => {
        d.media.push(item);
      });
    } catch (e) {
      await fs.unlink(file);
      throw e;
    }
    return reply(res, 201, item);
  };
}
