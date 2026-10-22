/* Settings views only. Service rules, identities and operation receipts are authoritative remotely. */
const LEGACY_ROOM = '-900000001';
const copy = (value) => structuredClone(value);
const isLegacy = (room, target = {}) =>
  String(room.id) === LEGACY_ROOM &&
  !target.bindingId &&
  (target.legacy || !target.slotId || target.slotId === 'revisit');
const defaults = (room, providerId) =>
  providerId === 'external-program'
    ? {
        enabled: false,
        title: '外部程序',
        sender: { name: '外部程序' },
        kind: 'program',
        parameters: {},
      }
    : {
        enabled: false,
        title: room.title || '朝花夕拾',
        mode: 'daily-random',
        dailyTime: '08:00',
        interval: { unit: 'year', count: 1 },
        timeZone: 'Asia/Shanghai',
        categories: [],
        sourceDateFrom: null,
        sourceDateTo: null,
        sender: { id: 'revisit', name: '过去的我', avatarAssetId: null },
      };
const known = (id) => ['revisit', 'external-program'].includes(id);

export function roomServicePort() {
  const actual = () => window.shiyeConversationServicesPort;
  return {
    async readConversation(room) {
      const directory = actual()?.readConversation
        ? await actual().readConversation({ roomId: String(room.id) })
        : {
            providers: [],
            programs: [],
            bindings: [],
            participants: [],
            canSave: false,
            reason: '会话服务通道尚未就绪',
          };
      if (String(room.id) !== LEGACY_ROOM) return directory;
      const legacy = await this.readSettings(room, { legacy: true });
      return {
        ...directory,
        programs: [
          {
            instanceId: 'legacy-revisit',
            providerId: 'revisit',
            legacy: true,
            config: legacy.config,
          },
          ...(directory.programs || []).filter((p) => p.instanceId !== 'legacy-revisit'),
        ],
      };
    },
    async readSettings(room, target = {}) {
      if (isLegacy(room, target))
        return {
          ...(await window.shiyeJournal.program('status')),
          providerId: 'revisit',
          instanceProviderId: 'revisit',
          legacy: true,
          canSave: true,
          slotId: 'revisit',
        };
      if (!actual()?.readSettings)
        return { config: {}, canSave: false, reason: '会话服务通道尚未就绪' };
      return actual().readSettings({ roomId: String(room.id), ...target });
    },
    async saveSettings(room, value) {
      if (isLegacy(room, value)) {
        if (value.providerId !== 'revisit') throw Error('原朝花夕拾连接请用推送开关暂停');
        const config = await window.shiyeJournal.program('config', {
          ...value.config,
          expectedRevision: value.expectedConfigRevision,
        });
        return {
          config,
          providerId: 'revisit',
          instanceProviderId: 'revisit',
          legacy: true,
          canSave: true,
        };
      }
      if (!actual()?.saveSettings) throw Error('会话服务通道尚未就绪');
      // Host wrapper resolves only after syncServices acknowledges the local routing table.
      return actual().saveSettings({ roomId: String(room.id), ...value });
    },
    async recoverSettings(room, target = {}) {
      if (isLegacy(room, target)) return this.readSettings(room, target);
      if (!actual()?.recoverSettings) return this.readSettings(room, target);
      return actual().recoverSettings({ roomId: String(room.id), ...target });
    },
  };
}
function label(text, control) {
  const element = document.createElement('label');
  control.setAttribute('aria-label', text);
  element.append(document.createTextNode(text), control);
  return element;
}
function select(items) {
  const element = document.createElement('select');
  for (const [value, name] of items) element.add(new Option(name, value));
  return element;
}
function input(type, name) {
  const element = document.createElement('input');
  element.type = type;
  element.name = name;
  return element;
}
function button(text) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = text;
  return element;
}

