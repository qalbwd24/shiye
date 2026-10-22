import { fail } from '../http.mjs';
import { LIMITS } from '../../../public/shared/limits.js';
import { configureRevisit } from '../domain/revisit/delivery/configuration.mjs';
import { emptyRevisitState } from '../domain/revisit/delivery/state.mjs';
import { digest } from '../domain/revisit/sources/identity.mjs';
import { configureExternalProgram } from './external-program.mjs';

export const isServiceId = (id) =>
  typeof id === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
export function registry(db) {
  const value = db.conversationServices;
  if (
    value &&
    (value.version !== 1 ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      !Array.isArray(value.instances) ||
      !Array.isArray(value.bindings) ||
      (value.conversations !== undefined &&
        (!Array.isArray(value.conversations) ||
          value.conversations.some(
            (c) =>
              !c ||
              typeof c.id !== 'string' ||
              !Number.isSafeInteger(c.revision) ||
              c.revision < 1 ||
              !['session', 'group'].includes(c.mode) ||
              typeof c.title !== 'string' ||
              typeof c.selfName !== 'string',
          ))) ||
      (value.settingsOperations !== undefined &&
        (!Array.isArray(value.settingsOperations) ||
          value.settingsOperations.some(
            (r) =>
              !r ||
              !/^[a-f0-9]{64}$/.test(r.key) ||
              !Number.isSafeInteger(r.bindingRevision) ||
              r.bindingRevision < 0 ||
              !Number.isSafeInteger(r.configRevision) ||
              r.configRevision < 1,
          ))))
  )
    throw fail(409, '会话服务数据版本或结构不支持，原记录已保留');
  return value || { version: 1, revision: 0, instances: [], bindings: [] };
}
const writable = (db) => (db.conversationServices ||= structuredClone(registry(db)));
export function instance(db, id) {
  if (!isServiceId(id)) throw fail(400, '服务实例编号不正确');
  const result = registry(db).instances.find((item) => item.id === id);
  if (!result) throw fail(404, '服务实例不存在');
  return result;
}
export const activeBinding = (db, id) =>
  registry(db).bindings.find((b) => b.instanceId === id && b.active);
