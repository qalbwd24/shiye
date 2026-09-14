import { commands } from '../../../public/shared/hotkeys.js';

export function createRoutes({ mutate, body, reply, fail }) {
  return async (req, res, p) => {
    if (p === '/api/settings' && req.method === 'PUT') {
      const input = JSON.parse((await body(req, 16384)).toString('utf8'));
      const allowed = new Set(commands.map((command) => command.id));
      if (
        !input.shortcuts ||
        typeof input.shortcuts !== 'object' ||
        Array.isArray(input.shortcuts) ||
        Object.entries(input.shortcuts).some(
          ([k, v]) => !allowed.has(k) || (v !== null && (typeof v !== 'string' || v.length > 60)),
        )
      )
        throw fail(400, '快捷键设置格式不正确');
      return reply(
        res,
        200,
        await mutate((d) => {
          d.settings = { ...d.settings, shortcuts: input.shortcuts };
          return d.settings;
        }),
      );
    }

    return false;
  };
}