export function mountRoomServices({
  room,
  parent,
  container,
  port = roomServicePort(),
  categories = [],
}) {
  room = copy(room);
  const settings = window.shiyeSettingsUi;
  const section = document.createElement('fieldset');
  section.className = 'shiye-room-services';
  section.dataset.roomId = String(room.id);
  const legend = document.createElement('legend');
  legend.textContent = '参与者与程序';
  const participants = document.createElement('ul');
  participants.setAttribute('aria-label', '本会话参与者');
  const programs = document.createElement('div');
  programs.setAttribute('aria-label', '本会话程序');
  const summary = document.createElement('p');
  summary.role = 'status';
  const provider = select([]);
  provider.setAttribute('aria-label', '新增程序类型');
  const slot = input('text', '');
  slot.value = 'history';
  slot.pattern = '[A-Za-z0-9_-]{1,64}';
  slot.maxLength = 64;
  const add = button('配置接入');
  const hint = document.createElement('p');
  hint.textContent =
    '一个会话可接入多个程序。槽位标识在所有窗口共用，保存后固定；会话资料与程序参数分别保存。外部程序／AI需外部执行器，此处只登记角色和参数。';
  section.append(
    legend,
    participants,
    programs,
    summary,
    label('新增程序', provider),
    label('程序槽位', slot),
    add,
    hint,
  );
  container.append(section);
  for (const event of ['input', 'change'])
    section.addEventListener(event, (e) => e.stopPropagation());
  let directory,
    generation = 0,
    disposed = false;
  const channel =
    typeof BroadcastChannel === 'function'
      ? new BroadcastChannel('shiye-service-settings-changed')
      : null;
  const changed = (target) => {
    channel?.postMessage({
      roomId: String(room.id),
      bindingId: target.bindingId,
      slotId: target.slotId,
    });
    window.dispatchEvent(
      new CustomEvent('shiye-room-service-saved', { detail: { roomId: String(room.id) } }),
    );
  };
  async function refresh() {
    const token = ++generation;
    if (!room.id) {
      add.disabled = true;
      summary.textContent = '请先保存会话，再接入程序。';
      return;
    }
    try {
      const value = await port.readConversation(room);
      if (disposed || token !== generation) return;
      directory = copy(value);
      participants.replaceChildren();
      programs.replaceChildren();
      for (const actor of directory.participants || []) {
        const row = document.createElement('li');
        row.textContent = `${actor.name} · ${actor.kind === 'self' ? '本人' : actor.kind === 'ai' ? 'AI角色（需外部执行器）' : '程序'}${actor.active === false ? ' · 已暂停或解除' : ''}`;
        participants.append(row);
      }
      if (!participants.children.length) {
        const self = document.createElement('li');
        self.textContent = '我 · 本人';
        participants.append(self);
      }
      for (const program of directory.programs || []) {
        const binding = directory.bindings?.find((b) => b.instanceId === program.instanceId);
        const target = program.legacy
          ? { legacy: true, slotId: 'revisit' }
          : { bindingId: binding?.id };
        const open = button(
          `${program.config?.title || program.providerId} · ${program.legacy || binding?.active ? '已接入' : '已解除，进度保留'} · 设置`,
        );
        open.dataset.serviceInstance = program.instanceId;
        open.disabled = !program.legacy && !binding;
        open.onclick = () => openEditor(target, program.providerId);
        programs.append(open);
      }
      const previous = provider.value;
      provider.replaceChildren();
      for (const item of directory.providers || []) {
        const option = new Option(item.name || item.id, item.id);
        option.disabled = !known(item.id) || !item.independentInstances;
        provider.add(option);
      }
      if ([...provider.options].some((o) => o.value === previous && !o.disabled))
        provider.value = previous;
      add.disabled = !directory.canSave || !known(provider.value);
      provider.disabled = slot.disabled = !directory.canSave;
      summary.textContent =
        directory.reason ||
        `当前会话：${directory.state?.mode === 'group' ? '群聊' : '个人记录'}。选择已有程序分别设置，或使用新的固定槽位接入另一程序。`;
    } catch (error) {
      if (disposed || token !== generation) return;
      add.disabled = true;
      summary.textContent = '读取失败：' + error.message;
    }
  }
  provider.onchange = () => {
    slot.value = provider.value === 'external-program' ? 'assistant' : 'history';
    add.disabled = !directory?.canSave || !known(provider.value);
  };
  add.onclick = () => {
    if (!slot.checkValidity() || !slot.value) {
      summary.textContent = '槽位须为1–64位字母、数字、下划线或横线';
      return;
    }
    if (String(room.id) === LEGACY_ROOM && slot.value === 'revisit') {
      summary.textContent = 'revisit槽位是原朝花夕拾连接，请从已有程序进入。';
      return;
    }
    return openEditor({ slotId: slot.value }, provider.value);
  };
  if (channel)
    channel.onmessage = ({ data }) => {
      if (data?.roomId !== String(room.id)) return;
      refresh();
      for (const page of document.querySelectorAll(
        `[data-service-room="${CSS.escape(String(room.id))}"]`,
      )) {
        if (page.dataset.settingsDirty === 'true')
          page.querySelector('[data-service-status]').textContent =
            '其他窗口更新了会话程序；本页草稿保留，保存时校验版本。';
        else page.settingsResume?.();
      }
    };

  async function openEditor(target, requestedProvider) {
    const providerName =
      requestedProvider === 'revisit'
        ? '朝花夕拾'
        : requestedProvider === 'external-program'
          ? '外部程序／AI'
          : '程序';
    const page = settings.open({
      page: `service-${room.id}-${target.bindingId || target.slotId}`,
      parent,
      title: providerName + '设置',
      content: '',
      explicit: true,
      autosave: false,
    });
    if (page.dataset.settingsRestored === 'true') return;
    page.dataset.serviceRoom = String(room.id);
    const body = page.querySelector('[data-settings-body]');
    const form = document.createElement('form');
    form.className = 'shiye-conversation-service-form';
    const status = document.createElement('p');
    status.dataset.serviceStatus = '';
    status.role = 'status';
    const fields = {},
      common = document.createElement('div'),
      revisit = document.createElement('div'),
      external = document.createElement('div');
    fields.enabled = input('checkbox', 'enabled');
    fields.title = input('text', 'title');
    fields.sender = input('text', 'sender');
    for (const key of ['title', 'sender']) {
      fields[key].required = true;
      fields[key].maxLength = 80;
    }
    common.append(
      label('开启此程序', fields.enabled),
      label('程序标题', fields.title),
      label('发送者名称', fields.sender),
    );
    fields.mode = select([
      ['daily-random', '每日随机回看一天'],
      ['interval', '按间隔回看'],
    ]);
    fields.dailyTime = input('time', 'dailyTime');
    fields.count = input('number', 'count');
    fields.count.min = '1';
    fields.count.max = '3660';
    fields.unit = select([
      ['year', '年'],
      ['month', '月'],
      ['day', '天'],
    ]);
    fields.timeZone = select([
      ['Asia/Shanghai', '北京时间'],
      ['system', '跟随系统时间'],
    ]);
    fields.categories = select([]);
    fields.categories.multiple = true;
    fields.sourceDateFrom = input('date', 'sourceDateFrom');
    fields.sourceDateTo = input('date', 'sourceDateTo');
    const clock = label('每天更换历史日期的时间', fields.dailyTime),
      interval = document.createElement('label');
    interval.textContent = '回看间隔';
    interval.append(fields.count, fields.unit);
    const range = document.createElement('details'),
      rangeTitle = document.createElement('summary');
    rangeTitle.textContent = '历史日期范围（留空不限）';
    range.append(
      rangeTitle,
      label('开始日期', fields.sourceDateFrom),
      label('结束日期', fields.sourceDateTo),
    );
    revisit.append(
      label('回看方式', fields.mode),
      clock,
      interval,
      label('时区', fields.timeZone),
      label('回看分类（不选为全部）', fields.categories),
      range,
    );
    fields.kind = select([
      ['program', '程序角色'],
      ['ai', 'AI角色'],
    ]);
    fields.parameters = document.createElement('textarea');
    fields.parameters.name = 'parameters';
    fields.parameters.rows = 8;
    const externalHint = document.createElement('p');
    externalHint.textContent =
      '需外部执行器。此处只保存角色与公开JSON参数，不运行AI、脚本或URL；普通会话消息写口尚未切换。请勿填入密钥。';
    external.append(
      externalHint,
      label('角色类型', fields.kind),
      label('公开JSON参数（最多16KiB）', fields.parameters),
    );
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = '保存程序设置';
    const detach = button('解除此程序接入'),
      reload = button('放弃本页更改并重新读取'),
      reconcile = button('保留草稿并重新读取版本');
    reconcile.hidden = true;
    const actions = document.createElement('div');
    actions.className = 'shiye-actions';
    actions.append(save, detach, reconcile, reload);
    form.append(common, revisit, external, status, actions);
    body.append(form);
    let base,
      activeProvider = requestedProvider,
      saving = false,
      loadGeneration = 0,
      draftGeneration = 0;
    for (const event of ['input', 'change'])
      form.addEventListener(event, () => {
        draftGeneration++;
      });
    const modeChanged = () => {
      const isRevisit = activeProvider === 'revisit';
      clock.hidden = range.hidden = fields.mode.value !== 'daily-random';
      interval.hidden = !clock.hidden;
      fields.dailyTime.required = !clock.hidden && isRevisit;
      fields.count.required = !interval.hidden && isRevisit;
      fields.dailyTime.disabled = saving || !isRevisit || clock.hidden;
      for (const key of ['count', 'unit'])
        fields[key].disabled = saving || !isRevisit || interval.hidden;
      for (const key of ['sourceDateFrom', 'sourceDateTo'])
        fields[key].disabled = saving || !isRevisit || range.hidden;
      for (const key of ['mode', 'timeZone', 'categories'])
        fields[key].disabled = saving || !isRevisit;
      for (const key of ['kind', 'parameters'])
        fields[key].disabled = saving || activeProvider !== 'external-program';
    };
    fields.mode.onchange = modeChanged;
    function fill(value) {
      base = copy(value);
      activeProvider = value.instanceProviderId || value.providerId || requestedProvider;
      const config = { ...defaults(room, activeProvider), ...value.config };
      fields.enabled.checked = !!config.enabled;
      fields.title.value = config.title || '';
      fields.sender.value = config.sender?.name || '';
      const isRevisit = activeProvider === 'revisit';
      revisit.hidden = !isRevisit;
      external.hidden = activeProvider !== 'external-program';
      if (isRevisit) {
        for (const key of ['mode', 'dailyTime', 'timeZone']) fields[key].value = config[key];
        fields.count.value = config.interval?.count || 1;
        fields.unit.value = config.interval?.unit || 'year';
        fields.sourceDateFrom.value = config.sourceDateFrom || '';
        fields.sourceDateTo.value = config.sourceDateTo || '';
        fields.categories.replaceChildren();
        for (const name of value.categories?.length ? value.categories : categories) {
          const option = new Option(name, name);
          option.selected = (config.categories || []).includes(name);
          fields.categories.add(option);
        }
      } else {
        fields.kind.value = config.kind || 'program';
        fields.parameters.value = JSON.stringify(config.parameters || {}, null, 2);
      }
      save.disabled = !value.canSave || !known(activeProvider);
      detach.hidden = !!value.legacy || !value.providerId;
      detach.disabled = !value.canSave;
      status.textContent = value.reason || '修改后明确保存；解除接入会保留消息、实例与进度。';
      modeChanged();
    }
    async function read(preserveDraft, recover = true) {
      if (saving) return;
      const token = ++loadGeneration,
        draftAtStart = draftGeneration;
      try {
        const value = await (recover && port.recoverSettings
          ? port.recoverSettings(room, target)
          : port.readSettings(room, target));
        if (token !== loadGeneration || !page.isConnected) return;
        if (
          draftGeneration !== draftAtStart ||
          (!recover && page.dataset.settingsDirty === 'true')
        ) {
          reconcile.hidden = false;
          status.textContent = '读取期间有新输入，当前草稿保留。请重新读取版本后再决定是否保存。';
          return;
        }
        if (preserveDraft) {
          base = copy(value);
          save.disabled = !base.canSave || !known(activeProvider);
          status.textContent = '已读取当前版本；草稿保留，再次点击保存才会提交。';
        } else {
          fill(value);
          settings.saved(page);
        }
        reconcile.hidden = true;
      } catch (error) {
        status.textContent = '读取失败，草稿保留：' + error.message;
      }
    }
    reload.onclick = () => read(false);
    reconcile.onclick = () => read(true);
    page.settingsResume = async () => {
      if (saving || page.dataset.settingsDirty === 'true') return;
      await read(false, false);
    };
    async function persist(detaching) {
      if (saving || !base?.canSave) return;
      let config;
      try {
        if (!detaching) {
          config = {
            enabled: fields.enabled.checked,
            title: fields.title.value,
            sender: { name: fields.sender.value },
          };
          if (activeProvider === 'external-program') {
            const parameters = JSON.parse(fields.parameters.value);
            if (
              !parameters ||
              typeof parameters !== 'object' ||
              Array.isArray(parameters) ||
              new TextEncoder().encode(JSON.stringify(parameters)).length > 16384
            )
              throw Error('JSON参数须为不超过16KiB的对象');
            config.kind = fields.kind.value;
            config.parameters = parameters;
          } else {
            const from = fields.sourceDateFrom.value,
              to = fields.sourceDateTo.value;
            const daily = fields.mode.value === 'daily-random';
            if (daily && from && to && from > to) throw Error('开始日期不能晚于结束日期');
            Object.assign(config, {
              mode: fields.mode.value,
              ...(daily
                ? {
                    dailyTime: fields.dailyTime.value,
                    sourceDateFrom: from || null,
                    sourceDateTo: to || null,
                  }
                : { interval: { count: Number(fields.count.value), unit: fields.unit.value } }),
              timeZone: fields.timeZone.value,
              categories: [...fields.categories.selectedOptions].map((o) => o.value),
              sender: {
                ...(base.config?.sender || defaults(room, 'revisit').sender),
                name: fields.sender.value,
              },
            });
          }
        }
      } catch (error) {
        status.textContent = '参数未提交：' + error.message;
        return;
      }
      saving = true;
      loadGeneration++;
      for (const control of form.querySelectorAll('input,select,textarea,button'))
        control.disabled = true;
      try {
        const value = await port.saveSettings(room, {
          ...target,
          providerId: detaching ? null : activeProvider,
          instanceId: base.instanceId,
          bindingId: base.bindingId || target.bindingId,
          expectedBindingRevision: base.bindingRevision ?? 0,
          expectedConfigRevision: base.config?.revision ?? 0,
          config,
        });
        fill(value);
        settings.saved(page);
        status.textContent = detaching
          ? '已解除此接入，原实例与进度保留。'
          : activeProvider === 'external-program'
            ? '参与者与参数已登记；消息执行器尚未接入。'
            : '程序设置已保存，本机会话路由已确认。';
        changed(value);
        await refresh();
      } catch (error) {
        reconcile.hidden = false;
        status.textContent = error.partial?.settingsSaved
          ? '后台设置已保存，本机路由尚未确认；草稿保留，请重新读取后重试。'
          : error.status === 409
            ? '其他窗口已修改设置；草稿保留，请重新读取版本后明确保存。'
            : '保存未完成，草稿保留：' + error.message;
      } finally {
        saving = false;
        for (const control of form.querySelectorAll('input,select,textarea,button'))
          control.disabled = false;
        modeChanged();
        save.disabled = !base?.canSave || !known(activeProvider);
        detach.disabled = !base?.canSave;
      }
    }
    form.onsubmit = async (event) => {
      event.preventDefault();
      await persist(false);
    };
    detach.onclick = () => persist(true);
    settings.bindForm(page, form);
    fill({ config: {}, canSave: false, reason: '正在读取此程序设置…' });
    await page.settingsResume();
  }
  refresh();
  return {
    section,
    refresh,
    dispose() {
      disposed = true;
      generation++;
      channel?.close();
      section.remove();
    },
  };
}
