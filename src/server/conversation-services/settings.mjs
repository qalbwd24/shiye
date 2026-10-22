import { fail } from '../http.mjs';
import { digest } from '../domain/revisit/sources/identity.mjs';
import { configureRevisit } from '../domain/revisit/delivery/configuration.mjs';
import { registry, createInstance, bindConversation, instance, scope } from './registry.mjs';
import { configureExternalProgram } from './external-program.mjs';
import { revisitConfig } from '../domain/revisit/delivery/state.mjs';
export const LEGACY_SERVICE_ID = 'legacy-revisit';
export const isLegacyConversation = (id) => id.endsWith(':-900000001');

export function conversationId(input) {
  const id = input?.conversationId;
  if (
    typeof id !== 'string' ||
    !/^desktop:[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}:-?\d{1,20}$/.test(id)
  )
    throw fail(400, '稳定会话身份不正确');
  return id;
}
function stableId(value) {
  const h = digest(value).slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function readConversationSettings(db, input) {
  const id = conversationId(input);
  if (isLegacyConversation(id) && !input.bindingId && (!input.slotId || input.slotId === 'revisit'))
    return {
      conversationId: id,
      providerId: 'revisit',
      legacy: true,
      instanceId: LEGACY_SERVICE_ID,
      bindingRevision: 0,
      config: revisitConfig(db),
      categories: [...db.categories],
      canSave: true,
    };
  if (input.slotId !== undefined && !/^[a-zA-Z0-9_-]{1,64}$/.test(input.slotId))
    throw fail(400, '程序接入槽位不正确');
  const bindings = registry(db).bindings.filter((b) => b.conversationId === id);
  const requested =
    input.bindingId ||
    (input.slotId ? stableId(['conversation-binding', id, input.slotId]) : undefined);
  if (!requested && bindings.length > 1)
    throw fail(409, '本会话有多个程序，请指定bindingId或slotId');
  const binding = requested ? bindings.find((b) => b.id === requested) : bindings[0];
  if (input.bindingId && !binding) throw fail(404, '此绑定不属于当前会话');
  const service = binding ? instance(db, binding.instanceId) : undefined;
  return {
    conversationId: id,
    providerId: binding?.active ? service.providerId : null,
    instanceId: service?.id,
    bindingId: binding?.id,
    bindingRevision: binding?.revision || 0,
    config: service ? structuredClone(service.state.config) : undefined,
    categories: [...db.categories],
    canSave: true,
  };
}
export function saveConversationSettings(db, input) {
  const id = conversationId(input);
  if (
    !['revisit', 'external-program', null].includes(input.providerId) ||
    !Number.isSafeInteger(input.expectedBindingRevision)
  )
    throw fail(400, '程序接入参数不正确');
  const before = readConversationSettings(db, input);
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
  const key = digest(canonical(input));
  const receipt = registry(db).settingsOperations?.find((r) => r.key === key);
  if (receipt) {
    if (
      before.bindingRevision !== receipt.bindingRevision ||
      before.config?.revision !== receipt.configRevision
    )
      throw fail(409, '设置在上次提交后已变化，请重新读取');
    return before;
  }
  if (
    before.bindingRevision !== input.expectedBindingRevision ||
    (input.providerId !== null &&
      (before.config?.revision || 0) !== (input.expectedConfigRevision || 0))
  )
    throw fail(409, '会话程序设置已变化，请重新读取');
  if (input.providerId === null && !before.bindingId) throw fail(400, '当前会话尚未接入程序');
  if (before.legacy) {
    if (input.providerId !== 'revisit') throw fail(409, '保留原朝花夕拾连接，请用推送开关暂停');
    const cursor = db.revisit?.cursor,
      ruleRevision = revisitConfig(db).ruleRevision;
    configureRevisit(db, { ...input.config, expectedRevision: input.expectedConfigRevision });
    if (db.revisit.config.ruleRevision === ruleRevision) db.revisit.cursor = cursor || null;
    db.conversationServices ||= structuredClone(registry(db));
    const records = registry(db),
      saved = readConversationSettings(db, input);
    records.settingsOperations = [
      ...(records.settingsOperations || []),
      { key, bindingRevision: 0, configRevision: saved.config.revision },
    ].slice(-128);
    records.revision++;
    return saved;
  }
  if (input.instanceId && input.instanceId !== before.instanceId)
    throw fail(409, '会话服务实例已变化');
  if (input.bindingId && input.bindingId !== before.bindingId)
    throw fail(409, '会话服务绑定已变化');
  if (
    input.providerId &&
    before.instanceId &&
    instance(db, before.instanceId).providerId !== input.providerId
  )
    throw fail(409, '程序类型不能原地更换，请使用新槽位接入并保留原实例');
  const slot = input.slotId || input.providerId || 'revisit';
  const instanceId = before.instanceId || stableId(['conversation-instance', id, slot]);
  const bindingId = before.bindingId || stableId(['conversation-binding', id, slot]);
  if (input.providerId) {
    if (!before.instanceId)
      createInstance(db, {
        id: instanceId,
        providerId: input.providerId,
        name: input.config?.title || '朝花夕拾',
        config: input.config,
      });
    else if (input.providerId === 'external-program') {
      const service = instance(db, instanceId);
      service.state.config = configureExternalProgram(
        service.state.config,
        input.config,
        service.name,
      );
    } else {
      const state = instance(db, instanceId).state;
      const cursor = state.cursor,
        ruleRevision = state.config.ruleRevision;
      configureRevisit(scope(db, instanceId), {
        ...input.config,
        expectedRevision: input.expectedConfigRevision,
      });
      // Pause/resume changes delivery eligibility, not the persisted checkpoint.
      if (state.config.ruleRevision === ruleRevision) state.cursor = cursor;
    }
  }
  bindConversation(db, {
    id: bindingId,
    conversationId: id,
    instanceId: input.providerId ? instanceId : null,
    expectedRevision: input.expectedBindingRevision,
  });
  const saved = readConversationSettings(db, { ...input, bindingId });
  const records = registry(db);
  records.settingsOperations = [
    ...(records.settingsOperations || []),
    { key, bindingRevision: saved.bindingRevision, configRevision: saved.config?.revision },
  ].slice(-128);
  records.revision++;
  return saved;
}
