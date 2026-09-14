import { randomUUID } from 'node:crypto';
export function offlineRoutes({ mutate, body, reply, fail }) {
  return async (req, res, p) => {
    if (p === '/api/preferences' && req.method === 'PUT') {
      const input = JSON.parse(await body(req, 16384));
      const allowed = {
        theme: ['light', 'dark', 'system'],
        fontSize: [14, 16, 18, 20, 22, 24],
        lineHeight: [1.6, 1.8, 2, 2.2, 2.5],
        fontFamily: ['sans', 'serif', 'mono'],
        sort: ['newest', 'oldest', 'updated'],
        memoryPeriod: [1, 3, 6, 12],
        autoLockMinutes: [0, 1, 5, 15],
        openView: ['all', 'calendar', 'new'],
        firstWeekday: [0, 1],
        showPreview: [true, false],
        nightYesterday: [true, false],
        autoIndent: [true, false],
      };
      const next = {};
      for (const [key, value] of Object.entries(input)) {
        if (key === 'memoryCategories') {
          if (!Array.isArray(value) || value.some((c) => typeof c !== 'string'))
            throw fail(400, '分类格式错误');
          next[key] = value;
        } else if (key === 'reminderText') {
          if (typeof value !== 'string' || value.length > 200) throw fail(400, '提醒内容过长');
          next[key] = value;
        } else if (key === 'reminderTime') {
          if (value !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
            throw fail(400, '提醒时间错误');
          next[key] = value;
        } else if (!allowed[key]?.includes(value)) throw fail(400, '设置值不正确');
        else next[key] = value;
      }
      reply(
        res,
        200,
        await mutate((d) => {
          d.settings.preferences = { ...d.settings.preferences, ...next };
          return d.settings.preferences;
        }),
      );
      return true;
    }
    if (p === '/api/taxonomy' && req.method === 'POST') {
      const v = JSON.parse(await body(req));
      if (
        !['category', 'tag'].includes(v.kind) ||
        !['rename', 'remove', 'merge'].includes(v.action) ||
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
          }
          return { updated: true };
        }),
      );
      return true;
    }
    if (p === '/api/templates' && req.method === 'POST') {
      const v = JSON.parse(await body(req));
      if (
        typeof v.name !== 'string' ||
        !v.name.trim() ||
        typeof v.content !== 'string' ||
        v.content.length > 100000
      )
        throw fail(400, '模板内容不正确');
      reply(
        res,
        201,
        await mutate((d) => {
          d.templates ||= [];
          const t = {
            id: randomUUID(),
            name: v.name.trim().slice(0, 80),
            content: v.content,
            category: String(v.category || ''),
          };
          d.templates.push(t);
          return t;
        }),
      );
      return true;
    }
    const tm = p.match(/^\/api\/templates\/([a-f0-9-]+)$/);
    if (tm && req.method === 'PUT') {
      const v = JSON.parse(await body(req));
      reply(
        res,
        200,
        await mutate((d) => {
          const t = d.templates?.find((x) => x.id === tm[1]);
          if (!t) throw fail(404, '模板不存在');
          if (v.deleted !== undefined) t.deleted = !!v.deleted;
          if (typeof v.name === 'string' && v.name.trim()) t.name = v.name.trim().slice(0, 80);
          if (typeof v.content === 'string' && v.content.length < 100000) t.content = v.content;
          if (typeof v.category === 'string') t.category = v.category;
          return t;
        }),
      );
      return true;
    }
    return false;
  };
}
