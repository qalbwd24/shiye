import { createRoutes as revisitRoutes } from './revisit.mjs';
import { createConversationServiceHost } from '../conversation-services/host.mjs';
import {
  catalog,
  registry,
  instance,
  scope,
  scopedContext,
  createInstance,
  bindConversation,
  activeBinding,
} from '../conversation-services/registry.mjs';
import { describeCommentsForEntry } from '../domain/revisit/comments/query.mjs';
import { LIMITS } from '../../../public/shared/limits.js';
import { configureExternalProgram } from '../conversation-services/external-program.mjs';
import {
  readConversationSettings,
  saveConversationSettings,
} from '../conversation-services/settings.mjs';
import {
  describeConversation,
  saveConversation,
  readConversationFeed,
  conversationContext,
  sendConversationMessage,
  withdrawConversationMessage,
} from '../conversation-services/conversations.mjs';
import {
  directoryView,
  createDirectoryConversation,
  updateDirectoryState,
  saveDirectoryOrder,
} from '../conversation-services/directory.mjs';

const ACTIONS = {
  status: ['GET', ''],
  config: ['PUT', '/config'],
  tick: ['POST', '/tick'],
  feed: ['POST', '/feed'],
  source: ['POST', '/source'],
  media: ['POST', '/media'],
  context: ['POST', '/comments/context'],
  comment: ['POST', '/comments'],
  withdraw: ['POST', '/comments/withdraw'],
  comments: ['GET', '/comments'],
  'runner-status': ['GET', '/runner'],
  'runner-start': ['POST', '/runner/start'],
  'runner-stop': ['POST', '/runner/stop'],
};
export function createRoutes(context) {
  const { getDb, mutate, body, reply, fail } = context,
    manager = createConversationServiceHost(context);
  async function input(req) {
    const value = JSON.parse(await body(req, LIMITS.requestBytes));
    if (!value || Array.isArray(value) || typeof value !== 'object')
      throw fail(400, '请求须为对象');
    return value;
  }
  async function dispatch(req, res, id, method, suffix, payload) {
    const service = instance(getDb(), id);
    if (!Object.values(ACTIONS).some(([m, s]) => m === method && s === suffix))
      throw fail(404, '不支持的实例操作');
    if (payload === undefined && method !== 'GET') payload = await input(req);
    if (service.providerId === 'external-program') {
      if (method === 'GET' && suffix === '')
        return reply(res, 200, {
          config: structuredClone(service.state.config),
          scope: {
            instanceId: id,
            providerId: service.providerId,
            bindingId: activeBinding(getDb(), id)?.id || null,
          },
        });
      if (method === 'PUT' && suffix === '/config') {
        const result = await mutate((db) => {
          const current = instance(db, id);
          if (payload.expectedRevision !== current.state.config.revision)
            throw fail(409, '程序参数已变化');
          const { expectedRevision: _revision, ...value } = payload;
          current.state.config = configureExternalProgram(
            current.state.config,
            value,
            current.name,
          );
          registry(db).revision++;
          return structuredClone(current.state.config);
        });
        return reply(res, 200, result);
      }
      throw fail(400, '外部程序自行执行，通过会话消息接口读写；不使用朝花夕拾调度或来源接口');
    }
    if (suffix === '/tick' && !activeBinding(getDb(), id) && !payload?.manual)
      return reply(res, 200, {
        created: 0,
        disabled: true,
        cursor: scope(getDb(), id).revisit.cursor,
        scope: { instanceId: id, providerId: 'revisit' },
      });
    if (suffix === '/runner/start' && !activeBinding(getDb(), id))
      throw fail(409, '请先将独立实例绑定到会话');
    const scoped = scopedContext(context, id),
      binding = activeBinding(getDb(), id);
    const send = (response, status, value) =>
      reply(response, status, {
        ...value,
        scope: {
          instanceId: id,
          providerId: 'revisit',
          bindingId: binding?.id || null,
          bindingRevision: binding?.revision || null,
        },
      });
    const wrapped = {
      ...scoped,
      reply: send,
      ...(payload ? { body: async () => Buffer.from(JSON.stringify(payload)) } : {}),
    };
    const facade = payload
      ? {
          method,
          url:
            '/api/revisit' +
            suffix +
            (suffix === '/comments' && method === 'GET'
              ? '?entryId=' + encodeURIComponent(payload.entryId || '')
              : ''),
          headers: req.headers,
          socket: req.socket,
          async *[Symbol.asyncIterator]() {
            yield Buffer.from(JSON.stringify(payload));
          },
        }
      : req;
    if (suffix.startsWith('/runner')) {
      return manager.host(id).handle(facade, res, '/api/revisit' + suffix);
    }
    return revisitRoutes(wrapped)(facade, res, '/api/revisit' + suffix);
  }
  async function handle(req, res, p) {
    if (!p.startsWith('/api/conversation-services')) return false;
    if (p === '/api/conversation-services' && req.method === 'GET')
      return reply(res, 200, catalog(getDb()));
    if (p === '/api/conversation-services/conversations' && req.method === 'GET')
      return reply(res, 200, directoryView(getDb()));
    if (p === '/api/conversation-services/conversations' && req.method === 'POST') {
      const value = await input(req);
      return reply(res, 200, await mutate((db) => createDirectoryConversation(db, value)));
    }
    if (p === '/api/conversation-services/conversations/list-state' && req.method === 'PUT') {
      const value = await input(req);
      return reply(res, 200, await mutate((db) => updateDirectoryState(db, value)));
    }
    if (p === '/api/conversation-services/conversations/order' && req.method === 'PUT') {
      const value = await input(req);
      return reply(res, 200, await mutate((db) => saveDirectoryOrder(db, value)));
    }
    if (p === '/api/conversation-services/conversations/state' && req.method === 'POST')
      return reply(res, 200, describeConversation(getDb(), await input(req)));
    if (p === '/api/conversation-services/conversations/state' && req.method === 'PUT') {
      const value = await input(req);
      return reply(res, 200, await mutate((db) => saveConversation(db, value)));
    }
    if (p === '/api/conversation-services/conversations/feed' && req.method === 'POST')
      return reply(res, 200, readConversationFeed(getDb(), await input(req)));
    if (p === '/api/conversation-services/conversations/context' && req.method === 'POST')
      return reply(res, 200, conversationContext(getDb(), await input(req)));
    if (p === '/api/conversation-services/conversations/send' && req.method === 'POST') {
      const value = await input(req);
      return reply(
        res,
        200,
        await mutate((db) => sendConversationMessage(db, value, context.clock?.() ?? Date.now())),
      );
    }
    if (p === '/api/conversation-services/conversations/withdraw' && req.method === 'POST') {
      const value = await input(req);
      return reply(
        res,
        200,
        await mutate((db) =>
          withdrawConversationMessage(db, value, context.clock?.() ?? Date.now()),
        ),
      );
    }
    if (p === '/api/conversation-services/settings/read' && req.method === 'POST')
      return reply(res, 200, readConversationSettings(getDb(), await input(req)));
    if (p === '/api/conversation-services/settings/save' && req.method === 'POST') {
      const value = await input(req);
      return reply(res, 200, await mutate((db) => saveConversationSettings(db, value)));
    }
    if (p === '/api/conversation-services/instances' && req.method === 'POST') {
      const value = await input(req);
      return reply(res, 201, await mutate((db) => createInstance(db, value)));
    }
    if (p === '/api/conversation-services/bindings' && req.method === 'PUT') {
      const value = await input(req);
      return reply(res, 200, await mutate((db) => bindConversation(db, value)));
    }
    if (p === '/api/conversation-services/comments' && req.method === 'GET') {
      const entryId = new URL(req.url, 'http://localhost').searchParams.get('entryId');
      if (!entryId || entryId.length > 200) throw fail(400, '请指定日记编号');
      const db = getDb(),
        comments = [];
      for (const item of registry(db).instances.filter((item) => item.providerId === 'revisit'))
        for (const comment of describeCommentsForEntry(scope(db, item.id), entryId).comments)
          comments.push({ ...comment, instanceId: item.id, providerId: item.providerId });
      for (const comment of describeCommentsForEntry(db, entryId).comments)
        comments.push({ ...comment, instanceId: null, providerId: 'revisit' });
      comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      return reply(res, 200, { entryId, comments });
    }
    if (p === '/api/conversation-services/request' && req.method === 'POST') {
      const value = await input(req),
        action = Object.hasOwn(ACTIONS, value.action) ? ACTIONS[value.action] : null;
      if (
        !action ||
        !value.payload ||
        Array.isArray(value.payload) ||
        typeof value.payload !== 'object'
      )
        throw fail(400, '实例动作或内容不正确');
      return dispatch(req, res, value.instanceId, action[0], action[1], value.payload);
    }
    const match = /^\/api\/conversation-services\/instances\/([^/]+)\/revisit(\/.*)?$/.exec(p);
    if (match) return dispatch(req, res, match[1], req.method, match[2] || '');
    return false;
  }
  return { handle, autoStart: manager.autoStart, close: manager.close };
}
