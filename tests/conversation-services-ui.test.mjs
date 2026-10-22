import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  mountRoomServices,
  roomServicePort,
} from '../previews/telegram-chat/shiye-conversation-services-ui.js';

function domLab(t) {
  const dom = new JSDOM('<!doctype html><body><section id="room-settings"></section></body>', {
    url: 'https://shiye-preview.local/',
  });
  const overrides = {
    window: dom.window,
    document: dom.window.document,
    Option: dom.window.Option,
    CustomEvent: dom.window.CustomEvent,
    CSS: { escape: (value) => value },
    BroadcastChannel: undefined,
  };
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const pages = [],
    navigation = [];
  let saved = 0;
  window.shiyeSettingsUi = {
    open(options) {
      navigation.push(options);
      const page = document.createElement('section');
      page.dataset.shiyeSettingsPage = options.page;
      page.innerHTML = '<h2></h2><div data-settings-body></div><div data-settings-actions></div>';
      document.body.append(page);
      pages.push(page);
      return page;
    },
    bindForm(page, form) {
      form.addEventListener('input', () => {
        page.dataset.settingsDirty = 'true';
      });
    },
    saved(page) {
      saved++;
      page.dataset.settingsDirty = 'false';
    },
  };
  t.after(() => {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const parent = document.querySelector('#room-settings');
  return { parent, pages, navigation, saved: () => saved };
}
const directory = () => ({
  canSave: true,
  providers: [
    { id: 'revisit', name: '朝花夕拾', independentInstances: true },
    { id: 'external-program', name: '外部程序／AI', independentInstances: true },
  ],
  state: { mode: 'group' },
  programs: [],
  bindings: [],
  participants: [
    { id: 'self', kind: 'self', name: '我' },
    { id: 'program:x', kind: 'ai', name: '助手', active: true },
  ],
});
const snapshot = (revision = 0) => ({
  providerId: revision ? 'external-program' : null,
  instanceProviderId: 'external-program',
  bindingId: revision ? 'binding' : undefined,
  instanceId: revision ? 'instance' : undefined,
  bindingRevision: revision ? 1 : 0,
  config: {
    revision,
    title: '外部程序',
    enabled: false,
    sender: { name: '助手' },
    kind: 'ai',
    parameters: {},
  },
  canSave: true,
});
const findButton = (element, text) =>
  [...element.querySelectorAll('button')].find((node) => node.textContent === text);
test('program editor targets a stable slot, preserves the real parent and waits for routing acknowledgement', async (t) => {
  const d = domLab(t),
    reads = [],
    writes = [];
  let resolveRoute;
  const port = {
    readConversation: async () => directory(),
    readSettings: async (_room, target) => {
      reads.push(target);
      return snapshot();
    },
    saveSettings: async (_room, value) => {
      writes.push(value);
      return new Promise((resolve) => {
        resolveRoute = resolve;
      });
    },
  };
  const mounted = mountRoomServices({
    room: { id: 10, title: '群聊' },
    parent: d.parent,
    container: d.parent,
    port,
  });
  t.after(() => mounted.dispose());
  await mounted.refresh();
  assert.match(mounted.section.textContent, /当前会话：群聊/);
  assert.match(mounted.section.textContent, /AI角色（需外部执行器）/);
  const provider = mounted.section.querySelector('select');
  provider.value = 'external-program';
  provider.onchange();
  await findButton(mounted.section, '配置接入').onclick();
  const page = d.pages[0],
    form = page.querySelector('form');
  assert.equal(d.navigation[0].parent, d.parent);
  assert.equal(d.navigation[0].autosave, false);
  assert.deepEqual(reads[0], { slotId: 'assistant' });
  const parameters = page.querySelector('textarea');
  parameters.value = '{"language":"zh"}';
  parameters.dispatchEvent(new window.Event('input', { bubbles: true }));
  const baselineSaved = d.saved();
  const saving = form.onsubmit({ preventDefault() {} });
  await Promise.resolve();
  assert.equal(d.saved(), baselineSaved);
  assert.equal(page.dataset.settingsDirty, 'true');
  assert.equal(findButton(page, '保存程序设置').disabled, true);
  resolveRoute(snapshot(1));
  await saving;
  assert.equal(page.dataset.settingsDirty, 'false');
  assert.deepEqual(writes[0].config.parameters, { language: 'zh' });
  assert.equal(writes[0].slotId, 'assistant');
  assert.equal(writes[0].expectedConfigRevision, 0);
  assert.match(
    page.querySelector('[data-service-status]').textContent,
    /参与者与参数已登记；消息执行器尚未接入/,
  );
});
test('conflict reread preserves the visible JSON draft and only replaces revision for the next explicit save', async (t) => {
  const d = domLab(t),
    writes = [];
  let conflict = true;
  const port = {
    readConversation: async () => directory(),
    readSettings: async () => snapshot(1),
    recoverSettings: async () => snapshot(7),
    saveSettings: async (_room, value) => {
      writes.push(value);
      if (conflict) throw Object.assign(Error('conflict'), { status: 409 });
      return snapshot(8);
    },
  };
  const mounted = mountRoomServices({
    room: { id: 10, title: '群聊' },
    parent: d.parent,
    container: d.parent,
    port,
  });
  t.after(() => mounted.dispose());
  await mounted.refresh();
  const provider = mounted.section.querySelector('select');
  provider.value = 'external-program';
  provider.onchange();
  await findButton(mounted.section, '配置接入').onclick();
  const page = d.pages[0],
    parameters = page.querySelector('textarea');
  parameters.value = '{"draft":true}';
  parameters.dispatchEvent(new window.Event('input', { bubbles: true }));
  await page.querySelector('form').onsubmit({ preventDefault() {} });
  assert.equal(page.dataset.settingsDirty, 'true');
  assert.match(page.querySelector('[data-service-status]').textContent, /草稿保留/);
  await findButton(page, '保留草稿并重新读取版本').onclick();
  assert.equal(parameters.value, '{"draft":true}');
  assert.equal(page.dataset.settingsDirty, 'true');
  assert.equal(writes.length, 1);
  conflict = false;
  await page.querySelector('form').onsubmit({ preventDefault() {} });
  assert.equal(writes[1].expectedConfigRevision, 7);
  assert.deepEqual(writes[1].config.parameters, { draft: true });
});
test('invalid JSON never saves and a missing capability disables the new program entry', async (t) => {
  const d = domLab(t);
  let writes = 0;
  const port = {
    readConversation: async () => directory(),
    readSettings: async () => snapshot(),
    saveSettings: async () => {
      writes++;
    },
  };
  const mounted = mountRoomServices({
    room: { id: 10, title: '群聊' },
    parent: d.parent,
    container: d.parent,
    port,
  });
  t.after(() => mounted.dispose());
  await mounted.refresh();
  const provider = mounted.section.querySelector('select');
  provider.value = 'external-program';
  provider.onchange();
  await findButton(mounted.section, '配置接入').onclick();
  const page = d.pages[0];
  page.querySelector('textarea').value = '[]';
  await page.querySelector('form').onsubmit({ preventDefault() {} });
  assert.equal(writes, 0);
  assert.match(page.querySelector('[data-service-status]').textContent, /参数未提交/);
  port.readConversation = async () => ({ ...directory(), canSave: false, reason: '后台尚未启用' });
  await mounted.refresh();
  assert.equal(findButton(mounted.section, '配置接入').disabled, true);
});
test('legacy room retains the old program bridge while keeping an independent extra-slot entry', async (t) => {
  const d = domLab(t),
    actions = [],
    targets = [];
  window.shiyeJournal = {
    program: async (action) => {
      actions.push(action);
      return action === 'status'
        ? { config: { revision: 3, title: '朝花夕拾', enabled: true } }
        : { revision: 4 };
    },
  };
  window.shiyeConversationServicesPort = {
    readConversation: async () => directory(),
    readSettings: async (target) => {
      targets.push(target);
      return snapshot();
    },
    saveSettings: async (target) => {
      targets.push(target);
      return snapshot(1);
    },
  };
  const port = roomServicePort(),
    room = { id: -900000001, title: '朝花夕拾' };
  await port.saveSettings(room, {
    slotId: 'revisit',
    providerId: 'revisit',
    config: {},
    expectedConfigRevision: 3,
  });
  assert.deepEqual(actions, ['config']);
  const mounted = mountRoomServices({ room, parent: d.parent, container: d.parent, port });
  t.after(() => mounted.dispose());
  await mounted.refresh();
  assert.match(mounted.section.textContent, /朝花夕拾/);
  assert.equal(findButton(mounted.section, '配置接入').disabled, false);
  const provider = mounted.section.querySelector('select');
  provider.value = 'external-program';
  provider.onchange();
  await findButton(mounted.section, '配置接入').onclick();
  assert.equal(targets.at(-1).roomId, '-900000001');
  assert.equal(targets.at(-1).slotId, 'assistant');
});

test('delayed automatic and explicit rereads cannot overwrite input entered while awaiting the response', async (t) => {
  const d = domLab(t);
  const port = {
    readConversation: async () => directory(),
    readSettings: async () => snapshot(1),
    saveSettings: async () => snapshot(2),
  };
  const mounted = mountRoomServices({
    room: { id: 10, title: '群聊' },
    parent: d.parent,
    container: d.parent,
    port,
  });
  t.after(() => mounted.dispose());
  await mounted.refresh();
  const provider = mounted.section.querySelector('select');
  provider.value = 'external-program';
  provider.onchange();
  await findButton(mounted.section, '配置接入').onclick();
  const page = d.pages[0],
    parameters = page.querySelector('textarea'),
    savedAtStart = d.saved();
  let finishRead;
  port.readSettings = () =>
    new Promise((resolve) => {
      finishRead = resolve;
    });
  const automatic = page.settingsResume();
  parameters.value = '{"typedDuringAutoRead":true}';
  parameters.dispatchEvent(new window.Event('input', { bubbles: true }));
  finishRead(snapshot(7));
  await automatic;
  assert.equal(parameters.value, '{"typedDuringAutoRead":true}');
  assert.equal(page.dataset.settingsDirty, 'true');
  assert.equal(d.saved(), savedAtStart);
  port.recoverSettings = () =>
    new Promise((resolve) => {
      finishRead = resolve;
    });
  const explicit = findButton(page, '放弃本页更改并重新读取').onclick();
  parameters.value = '{"typedDuringExplicitRead":true}';
  parameters.dispatchEvent(new window.Event('change', { bubbles: true }));
  finishRead(snapshot(8));
  await explicit;
  assert.equal(parameters.value, '{"typedDuringExplicitRead":true}');
  assert.equal(page.dataset.settingsDirty, 'true');
  assert.equal(d.saved(), savedAtStart);
  assert.match(page.querySelector('[data-service-status]').textContent, /读取期间有新输入/);
});

test('hidden mode fields do not block native form validation and remain disabled after a save failure', async (t) => {
  const d = domLab(t),
    writes = [];
  const port = {
    readConversation: async () => directory(),
    readSettings: async (_room, target) =>
      target.slotId === 'assistant'
        ? snapshot()
        : {
            providerId: 'revisit',
            instanceProviderId: 'revisit',
            bindingRevision: 1,
            canSave: true,
            config: {
              revision: 2,
              enabled: true,
              title: '回看',
              sender: { name: '过去的我' },
              mode: 'interval',
              dailyTime: '08:00',
              interval: { count: 1, unit: 'year' },
              timeZone: 'Asia/Shanghai',
            },
          },
    saveSettings: async (_room, value) => {
      writes.push(value);
      throw Error('synthetic failure');
    },
  };
  const mounted = mountRoomServices({
    room: { id: 10, title: '群聊' },
    parent: d.parent,
    container: d.parent,
    port,
  });
  t.after(() => mounted.dispose());
  await mounted.refresh();
  await findButton(mounted.section, '配置接入').onclick();
  const page = d.pages[0],
    form = page.querySelector('form'),
    mode = page.querySelector('select[aria-label="回看方式"]'),
    count = page.querySelector('input[name="count"]');
  count.value = '0';
  assert.equal(form.checkValidity(), false);
  mode.value = 'daily-random';
  mode.onchange();
  assert.equal(count.disabled, true);
  assert.equal(form.checkValidity(), true);
  await form.onsubmit({ preventDefault() {} });
  assert.equal(count.disabled, true);
  assert.equal(form.checkValidity(), true);
  assert.equal(writes[0].config.interval, undefined);
  mode.value = 'interval';
  mode.onchange();
  assert.equal(count.disabled, false);
  assert.equal(form.checkValidity(), false);
  count.value = '1';
  assert.equal(form.checkValidity(), true);
  const provider = mounted.section.querySelector('select');
  provider.value = 'external-program';
  provider.onchange();
  await findButton(mounted.section, '配置接入').onclick();
  const external = d.pages[1];
  assert.equal(external.querySelector('input[name="count"]').disabled, true);
  assert.equal(external.querySelector('textarea').disabled, false);
  assert.equal(external.querySelector('select[aria-label="角色类型"]').disabled, false);
  assert.equal(external.querySelector('form').checkValidity(), true);
});
