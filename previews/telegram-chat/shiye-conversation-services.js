/* Atomic service settings only. Rules and operation receipts belong to the server. */
const copy = (value) => structuredClone(value);
const fail = (status, message) => Object.assign(new Error(message), { status });
const editable = {
  revisit: [
    'enabled',
    'title',
    'mode',
    'dailyTime',
    'interval',
    'timeZone',
    'categories',
    'sourceDateFrom',
    'sourceDateTo',
    'sender',
  ],
  'external-program': ['enabled', 'title', 'sender', 'kind', 'parameters'],
};
const available = (health) =>
  health?.conversationServices?.atomicConversationSettings >= 1 &&
  health?.conversationServices?.conversationMessaging >= 1;
const unavailable = '后台尚未启用原子会话设置与多人会话能力，暂不能保存接入；现有程序与进度保留。';

export function createConversationServicesPort({ request, sourceId }) {
  if (
    typeof request !== 'function' ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(sourceId || '')
  )
    throw new TypeError('固定服务通道及稳定来源编号必填');
  const conversationId = (roomId) => {
    if (!/^-?\d+$/.test(String(roomId))) throw fail(400, '会话编号不正确');
    return `desktop:${sourceId}:${roomId}`;
  };
  const target = ({ slotId, bindingId, roomId }, directory) => {
    if (bindingId) return { bindingId };
    if (slotId === undefined) {
      if (String(roomId) === '-900000001') return { slotId: 'revisit' };
      if (directory.bindings.length > 1)
        throw fail(409, '本会话有多个程序，请明确选择程序槽位或绑定');
      if (directory.bindings.length === 1) return { bindingId: directory.bindings[0].id };
    }
    const slot = slotId === undefined ? 'history' : slotId;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(slot))
      throw fail(400, '程序槽位只能使用1–64位字母、数字、下划线或横线');
    return { slotId: slot };
  };
  async function discover(roomId) {
    const id = conversationId(roomId);
    const health = await request('service-health', {}).catch((cause) => {
      if ([400, 404, 501].includes(cause.status)) return {};
      throw cause;
    });
    const catalog = await request('service-catalog', {});
    const canSave = available(health);
    const state = canSave ? await request('conversation-state', { conversationId: id }) : null;
    const bindings =
      state?.bindings || (catalog.bindings || []).filter((b) => b.conversationId === id);
    const instances = (catalog.instances || []).filter(
      (item) => item.conversationId === id || bindings.some((b) => b.instanceId === item.id),
    );
    return {
      conversationId: id,
      health,
      providers: copy(catalog.providers || []),
      participantModel: copy(catalog.participantModel || {}),
      bindings: copy(bindings),
      instances: copy(instances),
      programs: copy(
        state?.programs ||
          instances.map((i) => ({ instanceId: i.id, providerId: i.providerId, config: i.config })),
      ),
      participants: copy(state?.participants || []),
      state: copy(state),
      canSave,
      ...(canSave ? {} : { reason: unavailable }),
    };
  }
  async function readConversation({ roomId }) {
    return discover(roomId);
  }
  function decorate(value, directory, selection) {
    const actualProvider =
      value.providerId ||
      directory.instances.find((i) => i.id === value.instanceId)?.providerId ||
      null;
    const provider = directory.providers.find((p) => p.id === actualProvider);
    const supported =
      !actualProvider || (!!editable[actualProvider] && provider?.independentInstances === true);
    return {
      ...directory,
      ...copy(value),
      ...selection,
      config: copy(value.config || {}),
      providerId: value.providerId || null,
      instanceProviderId: actualProvider,
      canSave: directory.canSave && value.canSave !== false && supported,
      ...(!supported ? { reason: '当前客户端尚不支持此程序的参数编辑。' } : {}),
      scope:
        value.providerId && value.instanceId
          ? {
              instanceId: value.instanceId,
              providerId: value.providerId,
              bindingId: value.bindingId,
              bindingRevision: value.bindingRevision,
            }
          : null,
    };
  }
  async function readSettings(input) {
    const directory = await discover(input.roomId),
      selection = target(input, directory);
    if (!directory.canSave) {
      const binding = selection.bindingId
        ? directory.bindings.find((b) => b.id === selection.bindingId)
        : null;
      const instance = directory.instances.find((i) => i.id === binding?.instanceId);
      return decorate(
        {
          providerId: binding?.active ? instance?.providerId : null,
          instanceId: instance?.id,
          bindingId: binding?.id,
          bindingRevision: binding?.revision || 0,
          config: instance?.config,
          canSave: false,
        },
        directory,
        selection,
      );
    }
    const value = await request('service-settings-read', {
      conversationId: directory.conversationId,
      ...selection,
    });
    return decorate(value, directory, selection);
  }
  async function saveSettings(input) {
    const directory = await discover(input.roomId),
      selection = target(input, directory);
    if (!directory.canSave) throw fail(503, unavailable);
    const providerId = input.providerId || null;
    if (
      providerId &&
      (!editable[providerId] ||
        !directory.providers.some((p) => p.id === providerId && p.independentInstances))
    )
      throw fail(400, '当前目录未声明可编辑的此类程序');
    const config = providerId
      ? Object.fromEntries(
          editable[providerId]
            .filter((key) => Object.hasOwn(input.config || {}, key))
            .map((key) => [key, copy(input.config[key])]),
        )
      : undefined;
    if (providerId === 'external-program' && config.sender)
      config.sender = { name: config.sender.name };
    if (
      providerId === 'external-program' &&
      config.parameters !== undefined &&
      (!config.parameters ||
        typeof config.parameters !== 'object' ||
        Array.isArray(config.parameters) ||
        new TextEncoder().encode(JSON.stringify(config.parameters)).length > 16384)
    )
      throw fail(400, '公开JSON参数须为不超过16KiB的对象');
    const payload = {
      conversationId: directory.conversationId,
      ...selection,
      ...(input.instanceId ? { instanceId: input.instanceId } : {}),
      providerId,
      expectedBindingRevision: input.expectedBindingRevision ?? 0,
      ...(providerId ? { expectedConfigRevision: input.expectedConfigRevision ?? 0, config } : {}),
    };
    const saved = await request('service-settings-save', payload);
    return decorate(saved, directory, selection);
  }
  return { readConversation, readSettings, recoverSettings: readSettings, saveSettings };
}
