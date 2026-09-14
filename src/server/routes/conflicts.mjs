import { remapEntryMedia } from '../domain/import-reconciliation.mjs';
export function createRoutes({ mutate, body, reply, fail }) {
  return async (req, res, p) => {
    const match = p.match(/^\/api\/conflicts\/([a-f0-9-]+)$/);
    if (!match || req.method !== 'PUT') return false;
    const input = JSON.parse(await body(req));
    if (!['both', 'left', 'right'].includes(input.choice)) throw fail(400, '请选择保留方式');
    const result = await mutate((db) => {
      const conflict = db.conflicts?.find((item) => item.id === match[1]);
      if (!conflict || conflict.status !== 'open') throw fail(409, '此冲突已处理，请刷新');
      const items = conflict.kind === 'entry' ? db.entries : db.media;
      const left = items.find((i) => i.id === conflict.left),
        right = items.find((i) => i.id === conflict.right);
      if (!left || !right) throw fail(409, '对比内容已变化，请刷新');
      if (
        conflict.kind === 'entry' &&
        (input.leftRevision !== left.revision || input.rightRevision !== right.revision)
      )
        throw fail(409, '日记已被编辑，请重新对比后选择');
      if (input.title !== undefined) {
        if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 500)
          throw fail(400, '新名称不正确');
        const field = conflict.kind === 'entry' ? 'title' : 'name';
        if (conflict.kind === 'entry') {
          const old = structuredClone(right);
          delete old.history;
          right.history = [old, ...(right.history || [])].slice(0, 20);
          right.revision++;
          right.updatedAt = new Date().toISOString();
        }
        right[field] = input.title.trim();
      }
      if (input.choice !== 'both') {
        const keep = input.choice === 'left' ? left : right,
          discard = input.choice === 'left' ? right : left;
        if (conflict.kind === 'entry') {
          const old = structuredClone(discard);
          delete old.history;
          discard.history = [old, ...(discard.history || [])].slice(0, 20);
          discard.deleted = true;
          discard.revision++;
          discard.updatedAt = new Date().toISOString();
        } else {
          for (let i = 0; i < db.entries.length; i++) {
            const entry = db.entries[i];
            if (!(entry.attachments || []).includes(discard.id)) continue;
            const old = structuredClone(entry);
            delete old.history;
            // Only current references change; history retains access to the rejected version.
            const mapped = remapEntryMedia(
              { ...entry, history: [] },
              new Map([[discard.id, keep.id]]),
            );
            mapped.history = [old, ...(entry.history || [])].slice(0, 20);
            mapped.revision++;
            mapped.updatedAt = new Date().toISOString();
            db.entries[i] = mapped;
          }
        }
      }
      conflict.status = 'resolved';
      conflict.choice = input.choice;
      conflict.resolvedAt = new Date().toISOString();
      return { updated: true };
    });
    reply(res, 200, result);
    return true;
  };
}