export function serviceScope(db, id) {
  const binding = activeBinding(db, id);
  return {
    instanceId: id,
    providerId: instance(db, id).providerId,
    bindingId: binding?.id || null,
    bindingRevision: binding?.revision || null,
  };
}
export function scope(db, id) {
  return { ...db, revisit: instance(db, id).state, revisitInstanceId: id };
}
export function scopedContext(context, id) {
  return {
    ...context,
    getDb: () => scope(context.getDb(), id),
    mutate: (operation, options) =>
      context.mutate(
        (db) => {
          const view = scope(db, id);
          const result = operation(view);
          if (result?.then) throw new TypeError('服务事务必须同步完成');
          instance(db, id).state = view.revisit;
          return result;
        },
        options?.preflight
          ? { ...options, preflight: (db) => options.preflight(scope(db, id)) }
          : options,
      ),
  };
}
const CONFIG_KEYS = new Set([
  'enabled',
  'title',
  'mode',
  'dailyTime',
  'sourceDateFrom',
  'sourceDateTo',
  'interval',
  'timeZone',
  'categories',
  'sender',
]);
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
export function createInstance(db, input) {
  if (
    !input ||
    !isServiceId(input.id) ||
    !['revisit', 'external-program'].includes(input.providerId) ||
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    input.name.length > 80 ||
    !input.config ||
    typeof input.config !== 'object' ||
    Array.isArray(input.config) ||
    (input.providerId === 'revisit' && Object.keys(input.config).some((k) => !CONFIG_KEYS.has(k)))
  )
    throw fail(400, '实例参数或后端类型不正确');
  const creationKey = digest(canonical(input));
  const old = registry(db).instances.find((x) => x.id === input.id);
  if (old) {
    if (old.creationKey !== creationKey) throw fail(409, '该实例编号已用于其他创建参数');
    return describeInstance(old);
  }
  if (registry(db).instances.length >= LIMITS.conversationServiceInstances)
    throw fail(400, '服务实例数量已达上限');
  const view = { ...db, revisit: emptyRevisitState(), revisitInstanceId: input.id };
  if (input.providerId === 'revisit')
    configureRevisit(view, {
      expectedRevision: 1,
      mode: 'daily-random',
      dailyTime: '08:00',
      ...input.config,
    });
  else view.revisit.config = configureExternalProgram(undefined, input.config, input.name.trim());
  const item = {
    id: input.id,
    providerId: input.providerId,
    name: input.name.trim(),
    creationKey,
    state: view.revisit,
  };
  const state = writable(db);
  state.instances.push(item);
  state.revision++;
  return describeInstance(item);
}
export const describeInstance = (item) => ({
  id: item.id,
  providerId: item.providerId,
  name: item.name,
  ...(item.conversationId ? { conversationId: item.conversationId } : {}),
  config: structuredClone(item.state.config),
});
export function bindConversation(db, input) {
  if (
    !input ||
    !isServiceId(input.id) ||
    typeof input.conversationId !== 'string' ||
    !input.conversationId.trim() ||
    input.conversationId.length > 200 ||
    /[\u0000-\u001f]/.test(input.conversationId) ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    (input.instanceId !== null && !isServiceId(input.instanceId))
  )
    throw fail(400, '会话绑定参数不正确');
  const records = registry(db),
    old = records.bindings.find((b) => b.id === input.id);
  if (old && old.conversationId !== input.conversationId) throw fail(409, '绑定不能改为另一个会话');
  const unchanged =
    old &&
    old.active === (input.instanceId !== null) &&
    (input.instanceId === null || old.instanceId === input.instanceId);
  if ((old?.revision || 0) !== input.expectedRevision) {
    if (unchanged && old.revision === input.expectedRevision + 1) return structuredClone(old);
    throw fail(409, '会话绑定已变化，请重新读取');
  }
  if (input.instanceId !== null) {
    const service = instance(db, input.instanceId);
    const owner =
      service.conversationId ||
      records.bindings.find((b) => b.instanceId === service.id)?.conversationId;
    if (owner && owner !== input.conversationId)
      throw fail(409, '历史程序实例不能改属另一会话，请创建独立实例');
    if (
      records.bindings.some(
        (b) => b.active && b.id !== input.id && b.instanceId === input.instanceId,
      )
    )
      throw fail(409, '每个程序实例只属于一个会话；此实例已有其他绑定');
  }
  if (!old && input.instanceId === null) throw fail(400, '不能解除不存在的绑定');
  if (!old && records.bindings.length >= LIMITS.conversationServiceBindings)
    throw fail(400, '会话绑定数量已达上限');
  if (
    old &&
    old.active === (input.instanceId !== null) &&
    (input.instanceId === null || old.instanceId === input.instanceId)
  )
    return structuredClone(old);
  const next = {
    id: input.id,
    conversationId: input.conversationId,
    instanceId: input.instanceId ?? old.instanceId,
    active: input.instanceId !== null,
    revision: (old?.revision || 0) + 1,
  };
  const state = writable(db),
    index = state.bindings.findIndex((b) => b.id === input.id);
  if (old) instance(db, old.instanceId).conversationId ||= old.conversationId;
  if (input.instanceId) instance(db, input.instanceId).conversationId ||= input.conversationId;
  if (index === -1) state.bindings.push(next);
  else state.bindings[index] = next;
  const conversation = state.conversations?.find((c) => c.id === input.conversationId);
  if (input.instanceId && conversation && conversation.mode !== 'group') {
    conversation.mode = 'group';
    conversation.revision++;
  }
  state.revision++;
  return structuredClone(next);
}
export function catalog(db) {
  const r = registry(db);
  return structuredClone({
    version: 1,
    revision: r.revision,
    sharedDirectory: {
      version: 1,
      endpoint: '/api/conversation-services/conversations',
      shared: ['pinned', 'archived', 'order'],
      sameBusinessStore: true,
    },
    participantModel: {
      version: 1,
      roles: ['self', 'program', 'ai'],
      multipleProgramsPerConversation: true,
      atomicSettings: true,
      messaging: 'conversation-services-v1',
      aiExecution: false,
    },
    providers: [
      {
        id: 'revisit',
        name: '朝花夕拾',
        version: 1,
        independentInstances: true,
        configuration: {
          modes: ['daily-random', 'interval'],
          dailyTimeDefault: '08:00',
          sourceDateFrom: { type: 'date', nullable: true, inclusive: true },
          sourceDateTo: { type: 'date', nullable: true, inclusive: true },
          timeZones: ['Asia/Shanghai', 'system'],
          categories: db.categories,
        },
        capabilities: ['feed', 'source', 'media', 'comment', 'withdraw', 'runner'],
      },
      {
        id: 'external-program',
        name: '外部程序／AI（消息接口）',
        version: 1,
        independentInstances: true,
        execution: 'external',
        configuration: { roles: ['program', 'ai'], parametersMaxBytes: 16384 },
        capabilities: ['conversation-read', 'conversation-send', 'config'],
        aiExecution: false,
      },
    ],
    instances: r.instances.map(describeInstance),
    bindings: r.bindings,
    conversations: r.conversations || [],
    legacy: {
      providerId: 'revisit',
      endpoint: '/api/revisit',
      compatible: true,
      config: db.revisit?.config || null,
    },
  });
}

/** Taxonomy labels are mutable; rename filters without resetting replay/comment identities. */
export function renameServiceCategory(db, from, to) {
  for (const item of registry(db).instances) {
    const config = item.state.config;
    if (item.providerId === 'revisit' && config.categories.includes(from)) {
      config.categories = [
        ...new Set(config.categories.map((name) => (name === from ? to : name))),
      ];
      config.revision++;
    }
  }
}
