import { randomUUID } from 'node:crypto';
export function createRoutes({ mutate, body, reply, fail }) {
  return async (req, res, p) => {
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
