import { normalizeAppearance, normalizeLayout } from '../../../public/shared/appearance.js';
export function createRoutes({ mutate, body, reply, fail }) {
  return async (req, res, p) => {
    if (p === '/api/preferences' && req.method === 'PUT') {
      const input = JSON.parse(await body(req, 16384));
      const allowed = {
        categorySort: ['manual', 'name', 'count'],
        tagSort: ['manual', 'name', 'count'],
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
        } else if (key === 'appearance' || key === 'layout') {
          try {
            next[key] = key === 'appearance' ? normalizeAppearance(value) : normalizeLayout(value);
          } catch (e) {
            throw fail(400, e.message);
          }
        } else if (!allowed[key]?.includes(value)) throw fail(400, '设置值不正确');
        else next[key] = value;
      }
      reply(
        res,
        200,
        await mutate((d) => {
          for (const b of next.appearance?.backgrounds || []) {
            if (!d.media.some((m) => m.id === b.id && m.purpose === 'background'))
              throw fail(400, '背景图片不存在，请重新选择');
          }
          d.settings.preferences = { ...d.settings.preferences, ...next };
          return d.settings.preferences;
        }),
      );
      return true;
    }
    return false;
  };
}
