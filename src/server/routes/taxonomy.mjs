import { taxonomyItems, validateOrder } from '../../../public/shared/taxonomy.js';
import { createHash } from 'node:crypto';
import { renameServiceCategory } from '../conversation-services/registry.mjs';
const projectionHash = (entry) =>
  createHash('sha256')
    .update(JSON.stringify([entry.title, entry.content, entry.category, entry.attachments]))
    .digest('hex');
export function createRoutes({ mutate, body, reply, fail }) {
  return async (req, res, p) => {
    if (p === '/api/taxonomy/order' && req.method === 'PUT') {
      const input = JSON.parse(await body(req));
      if (!['category', 'tag'].includes(input.kind)) throw fail(400, '排序类型错误');
      const result = await mutate((d) => {
        if (
          input.expectedOrder !== undefined &&
          JSON.stringify(taxonomyItems(d, input.kind).map((item) => item.name)) !==
            JSON.stringify(input.expectedOrder)
        )
          throw fail(409, '分类或顺序已被其他窗口修改，请重新打开排序后再试');
        let order;
        try {
          order = validateOrder(taxonomyItems(d, input.kind), input.order);
        } catch (e) {
          throw fail(409, e.message);
        }
        d[input.kind === 'category' ? 'categories' : 'tags'] = order;
        d.settings.preferences = { ...d.settings.preferences, [input.kind + 'Sort']: 'manual' };
        return { updated: true };
      });
      reply(res, 200, result);
      return true;
    }
    if (p === '/api/taxonomy' && req.method === 'POST') {
      const v = JSON.parse(await body(req));
      if (
        !['category', 'tag'].includes(v.kind) ||
        !['create', 'rename', 'remove', 'merge'].includes(v.action) ||
        typeof v.from !== 'string' ||
        typeof v.to !== 'string'
      )
        throw fail(400, '分类操作错误');
      const target = v.action === 'remove' ? '' : v.to.trim().slice(0, 60);
      if (v.action !== 'remove' && !target) throw fail(400, '请输入新名称');
      reply(
        res,
        200,
        await mutate((d) => {
          d.categories ||= [];
          d.tags ||= [];
          if (v.action === 'create') {
            const list = v.kind === 'category' ? d.categories : d.tags;
            if (!list.includes(target)) list.push(target);
            return { updated: true };
          }
          const names = taxonomyItems(d, v.kind).map((item) => item.name);
          if (!names.includes(v.from)) throw fail(409, '分类或标签已不存在，请刷新后重试');
          if (v.action === 'merge' && !names.includes(target))
            throw fail(409, '合并目标已不存在，请重新选择');
          const replacement = v.kind === 'category' ? target || '未分类' : target;
          if (replacement === v.from) return { updated: true };
          // Renames keep the source slot. Merges keep the existing destination slot.
          const order = names.includes(replacement)
            ? names.filter((name) => name !== v.from)
            : names.flatMap((name) =>
                name === v.from ? (replacement ? [replacement] : []) : [name],
              );
          for (const e of d.entries) {
            const before = structuredClone(e);
            let changed = false;
            if (v.kind === 'category' && e.category === v.from) {
              e.category = target || '未分类';
              changed = true;
            }
            if (v.kind === 'tag' && e.tags?.includes(v.from)) {
              e.tags = [
                ...new Set(e.tags.flatMap((t) => (t === v.from ? (target ? [target] : []) : [t]))),
              ];
              changed = true;
            }
            if (changed) {
              if (
                !Object.hasOwn(e, 'contentEditedAt') &&
                Number.isFinite(Date.parse(before.updatedAt))
              )
                e.contentEditedAt = before.updatedAt;
              if (v.kind === 'category' && e.chatJournal?.category === v.from) {
                e.chatJournal.category = replacement;
                if (before.chatJournal?.projectionHash === projectionHash(before))
                  e.chatJournal.projectionHash = projectionHash(e);
              }
              delete before.history;
              e.history = [before, ...(e.history || [])].slice(0, 20);
              e.revision++;
              e.updatedAt = new Date().toISOString();
            }
          }
          if (v.kind === 'category') {
            renameServiceCategory(d, v.from, replacement);
            if (d.revisit?.config?.categories?.includes(v.from)) {
              d.revisit.config.categories = [
                ...new Set(
                  d.revisit.config.categories.map((name) => (name === v.from ? replacement : name)),
                ),
              ];
              d.revisit.config.revision++;
            }
            for (const room of d.chatJournal?.rooms || [])
              if (room.category === v.from) room.category = replacement;
            d.categories = order;
            for (const template of d.templates || [])
              if (template.category === v.from) template.category = target;
            const prefs = d.settings?.preferences;
            if (prefs?.defaultCategory === v.from) prefs.defaultCategory = replacement;
            if (prefs?.memoryCategories)
              prefs.memoryCategories = [
                ...new Set(
                  prefs.memoryCategories.flatMap((c) =>
                    c === v.from ? (target ? [target] : []) : [c],
                  ),
                ),
              ];
          } else {
            d.tags = order;
          }
          return { updated: true };
        }),
      );
      return true;
    }
    return false;
  };
}
