import { taxonomyItems, validateOrder } from '../../../public/shared/taxonomy.js';
export function createRoutes({ mutate, body, reply, fail }) {
  return async (req, res, p) => {
    if (p === '/api/taxonomy/order' && req.method === 'PUT') {
      const input = JSON.parse(await body(req));
      if (!['category', 'tag'].includes(input.kind)) throw fail(400, '排序类型错误');
      const result = await mutate((d) => {
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
      const target = v.to.trim().slice(0, 60);
      if (v.action !== 'remove' && !target) throw fail(400, '请输入新名称');
      reply(
        res,
        200,
        await mutate((d) => {
          d.tags ||= [];
          if (v.action === 'create') {
            const list = v.kind === 'category' ? d.categories : d.tags;
            if (!list.includes(target)) list.push(target);
            return { updated: true };
          }
          for (const e of d.entries) {
            const before = structuredClone(e);
            let changed = false;
            if (v.kind === 'category' && e.category === v.from) {
              e.category = target || '未分类';
              changed = true;
            }
            if (v.kind === 'tag' && e.tags.includes(v.from)) {
              e.tags = [
                ...new Set(e.tags.flatMap((t) => (t === v.from ? (target ? [target] : []) : [t]))),
              ];
              changed = true;
            }
            if (changed) {
              delete before.history;
              e.history = [before, ...e.history].slice(0, 20);
              e.revision++;
              e.updatedAt = new Date().toISOString();
            }
          }
          if (v.kind === 'category') {
            d.categories = d.categories.filter((c) => c !== v.from);
            if (!d.categories.includes(target || '未分类')) d.categories.push(target || '未分类');
            for (const template of d.templates || [])
              if (template.category === v.from) template.category = target;
            const prefs = d.settings?.preferences;
            if (prefs?.memoryCategories)
              prefs.memoryCategories = [
                ...new Set(
                  prefs.memoryCategories.flatMap((c) =>
                    c === v.from ? (target ? [target] : []) : [c],
                  ),
                ),
              ];
          } else {
            d.tags = d.tags.filter((t) => t !== v.from);
            if (target && !d.tags.includes(target)) d.tags.push(target);
          }
          return { updated: true };
        }),
      );
      return true;
    }
    return false;
  };
}
