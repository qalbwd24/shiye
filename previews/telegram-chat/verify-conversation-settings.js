/* Native browser interaction over synthetic room settings. */
window.shiyeVerifyConversationSettings = async ({
  input,
  replace,
  key,
  wait,
  until,
  expect,
  result,
  trustedClick,
  chooseRoom,
  nextRoomLabel,
}) => {
  const ui = window.shiyeRoomUi;
  const originalRoom = ui.currentId();
  const sidebarToggle = document.querySelector('.shiye-sidebar-fallback');
  const toggleBox = sidebarToggle.getBoundingClientRect();
  expect(toggleBox.width >= 56 && toggleBox.height >= 56, '会话列表按钮具有56px点击区域');
  expect(
    getComputedStyle(sidebarToggle).backgroundColor === 'rgba(0, 0, 0, 0)',
    '会话列表按钮透明底且图标大小独立',
  );
  async function navigation() {
    window.dispatchEvent(new Event('shiye-open-settings'));
    await trustedClick(document.querySelector('[data-navigation]'));
    await until(
      () => document.querySelector('.shiye-navigation-settings[open]'),
      '会话切换与排列设置',
    );
    return document.querySelector('.shiye-navigation-settings');
  }
  async function closeNavigationToChat() {
    const currentRoom = ui.currentId();
    await key('Escape', 'Escape', 27);
    expect(
      !document.querySelector('.shiye-navigation-settings[open]') &&
        Boolean(
          document.querySelector(
            '[data-shiye-settings-page="root"][open][data-settings-active="true"]',
          ),
        ) &&
        ui.currentId() === currentRoom,
      '切换设置Esc返回真实父层且不切房',
    );
    await trustedClick(
      document.querySelector('[data-shiye-settings-page="root"] [data-settings-close]'),
    );
    expect(!document.querySelector('.shiye-settings-dialog[open]'), '关闭设置根页后恢复聊天操作');
  }
  function setMode(dialog, mode) {
    const select = dialog.querySelector('[data-switch-mode]');
    select.value = mode;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  let dialog = await navigation();
  const previousMode = localStorage.getItem('shiye-room-switch-mode-v1');
  localStorage.removeItem('shiye-room-switch-mode-v1');
  await key('Escape', 'Escape', 27);
  dialog = await navigation();
  expect(
    dialog.querySelector('[data-switch-mode]').value === 'sidebar',
    'Esc新默认控制实际会话侧栏',
  );
  if (previousMode) localStorage.setItem('shiye-room-switch-mode-v1', previousMode);
  const before = [...dialog.querySelectorAll('[data-room-id]')].map((row) => row.dataset.roomId);
  const last = dialog.querySelectorAll('[data-room-id]')[before.length - 1];
  await trustedClick(last.querySelector('button'));
  const order = [...dialog.querySelectorAll('[data-room-id]')].map((row) => row.dataset.roomId);
  expect(order[order.length - 2] === before.at(-1), '设置可上移会话且立即持久保存排列');
  expect(
    JSON.parse(localStorage.getItem('shiye-room-order-v1')).join() === order.join(),
    '会话排列保存为稳定ID',
  );
  setMode(dialog, 'direct');
  await closeNavigationToChat();
  expect(ui.currentId() === originalRoom, '设置Esc仅关闭本层而不切换对话');
  if (document.body.dataset.shiyeSidebar === 'collapsed')
    await trustedClick(document.querySelector('.shiye-sidebar-fallback'));
  await wait(350);
  const readSidebarOrder = () =>
    [...document.querySelectorAll('#LeftColumn .shiye-room-settings[data-room-id]')]
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
      .map((button) => button.dataset.roomId);
  await until(() => readSidebarOrder().join() === order.join(), '侧栏刷新自定义顺序');
  const sidebarOrder = readSidebarOrder();
  expect(sidebarOrder.join() === order.join(), '侧栏视觉顺序与自定义排列一致');
  await trustedClick(document.querySelector('.shiye-sidebar-fallback'));
  await replace('直接切换保留的独立草稿');
  const next = order[(order.indexOf(originalRoom) + 1) % order.length];
  const started = performance.now();
  await key('Escape', 'Escape', 27);
  await until(() => ui.currentId() === next, 'Esc不经列表立即切换');
  expect(!document.querySelector('.shiye-room-switcher[open]'), '立即模式不打开列表或等待倒计时');
  result.directSwitchMs = performance.now() - started;
  expect(result.directSwitchMs < 1000, '立即切换不等待原1200ms倒计时');
  for (let i = 1; i < order.length; i++) {
    await key('Escape', 'Escape', 27);
    await wait(350);
  }
  await until(() => ui.currentId() === originalRoom, 'Esc按设置顺序完整循环');
  await wait(700);
  expect(input().textContent.includes('直接切换保留的独立草稿'), '立即切换往返保留原会话草稿');
  const two = order[(order.indexOf(originalRoom) + 2) % order.length];
  await key('Escape', 'Escape', 27);
  await key('Escape', 'Escape', 27);
  await until(() => ui.currentId() === two, '快速连按两次Esc不丢失切换步数');
  dialog = await navigation();
  expect(dialog.querySelector('[data-switch-mode]').value === 'direct', '重新打开设置保留立即模式');
  setMode(dialog, 'list');
  await closeNavigationToChat();
  await key('Escape', 'Escape', 27);
  await until(() => document.querySelector('.shiye-room-switcher[open]'), '原列表预选模式仍可选');
  const choices = [...document.querySelectorAll('.shiye-room-choices button')];
  const titles = (await ui.command('list')).rooms;
  expect(
    choices.map((button) => button.textContent).join() ===
      order.map((id) => titles.find((room) => room.id === id).title).join(),
    '列表预选使用同一自定义顺序',
  );
  await key('Enter', 'Enter', 13);
  await wait(400);
  await chooseRoom('随手记');
  dialog = await navigation();
  setMode(dialog, 'manual');
  await closeNavigationToChat();
  const manualOrigin = ui.currentId();
  await key('Escape', 'Escape', 27);
  await until(
    () => document.querySelector('.shiye-room-switcher[data-mode=manual][open]'),
    'Esc打开手动会话列表',
  );
  const focused = document.activeElement;
  expect(
    focused.getAttribute('aria-current') === 'true' &&
      focused.textContent === titles.find((room) => room.id === manualOrigin).title,
    '手动列表初始焦点落在当前会话',
  );
  await wait(window.shiyeSwitchDelay.get() + 200);
  expect(
    ui.currentId() === manualOrigin &&
      Boolean(document.querySelector('.shiye-room-switcher[open]')),
    '手动列表停顿不自动进入',
  );
  await key('ArrowDown', 'ArrowDown', 40);
  expect(document.activeElement !== focused, '手动列表方向键下移焦点');
  const manualTarget = titles.find((room) => room.title === document.activeElement.textContent).id;
  await key('Enter', 'Enter', 13);
  await until(() => ui.currentId() === manualTarget, '手动列表Enter进入选中会话');
  await wait(300);
  await key('Escape', 'Escape', 27);
  await key('ArrowUp', 'ArrowUp', 38);
  await key('Escape', 'Escape', 27);
  expect(
    ui.currentId() === manualTarget && !document.querySelector('.shiye-room-switcher[open]'),
    '手动列表Esc取消保留原会话',
  );
  dialog = await navigation();
  expect(dialog.querySelector('[data-switch-mode]').value === 'manual', '手动列表模式持久保存');
  setMode(dialog, 'sidebar');
  await closeNavigationToChat();
  if (document.body.dataset.shiyeSidebar === 'expanded') await trustedClick(sidebarToggle);
  await until(() => document.body.dataset.shiyeSidebar === 'collapsed', '侧栏初始折叠');
  const sidebarOrigin = ui.currentId();
  const focusedSidebarId = () =>
    document.activeElement
      ?.closest('#LeftColumn .ListItem.Chat')
      ?.querySelector('.shiye-room-settings[data-room-id]')?.dataset.roomId;
  await key('Escape', 'Escape', 27);
  await until(
    () => document.body.dataset.shiyeSidebar === 'expanded' && focusedSidebarId() === sidebarOrigin,
    'Esc展开实际侧栏并聚焦当前会话',
  );
  expect(!document.querySelector('.shiye-room-switcher[open]'), '侧栏Esc模式不打开独立切换弹窗');
  expect(sidebarToggle.getAttribute('aria-expanded') === 'true', 'Esc展开后透明折叠按钮状态同步');
  await key('ArrowDown', 'ArrowDown', 40);
  const sidebarTarget = focusedSidebarId();
  expect(
    Boolean(sidebarTarget) && sidebarTarget !== sidebarOrigin && ui.currentId() === sidebarOrigin,
    '实际侧栏方向键只移动选择不提前进入',
  );
  await wait(window.shiyeSwitchDelay.get() + 200);
  expect(
    ui.currentId() === sidebarOrigin && focusedSidebarId() === sidebarTarget,
    '实际侧栏停顿不自动切换且不被输入聚焦抢走',
  );
  await key('Escape', 'Escape', 27);
  await until(() => document.body.dataset.shiyeSidebar === 'collapsed', '再次Esc折叠实际侧栏');
  expect(
    ui.currentId() === sidebarOrigin && sidebarToggle.getAttribute('aria-expanded') === 'false',
    'Esc收起侧栏不提交预选且按钮状态同步',
  );
  await key('Escape', 'Escape', 27);
  await until(() => focusedSidebarId() === sidebarOrigin, '再次展开仍聚焦当前真实会话');
  await key('ArrowDown', 'ArrowDown', 40);
  const sidebarCommit = focusedSidebarId();
  await key('Enter', 'Enter', 13);
  await until(
    () => ui.currentId() === sidebarCommit && document.body.dataset.shiyeSidebar === 'collapsed',
    '侧栏Enter进入选中会话并折叠',
  );
  await until(() => document.activeElement === input(), '侧栏进入会话后回到输入框');
  await key('ArrowUp', 'ArrowUp', 38);
  expect(
    ui.currentId() === sidebarCommit && document.body.dataset.shiyeSidebar === 'collapsed',
    '输入区上下键继续编辑且不唤起会话侧栏',
  );
  await trustedClick(sidebarToggle);
  await until(() => document.body.dataset.shiyeSidebar === 'expanded', '按钮可展开同一会话侧栏');
  expect(
    getComputedStyle(sidebarToggle).outlineStyle === 'none',
    '鼠标点击折叠按钮后没有默认黑色焦点边框',
  );
  await key('Escape', 'Escape', 27);
  await until(
    () => document.body.dataset.shiyeSidebar === 'collapsed',
    '按钮展开后Esc可关闭同一侧栏',
  );
  const oldMotion = localStorage.getItem('shiye-sidebar-motion');
  const changeSidebar = (collapsed) =>
    window.dispatchEvent(new CustomEvent('shiye-set-sidebar', { detail: { collapsed } }));
  const sidebar = document.querySelector('#LeftColumn');
  const motionState = () => ({
    left: sidebar.getBoundingClientRect().left,
    display: getComputedStyle(sidebar).display,
    inert: sidebar.inert,
    animations: sidebar.getAnimations().length,
    willChange: sidebar.style.willChange,
  });
  localStorage.setItem('shiye-sidebar-motion', 'smooth');
  changeSidebar(false);
  await wait(230);
  changeSidebar(true);
  await wait(45);
  const beforeReverse = motionState();
  changeSidebar(false);
  const afterReverse = motionState();
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    expect(beforeReverse.animations > 0, '会话侧栏收起具有真实过渡');
    expect(Math.abs(beforeReverse.left - afterReverse.left) < 2, '侧栏快速反向从当前绘制位置接续');
  }
  await wait(230);
  expect(!sidebar.inert && !sidebar.getAnimations().length, '侧栏展开完成可交互且无残留动画');
  changeSidebar(true);
  await wait(230);
  const closedMotion = motionState();
  expect(
    closedMotion.display === 'none' &&
      closedMotion.inert &&
      !closedMotion.animations &&
      !closedMotion.willChange,
    '侧栏收起完成隐藏并释放临时合成样式',
  );
  localStorage.setItem('shiye-sidebar-motion', 'instant');
  changeSidebar(false);
  expect(!sidebar.getAnimations().length && !sidebar.inert, '侧栏立即模式不等待动画即可交互');
  changeSidebar(true);
  expect(getComputedStyle(sidebar).display === 'none' && sidebar.inert, '侧栏立即收起不留下覆盖层');
  if (oldMotion === null) localStorage.removeItem('shiye-sidebar-motion');
  else localStorage.setItem('shiye-sidebar-motion', oldMotion);
  result.sidebarMotion = { beforeReverse, afterReverse, closedMotion };
  dialog = await navigation();
  expect(dialog.querySelector('[data-switch-mode]').value === 'sidebar', '实际侧栏模式持久保存');
  setMode(dialog, 'list');
  await closeNavigationToChat();
  await chooseRoom('随手记');
  let checkedActions = false;
  async function appearance(id, values) {
    window.dispatchEvent(new CustomEvent('shiye-edit-room', { detail: { id } }));
    await until(() => document.querySelector('.shiye-room-appearance'), '本对话外观表单');
    const form = document.querySelector('.shiye-room-appearance').closest('form');
    if (!checkedActions) {
      const parameters = form.querySelector('.shiye-room-settings-parameters');
      const bar = form.querySelector('.shiye-room-settings-actions');
      const bounds = [];
      for (const position of [0, parameters.scrollHeight]) {
        parameters.scrollTop = position;
        await wait(80);
        const box = bar.getBoundingClientRect();
        bounds.push(box.top);
        expect(
          box.top >= 0 && box.bottom <= innerHeight && !parameters.contains(bar),
          '会话参数滚动时保存栏固定在外部且始终可见',
        );
      }
      expect(Math.abs(bounds[0] - bounds[1]) < 1, '保存栏不跟随参数滚动');
      checkedActions = true;
    }
    const inherit = form.elements.inheritAppearance;
    inherit.checked = values === null;
    inherit.dispatchEvent(new Event('change', { bubbles: true }));
    expect(
      form.querySelector('.shiye-form-status').textContent.includes('未保存'),
      '修改外观时固定保存栏提示未保存',
    );
    if (!result.roomSettingsScreenshot) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('会话设置截图超时')), 4000);
        const receive = ({ data }) => {
          if (data.kind !== 'composer-capture-ready' || data.stage !== 'room-settings') return;
          clearTimeout(timer);
          window.chrome.webview.removeEventListener('message', receive);
          resolve();
        };
        window.chrome.webview.addEventListener('message', receive);
        window.chrome.webview.postMessage({
          kind: 'verify-composer-capture',
          stage: 'room-settings',
        });
      });
      result.roomSettingsScreenshot = true;
    }
    if (values)
      for (const [name, value] of Object.entries(values)) form.elements[name].value = String(value);
    await trustedClick(form.querySelector('button[type=submit]'));
    await until(() => !document.querySelector('.shiye-room-appearance'), '保存独立外观');
    await wait(400);
  }
  const a = ui.currentId();
  await appearance(a, {
    roomShade: 0.35,
    roomBubble: 0.6,
    roomTheme: 'light',
    roomRadius: 12,
    roomMessageGap: 18,
  });
  expect(
    document.body.dataset.shiyeTheme === 'light' &&
      document.body.style.getPropertyValue('--shiye-shade') === '0.35',
    '当前会话独立明暗和遮罩生效',
  );
  await chooseRoom(nextRoomLabel);
  const b = ui.currentId();
  expect(
    document.body.style.getPropertyValue('--shiye-shade') !== '0.35',
    '未设置独立外观的其他会话仍继承全局',
  );
  await appearance(b, {
    roomShade: 0.88,
    roomBubble: 0.95,
    roomTheme: 'dark',
    roomRadius: 20,
    roomMessageGap: 8,
  });
  await chooseRoom('随手记');
  expect(
    document.body.dataset.shiyeTheme === 'light' &&
      document.body.style.getPropertyValue('--shiye-bubble') === '0.6' &&
      document.body.style.getPropertyValue('--shiye-message-gap') === '18px',
    '往返会话恢复独立气泡透明度和间距',
  );
  const stored = JSON.parse(localStorage.getItem('shiye-room-appearance-v1'));
  expect(stored[a].shade === 0.35 && stored[b].shade === 0.88, '两个会话外观独立持久化');
  await appearance(a, null);
  expect(document.body.dataset.shiyeTheme === 'dark', '恢复继承全局后立即使用全局明暗');
  await chooseRoom(nextRoomLabel);
  expect(
    document.body.style.getPropertyValue('--shiye-shade') === '0.88',
    '恢复一个会话的继承不会清除另一个独立设置',
  );
  await appearance(b, null);
  await chooseRoom('随手记');
  dialog = await navigation();
  setMode(dialog, 'direct');
  await closeNavigationToChat();
  result.conversationSettings = { order, directDefault: true, independentAppearance: true };
  await replace('');
  await verifyReadingPositions();

  async function verifyReadingPositions() {
    const samples = [];
    const transitions = [];
    result.readingPositions = { samples, transitions, passed: false };
    window.addEventListener('shiye-room-view-ready', (event) => transitions.push(event.detail));
    if (document.body.dataset.shiyeSidebar === 'collapsed')
      await trustedClick(document.querySelector('.shiye-sidebar-fallback'));
    const scroller = () =>
      [...document.querySelectorAll('#MiddleColumn .MessageList')].find(
        (node) => node.dataset.listKey === `${ui.currentId()}_-1_thread`,
      ) || document.querySelector('#MiddleColumn .MessageList');
    async function ready(id) {
      await until(
        () => ui.currentId() === id && !document.body.dataset.shiyeRoomPending,
        '定位完成后显示会话',
      );
      await wait(240);
    }
    async function open(id) {
      if (document.body.dataset.shiyeSidebar === 'collapsed') {
        await trustedClick(document.querySelector('.shiye-sidebar-fallback'));
        await wait(150);
      }
      const gear = document.querySelector(`.shiye-room-settings[data-room-id="${id}"]`);
      await trustedClick(gear.closest('.ListItem').querySelector('.ListItem-button'));
      await ready(id);
    }
    function anchor() {
      const list = scroller();
      const top = list.getBoundingClientRect().top;
      const node = [...list.querySelectorAll('.Message[data-message-id]')].find(
        (message) => message.getBoundingClientRect().bottom > top + 4,
      );
      if (!node) throw Error('没有可见阅读锚点');
      return {
        id: node.dataset.messageId,
        top: node.getBoundingClientRect().top - top,
        scrollTop: list.scrollTop,
      };
    }
    function scroll(fraction) {
      const list = scroller();
      list.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
      list.scrollTop = (list.scrollHeight - list.clientHeight) * fraction;
      list.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
    async function assertPosition(saved, label) {
      const list = scroller();
      const node = [...list.querySelectorAll('.Message[data-message-id]')].find(
        (message) => message.dataset.messageId === saved.id,
      );
      const delta = node
        ? node.getBoundingClientRect().top - list.getBoundingClientRect().top - saved.top
        : Infinity;
      samples.push({ label, delta, scrollTop: list.scrollTop, saved });
      expect(Math.abs(delta) < 3, label);
      const positions = [];
      for (let i = 0; i < 12; i++) {
        positions.push(node.getBoundingClientRect().top - list.getBoundingClientRect().top);
        await wait(20);
      }
      expect(Math.max(...positions) - Math.min(...positions) < 2, label + '：过渡后无来回抖动');
    }
    await open(a);
    scroll(0.43);
    await wait(65);
    const first = anchor();
    expect(first.scrollTop > 80, '阅读位置验收使用足够长的真实消息列表');
    await key('Escape', 'Escape', 27);
    const nextId = order[(order.indexOf(a) + 1) % order.length];
    await ready(nextId);
    for (let i = 1; i < order.length; i++) {
      await key('Escape', 'Escape', 27);
      await ready(order[(order.indexOf(a) + i + 1) % order.length]);
    }
    await assertPosition(first, '滚动后立即Esc切出并完整循环，恢复原消息及相对位置');
    const stored = JSON.parse(localStorage.getItem('shiye-room-viewports-v1'));
    expect(
      stored.some(
        ([key, value]) =>
          key.startsWith(a + '_') &&
          typeof value.anchorId === 'string' &&
          value.scrollOffset > 0 &&
          !value.atBottom,
      ),
      '离开时立即持久保存锚点，不等待滚动防抖',
    );
    const historyId = order.find((id) => id !== a && id !== b);
    await open(historyId);
    for (let i = 0; i < 8; i++) {
      await replace(
        `合成阅读记录 ${i + 1}\n` + '用于隔离验证阅读位置，保留原消息锚点。\n'.repeat(9),
      );
      await key('Enter', 'Enter', 13);
      await wait(180);
    }
    await wait(1100);
    scroll(0.3);
    await wait(70);
    const second = anchor();
    await open(a);
    await assertPosition(first, '侧栏切回第一个会话保留中段位置');
    await open(historyId);
    await assertPosition(second, '不同会话分别保存阅读位置');
    scroll(1);
    await wait(65);
    result.readingPositions.bottomBefore = {
      gap: scroller().scrollHeight - scroller().scrollTop - scroller().clientHeight,
      room: historyId,
      stored: JSON.parse(localStorage.getItem('shiye-room-viewports-v1')),
    };
    await open(a);
    await open(historyId);
    const list = scroller();
    result.readingPositions.bottomAfter = {
      gap: list.scrollHeight - list.scrollTop - list.clientHeight,
      scrollHeight: list.scrollHeight,
      clientHeight: list.clientHeight,
      scrollTop: list.scrollTop,
      restoring: list.dataset.shiyeRestoring,
      stored: JSON.parse(localStorage.getItem('shiye-room-viewports-v1')),
    };
    expect(
      list.scrollHeight - list.scrollTop - list.clientHeight < 3,
      '原先停在底部的会话切回仍停在最新消息',
    );
    const target = [...list.querySelectorAll('.Message[data-message-id]')][1];
    const targetId = target.dataset.messageId;
    window.dispatchEvent(
      new CustomEvent('shiye-focus-message', {
        detail: { chatId: historyId, messageId: Number(targetId) },
      }),
    );
    await wait(900);
    const liveTarget = [...scroller().querySelectorAll('.Message[data-message-id]')].find(
      (node) => node.dataset.messageId === targetId,
    );
    result.readingPositions.explicitTarget = {
      id: targetId,
      oldConnected: target.isConnected,
      found: Boolean(liveTarget),
      top: liveTarget?.getBoundingClientRect().top,
      bottom: liveTarget?.getBoundingClientRect().bottom,
      listTop: scroller().getBoundingClientRect().top,
      listBottom: scroller().getBoundingClientRect().bottom,
    };
    expect(
      liveTarget &&
        liveTarget.getBoundingClientRect().bottom > scroller().getBoundingClientRect().top &&
        liveTarget.getBoundingClientRect().top < scroller().getBoundingClientRect().bottom,
      '显式定位消息仍能前往目标，不被旧阅读位置覆盖',
    );
    expect(
      transitions.some((entry) => entry.animated),
      '会话恢复完成后使用独立轻量进入动画',
    );
    expect(!document.body.dataset.shiyeRoomPending, '切换结束不残留隐藏层');
    const oldFont = document.body.style.getPropertyValue('--shiye-message-size');
    const oldInputSize = getComputedStyle(input()).fontSize;
    const oldWidth = innerWidth;
    const oldHeight = innerHeight;
    document.body.style.setProperty('--shiye-message-size', '24px');
    window.chrome.webview.postMessage({ kind: 'verify-viewport', width: 360, height: 700 });
    await wait(350);
    window.dispatchEvent(new CustomEvent('shiye-open-room', { detail: { id: a } }));
    await ready(a);
    await assertPosition(first, '离开期间改变字号与窄窗口，仍恢复同一消息锚点');
    expect(
      getComputedStyle(input()).fontSize === oldInputSize,
      '改变消息字号恢复阅读位置时独立输入字号保持',
    );
    document.body.style.setProperty('--shiye-message-size', oldFont);
    window.chrome.webview.postMessage({
      kind: 'verify-viewport',
      width: oldWidth + 16,
      height: oldHeight + 80,
    });
    await wait(350);
    result.readingPositions = { samples, transitions, historyRoom: historyId, passed: true };
    await open(a);
    scroll(1);
    await trustedClick(document.querySelector('.shiye-sidebar-fallback'));
  }
};
