/* Real WebView2, isolated synthetic profile; no formal diary operations. */
(async () => {
  const result = {
    kind: 'ui-verification',
    startedAt: new Date().toISOString(),
    checks: [],
    errors: [],
    runtimeErrors: [],
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function expect(value, name) {
    if (!value) throw Error(name);
    result.checks.push(name);
  }
  async function until(read, name) {
    for (let i = 0; i < 100; i++) {
      if (read()) return;
      await wait(100);
    }
    throw Error(name);
  }
  window.addEventListener('error', (event) => result.runtimeErrors.push(event.message));
  window.addEventListener('unhandledrejection', (event) =>
    result.runtimeErrors.push(String(event.reason)),
  );
  try {
    // Exercise the legacy timed-list paths first; the sidebar default is verified with settings below.
    localStorage.setItem('shiye-room-switch-mode-v1', 'list');
    let hostState;
    result.workspaceLaunches = [];
    window.chrome.webview.addEventListener('message', ({ data }) => {
      if (data.kind === 'window-state') hostState = data;
      if (data.kind === 'maintenance-status') result.maintenanceReceipt = data.result;
      if (data.kind === 'display-memory-verification') result.displayMemory = data.result;
      if (data.kind === 'workspace-launch-result') result.workspaceLaunches.push(data);
    });
    window.chrome.webview.postMessage({ kind: 'verify-maintenance-status' });
    await until(() => result.maintenanceReceipt, '读取当前原生宿主版本回执');
    expect(
      result.maintenanceReceipt.ready &&
        result.maintenanceReceipt.uiRevision === window.shiyeFrameUiVersion &&
        result.maintenanceReceipt.pid > 0,
      '维护状态报告实际加载的前端修订号',
    );
    result.scriptIdentity = [];
    for (const file of ['shiye-chat-ui.js', 'shiye-preview.js']) {
      const scripts = [...document.scripts].filter(
        (script) => script.src && new URL(script.src).pathname.endsWith('/' + file),
      );
      const identity = { file, sources: scripts.map((script) => script.src) };
      result.scriptIdentity.push(identity);
      expect(scripts.length === 1, '启动仅有一个实际脚本入口：' + file);
      const url = new URL(scripts[0].src);
      identity.src = url.href;
      identity.queryVersion = url.searchParams.get('v');
      expect(url.origin === location.origin, '启动脚本保持当前本地来源：' + file);
      // Fetch exactly the script URL already in the document; do not clear or bypass caches.
      const response = await fetch(url.href);
      identity.responseUrl = response.url;
      identity.status = response.status;
      expect(response.ok, '启动脚本同URL响应成功：' + file);
      const bytes = await response.arrayBuffer();
      identity.bytes = bytes.byteLength;
      identity.sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      identity.queryMatchesContent = identity.queryVersion === identity.sha256.slice(0, 12);
      expect(identity.queryMatchesContent, '启动脚本版本查询与响应内容一致：' + file);
    }
    await until(
      () => document.querySelector('#editable-message-text')?.editor,
      '首开自动选择当前会话并挂载输入框',
    );
    const startupInput = document.querySelector('#editable-message-text');
    expect(document.activeElement === startupInput, '首次打开不点击输入框即已自然聚焦');
    const { native, key, trustedClick } = await window.shiyeVerifyInput({
      result,
      wait,
      until,
      expect,
    });
    const startupDraft = startupInput.textContent;
    await native('Input.insertText', { text: '首开直接输入验收' });
    await wait(150);
    expect(
      startupInput.textContent === startupDraft + '首开直接输入验收',
      '首开原生输入直接追加到既有草稿末尾',
    );
    result.startupFocus = { target: document.activeElement.id, appended: true };
    document.execCommand('selectAll');
    document.execCommand('insertText', false, startupDraft);
    window.chrome.webview.postMessage({ kind: 'verify-display-memory' });
    await until(() => result.displayMemory, '显示屏独立记忆验证完成');
    for (const [key, label] of Object.entries({
      firstVisit: '新显示屏继承当前字号并建立独立记录',
      returnToA: '返回屏幕A恢复原窗口尺寸和字号',
      returnToB: '返回屏幕B恢复不同窗口尺寸和字号',
      restart: '重启序列化保留各显示屏独立设置',
      disconnectedPreserved: '断开显示屏的记忆保留',
      geometry: '分辨率DPI和屏幕坐标变化后安全适配',
      narrowRestart: '360DIP窄窗口序列化后按DPI恢复宽度',
      narrowReturn: '返回显示屏不被旧700宽度约束撑大',
    }))
      expect(result.displayMemory[key], label);
    window.chrome.webview.postMessage({ kind: 'zoom-step', step: 0 });
    window.chrome.webview.postMessage({ kind: 'verify-viewport', width: 1180, height: 820 });
    await until(() => innerWidth > 925, '重置隔离验收窗口尺寸');
    window.chrome.webview.postMessage({ kind: 'get-window-state' });
    await until(() => hostState?.workspaces, '标题栏写作入口状态');
    expect(
      hostState.workspaces.noOverlap && hostState.workspaces.buttons.length === 2,
      '标题栏左侧两入口与窗口控制不重叠',
    );
    expect(
      hostState.workspaces.buttons.map((button) => button.name).join() === '打开思绪,打开便签',
      '入口保持明确可访问名称',
    );
    for (const workspace of ['quick', 'notes']) {
      window.chrome.webview.postMessage({ kind: 'verify-workspace-launch', workspace });
      await until(
        () => result.workspaceLaunches.some((entry) => entry.workspace === workspace),
        '验证现有工作区启动计划',
      );
      const launch = result.workspaceLaunches.find((entry) => entry.workspace === workspace);
      expect(
        !launch.error && launch.verification && launch.plan?.Kind === workspace,
        '原生按钮连接固定入口且隔离检查不启动真实窗口：' + workspace,
      );
    }
    await until(() => document.querySelectorAll('.ListItem.Chat').length >= 3, '会话就绪');
    if (document.body.dataset.shiyeSidebar === 'collapsed')
      await trustedClick(document.querySelector('.shiye-sidebar-fallback'));
    await wait(300);
    const first = [...document.querySelectorAll('.ListItem.Chat')].find((item) =>
      item.textContent.includes('随手记'),
    );
    await trustedClick(first.querySelector('.ListItem-button'));
    await until(() => document.querySelector('#editable-message-text'), '编辑器就绪');
    await wait(700);
    function input() {
      return document.querySelector('#editable-message-text');
    }
    async function replace(text) {
      input().focus();
      document.execCommand('selectAll');
      document.execCommand('insertText', false, text);
      await wait(150);
    }
    await replace('多行草稿\n继续输入到这里');
    const room = window.shiyeRoomUi.currentId();
    await key('ArrowUp', 'ArrowUp', 38);
    expect(window.shiyeRoomUi.currentId() === room, '非空输入方向键不切换对话');
    expect(input().textContent.includes('继续输入到这里'), '方向键保留草稿');
    window.dispatchEvent(new Event('shiye-focus-end'));
    await wait(100);
    expect(
      input().editor.state.selection.to === input().editor.state.doc.content.size - 1,
      '聚焦末尾使用编辑器事务',
    );
    localStorage.setItem('shiye-switch-delay', '1600');
    await key('Escape', 'Escape', 27);
    await until(() => document.querySelector('.shiye-room-switcher[open]'), 'Esc 弹出列表');
    expect(Boolean(document.querySelector('.shiye-room-switcher[open]')), '首次 Esc 弹列表');
    const selectedBefore = document.querySelector(
      '.shiye-room-choices [aria-current=true]',
    ).textContent;
    await key('Escape', 'Escape', 27);
    expect(
      document.querySelector('.shiye-room-choices [aria-current=true]').textContent !==
        selectedBefore,
      '再次 Esc 向下选择',
    );
    await key('ArrowUp', 'ArrowUp', 38);
    expect(
      document.querySelector('.shiye-room-choices [aria-current=true]').textContent ===
        selectedBefore,
      '切换列表允许方向键',
    );
    await wait(900);
    expect(
      Boolean(document.querySelector('.shiye-room-switcher[open]')),
      '未达到等待时间不提前进入',
    );
    await until(() => !document.querySelector('.shiye-room-switcher[open]'), '停顿自动进入');
    expect(
      window.shiyeRoomUi.currentId() === room && Boolean(input()),
      '停顿回到所选对话，无空白页',
    );
    await wait(400);
    expect(input().textContent.includes('继续输入到这里'), 'Esc 切换保留草稿');
    localStorage.removeItem('shiye-switch-delay');
    await key('Escape', 'Escape', 27);
    await key('Escape', 'Escape', 27);
    const nextRoomLabel = document.querySelector(
      '.shiye-room-choices [aria-current=true]',
    ).textContent;
    const nextChoice = document
      .querySelector('.shiye-room-choices [aria-current=true]')
      .getBoundingClientRect();
    await native('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: nextChoice.x + 20,
      y: nextChoice.y + 15,
    });
    await wait(900);
    expect(
      Boolean(document.querySelector('.shiye-room-switcher[open]')),
      '鼠标移动后等待完整的默认一千二百毫秒',
    );
    await until(() => window.shiyeRoomUi.currentId() !== room, '鼠标停止后自动进入另一会话');
    const nextRoom = window.shiyeRoomUi.currentId();
    await until(() => input(), '另一会话编辑器就绪');
    await wait(500);
    await replace('另一会话独立草稿');
    async function chooseRoom(label) {
      await key('Escape', 'Escape', 27);
      const choice = [...document.querySelectorAll('.shiye-room-choices button')].find(
        (button) => button.textContent === label,
      );
      await trustedClick(choice);
      await wait(550);
    }
    await chooseRoom('随手记');
    await until(
      () =>
        window.shiyeRoomUi.currentId() === room && input()?.textContent.includes('继续输入到这里'),
      '切回原会话草稿恢复',
    );
    expect(
      input().editor.state.selection.to === input().editor.state.doc.content.size - 1,
      '跨会话切回草稿光标位于末尾',
    );
    await chooseRoom(nextRoomLabel);
    await until(
      () =>
        window.shiyeRoomUi.currentId() === nextRoom &&
        input()?.textContent.includes('另一会话独立草稿'),
      '另一会话草稿独立保存',
    );
    expect(input().textContent.includes('另一会话独立草稿'), '跨会话往返不混写草稿');
    await chooseRoom('随手记');
    await until(() => window.shiyeRoomUi.currentId() === room, '返回主验收会话');
    await key('Escape', 'Escape', 27);
    await key('Escape', 'Escape', 27);
    document.querySelector('.shiye-room-switcher header button').focus();
    await key('Enter', 'Enter', 13);
    await wait(1000);
    expect(
      !document.querySelector('.shiye-room-switcher[open]') &&
        window.shiyeRoomUi.currentId() === room,
      '取消按钮聚焦时 Enter 取消且不残留跳转',
    );
    await replace('/');
    await until(() => document.querySelector('#shiye-commands'), '斜杠候选');
    await key('Escape', 'Escape', 27);
    expect(
      !document.querySelector('#shiye-commands') &&
        !document.querySelector('.shiye-room-switcher[open]') &&
        Boolean(input()),
      '命令 Esc 不穿透为空白页或切换列表',
    );
    await replace('');
    await key('ArrowUp', 'ArrowUp', 38);
    await key('ArrowDown', 'ArrowDown', 40);
    expect(
      window.shiyeRoomUi.currentId() === room &&
        !document.querySelector('.shiye-room-switcher[open]'),
      '空输入方向键也不切换或唤起会话',
    );
    expect(
      !input().textContent && !document.querySelector('.ComposerEmbeddedMessage.open'),
      '空输入方向键不误进入历史消息编辑',
    );
    await trustedClick(document.querySelector('.shiye-symbol-button'));
    await until(
      () => document.querySelector('.shiye-emoji-grid button') === document.activeElement,
      '表情首项焦点',
    );
    expect(document.activeElement.closest('.shiye-emoji-grid'), '表情面板不默认聚焦关闭');
    await key('ArrowRight', 'ArrowRight', 39);
    const selectedEmoji = document.activeElement.textContent;
    await key('Enter', 'Enter', 13);
    await wait(200);
    expect(
      input().textContent.includes(selectedEmoji) ||
        input().querySelector(`img[alt="${selectedEmoji}"]`),
      '方向键和 Enter 插入表情',
    );
    await key('ArrowUp', 'ArrowUp', 38);
    expect(window.shiyeRoomUi.currentId() === room, '只有 emoji 的草稿也不被方向键切走');
    await replace('   ');
    await key('ArrowDown', 'ArrowDown', 40);
    expect(window.shiyeRoomUi.currentId() === room, '只有空格的输入不被方向键切走');
    await replace('\n\n');
    await key('ArrowUp', 'ArrowUp', 38);
    expect(window.shiyeRoomUi.currentId() === room, '只有换行的草稿不被方向键切走');
    await trustedClick(document.querySelector('.shiye-symbol-button'));
    await until(
      () => document.querySelector('.shiye-emoji-grid button') === document.activeElement,
      '排序后焦点',
    );
    expect(document.activeElement.textContent === selectedEmoji, '常用表情按频次排前');
    await key('Escape', 'Escape', 27);
    expect(!document.querySelector('.shiye-room-switcher[open]'), '表情 Esc 不触发对话切换');
    await window.shiyeVerifyEmoji({ input, replace, key, wait, until, expect, result });
    const messageMarker = '发送滚动验收' + Date.now();
    await replace(messageMarker + '：' + '多行内容用于检查底部显示。'.repeat(18));
    await key('Enter', 'Enter', 13);
    await until(
      () =>
        [...document.querySelectorAll('.Message')].some((item) =>
          item.textContent.includes(messageMarker),
        ),
      '消息发送显示',
    );
    await wait(2100);
    const message = [...document.querySelectorAll('.Message')].find((item) =>
      item.textContent.includes(messageMarker),
    );
    const footer = document.querySelector('#MiddleColumn .middle-column-footer');
    expect(
      message.getBoundingClientRect().bottom <= footer.getBoundingClientRect().top + 2,
      '发送后完整显示最新消息末尾',
    );
    expect(
      [...message.querySelectorAll('.svg-appendix')].every(
        (item) => getComputedStyle(item).display === 'none',
      ),
      '文字气泡不显示三角尾巴',
    );
    await native('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: message.getBoundingClientRect().x + 30,
      y: message.getBoundingClientRect().y + 20,
      button: 'right',
      clickCount: 1,
    });
    await native('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: message.getBoundingClientRect().x + 30,
      y: message.getBoundingClientRect().y + 20,
      button: 'right',
      clickCount: 1,
    });
    await wait(400);
    expect(
      Boolean(document.querySelector('.MessageContextMenu .bubble.open')),
      '右键消息菜单正常打开',
    );
    expect(!result.runtimeErrors.length, '右键无运行时异常');
    await key('Escape', 'Escape', 27);
    await wait(200);
    await replace('引用前已有文字');
    for (const type of ['mousePressed', 'mouseReleased'])
      await native('Input.dispatchMouseEvent', {
        type,
        x: message.getBoundingClientRect().x + 30,
        y: Math.max(50, message.getBoundingClientRect().y + 20),
        button: 'right',
        clickCount: 1,
      });
    await until(
      () => document.querySelector('.MessageContextMenu .bubble.open'),
      '再次打开消息菜单',
    );
    const replyButton = document
      .querySelector('.MessageContextMenu .icon-reply')
      ?.closest('.MenuItem');
    expect(Boolean(replyButton), '消息右键有引用入口');
    await trustedClick(replyButton);
    await until(() => document.querySelector('.ComposerEmbeddedMessage.open'), '引用进入输入区');
    await wait(300);
    expect(input().textContent.includes('引用前已有文字'), '添加引用保留已有草稿');
    expect(
      input().editor.state.selection.to === input().editor.state.doc.content.size - 1,
      '添加引用后光标落在已有文字末尾',
    );
    await replace('');
    await key('ArrowUp', 'ArrowUp', 38);
    expect(window.shiyeRoomUi.currentId() === room, '只有引用时方向键也不会误切换对话');
    const replyCancel = document.querySelector('.ComposerEmbeddedMessage.open .embedded-cancel');
    await trustedClick(replyCancel);
    await until(() => !document.querySelector('.ComposerEmbeddedMessage.open'), '取消引用');
    expect(!input().textContent, '引用取消后不残留误触发的消息编辑内容');
    const typographyMarker = '合成字号验收普通文本 ' + result.startedAt;
    const typographyRoomId = window.shiyeRoomUi.currentId();
    let typographyMessageId;
    function findTypographyBody() {
      for (const root of document.querySelectorAll('.Message.own[data-message-id]')) {
        if (root.closest('.MessageList')?.dataset.listKey !== `${typographyRoomId}_-1_thread`)
          continue;
        if (typographyMessageId && root.dataset.messageId !== typographyMessageId) continue;
        const body = root.querySelector('.text-content');
        const bubble = body?.closest('.message-content.has-solid-background');
        if (
          !body ||
          !bubble ||
          !body.getClientRects().length ||
          !body.textContent.includes(typographyMarker)
        )
          continue;
        if (
          root.querySelector(
            '.shiye-emoji-message, .media-inner, .embedded-message, .MessageReplyInfo, pre, code',
          )
        )
          continue;
        return { root, body, bubble };
      }
      return undefined;
    }
    await replace(typographyMarker);
    await key('Enter', 'Enter', 13);
    await until(() => {
      const found = findTypographyBody();
      return found && Number.isInteger(Number(found.root.dataset.messageId));
    }, '本轮纯文本字号夹具完成确认并实际挂载');
    typographyMessageId = findTypographyBody().root.dataset.messageId;
    result.typographyFixture = {
      roomId: typographyRoomId,
      messageId: typographyMessageId,
      markerMatched: true,
      solidTextBubble: true,
      excludedEmojiMediaQuoteCode: true,
    };
    const typography = () => {
      const found = findTypographyBody();
      expect(Boolean(found), '字号验收锁定本轮同一ID真实纯文本气泡');
      const placeholder = input().parentElement.querySelector('.placeholder-text');
      const style = getComputedStyle(found.bubble);
      return {
        messageId: found.root.dataset.messageId,
        roomId: typographyRoomId,
        message: parseFloat(getComputedStyle(found.body).fontSize),
        input: parseFloat(getComputedStyle(input()).fontSize),
        placeholder: parseFloat(getComputedStyle(placeholder).fontSize),
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      };
    };
    const textBeforeZoom = typography();
    expect(
      Math.abs(textBeforeZoom.input - textBeforeZoom.placeholder) < 0.1,
      '输入与空提示字号一致',
    );
    const iconSize = document.querySelector('.shiye-symbol-button').getBoundingClientRect().width;
    window.chrome.webview.postMessage({ kind: 'zoom-step', step: 1 });
    await wait(300);
    const textAfterZoom = typography();
    result.independentFontZoom = { before: textBeforeZoom, after: textAfterZoom };
    expect(textAfterZoom.messageId === textBeforeZoom.messageId, '消息缩放前后测量同一确认消息ID');
    expect(textAfterZoom.message > textBeforeZoom.message, '快捷缩放增大实际消息文字');
    expect(Math.abs(textAfterZoom.input - textBeforeZoom.input) < 0.1, '消息缩放保持独立输入字号');
    expect(
      Math.abs(textAfterZoom.placeholder - textBeforeZoom.placeholder) < 0.1,
      '消息缩放保持空提示字号',
    );
    expect(
      JSON.stringify(textAfterZoom.padding) === JSON.stringify(textBeforeZoom.padding),
      '消息缩放保持气泡CSS留白',
    );
    expect(
      Math.abs(
        document.querySelector('.shiye-symbol-button').getBoundingClientRect().width - iconSize,
      ) < 1,
      '文字缩放不放大图标',
    );
    window.chrome.webview.postMessage({ kind: 'zoom-step', step: 0 });
    await wait(300);
    document.body.dataset.shiyeAlign = 'left';
    await wait(100);
    const sidebar = document.querySelector('#LeftColumn').getBoundingClientRect();
    const middle = document.querySelector('#MiddleColumn').getBoundingClientRect();
    expect(sidebar.left >= middle.right - 2, '消息靠左时对话栏镜像到右侧');
    expect(
      document.querySelector('.shiye-sidebar-fallback').getBoundingClientRect().left >
        innerWidth / 2,
      '折叠按钮镜像到右侧',
    );
    document.body.dataset.shiyeAlign = 'right';
    expect(Boolean(document.querySelector('.shiye-input-resizer')), '输入框高度调节入口');
    await window.shiyeVerifyComposer({
      input,
      replace,
      native,
      wait,
      expect,
      result,
      chooseRoom,
      nextRoomLabel,
    });
    await replace('');
    const oldInputHeight = input().closest('.input-scroller').getBoundingClientRect().height;
    const oldBubbleHeight = message.getBoundingClientRect().height;
    document.querySelector('.shiye-input-resizer').focus();
    await key('ArrowUp', 'ArrowUp', 38);
    await wait(200);
    expect(
      input().closest('.input-scroller').getBoundingClientRect().height > oldInputHeight + 10,
      '输入高度可实际调大',
    );
    expect(
      Math.abs(message.getBoundingClientRect().height - oldBubbleHeight) < 2,
      '调高输入框不会同时拉高所有气泡',
    );
    await replace('长草稿\n'.repeat(40) + '末行可见');
    window.dispatchEvent(new Event('shiye-focus-end'));
    await wait(250);
    expect(
      (() => {
        const s = input().closest('.input-scroller');
        return s.scrollHeight - s.scrollTop - s.clientHeight < 25;
      })(),
      '长草稿可滚动至末尾',
    );
    window.dispatchEvent(new Event('shiye-open-settings'));
    await until(() => document.querySelector('[data-appearance]'), '外观设置入口');
    await trustedClick(document.querySelector('[data-appearance]'));
    const switchDelay = document.querySelector('#shiyeSwitchDelay');
    expect(switchDelay.value === '1200', 'Esc 默认等待延长为 1200ms');
    switchDelay.value = '1900';
    switchDelay.dispatchEvent(new Event('change', { bubbles: true }));
    expect(window.shiyeSwitchDelay.get() === 1900, 'Esc 自定义等待立即保存');
    window.shiyeSwitchDelay.set(1200);
    localStorage.removeItem('shiye-switch-delay');
    const spacing = document.querySelector('#shiyeMessageGap');
    spacing.value = '22';
    spacing.dispatchEvent(new Event('input', { bubbles: true }));
    expect(
      parseFloat(getComputedStyle(document.querySelector('.Message.own')).marginBottom) === 22,
      '消息间距设置实际改变气泡间隔',
    );
    spacing.value = '10';
    spacing.dispatchEvent(new Event('input', { bubbles: true }));
    await key('Escape', 'Escape', 27);
    expect(
      !document.querySelector('[data-shiye-settings-page="appearance"][open]') &&
        Boolean(
          document.querySelector(
            '[data-shiye-settings-page="root"][open][data-settings-active="true"]',
          ),
        ) &&
        window.shiyeRoomUi.currentId() === room,
      '外观页 Esc 返回真实设置父层并保留对话',
    );
    await trustedClick(
      document.querySelector('[data-shiye-settings-page="root"] [data-settings-close]'),
    );
    expect(!document.querySelector('.shiye-settings-dialog[open]'), '根设置关闭后退出全部设置层');
    async function closeSettingsChildToChat(page) {
      const currentRoom = window.shiyeRoomUi.currentId();
      expect(
        Boolean(document.querySelector(`[data-shiye-settings-page="${page}"][open]`)),
        page + '设置子页实际打开',
      );
      await key('Escape', 'Escape', 27);
      expect(
        !document.querySelector(`[data-shiye-settings-page="${page}"][open]`) &&
          Boolean(
            document.querySelector(
              '[data-shiye-settings-page="root"][open][data-settings-active="true"]',
            ),
          ) &&
          window.shiyeRoomUi.currentId() === currentRoom,
        page + '设置Esc返回真实父层且保留会话',
      );
      await trustedClick(
        document.querySelector('[data-shiye-settings-page="root"] [data-settings-close]'),
      );
      expect(
        !document.querySelector('.shiye-settings-dialog[open]'),
        page + '设置根页关闭后恢复聊天',
      );
    }
    window.dispatchEvent(new Event('shiye-open-settings'));
    await until(() => document.querySelector('[data-desktop]'), '后台设置入口');
    await trustedClick(document.querySelector('[data-desktop]'));
    const hideDelay = document.querySelector('#shiyeDockHideDelay');
    const hoverActivate = document.querySelector('#shiyeHoverActivate');
    expect(!hoverActivate.checked, '悬停激活输入默认关闭');
    hoverActivate.checked = true;
    hideDelay.value = '150';
    await trustedClick(document.querySelector('[data-save-desktop]'));
    await until(() => hostState?.dockHideDelayMs === 150, '原生宿主收到并保存 150ms 收起等待');
    expect(hostState.dockHideDelayMs === 150, '收起等待设置通过真实宿主桥保存');
    expect(hostState.dockActivateOnHover === true, '悬停激活选项经原生桥保存');
    await closeSettingsChildToChat('desktop');
    window.dispatchEvent(new Event('shiye-open-settings'));
    await until(() => document.querySelector('[data-desktop]'), '重新打开后台设置');
    await trustedClick(document.querySelector('[data-desktop]'));
    const reopenedDelay = document.querySelector('#shiyeDockHideDelay');
    const reopenedHover = document.querySelector('#shiyeHoverActivate');
    expect(reopenedHover.checked, '重开设置保留悬停激活选项');
    reopenedHover.checked = false;
    expect(reopenedDelay.value === '150', '重新打开设置保留收起等待');
    expect(reopenedDelay.min === '0' && reopenedDelay.step === '10', '收起等待支持0ms和10ms微调');
    for (const value of [50, 20, 0]) {
      reopenedDelay.value = String(value);
      await trustedClick(document.querySelector('[data-save-desktop]'));
      await until(() => hostState?.dockHideDelayMs === value, '原生保存短收起等待' + value);
      expect(hostState.dockHideDelayMs === value, '小于100ms收起等待不被抬高：' + value);
    }
    await closeSettingsChildToChat('desktop');
    window.dispatchEvent(new Event('shiye-open-settings'));
    await trustedClick(document.querySelector('[data-desktop]'));
    expect(document.querySelector('#shiyeDockHideDelay').value === '0', '0ms重新打开设置仍保留');
    // Continue with the current dialog after reopening.
    const finalDelay = document.querySelector('#shiyeDockHideDelay');
    finalDelay.value = '-10';
    await trustedClick(document.querySelector('[data-save-desktop]'));
    expect(finalDelay.value === '0', '负收起等待纠正为0ms');
    finalDelay.value = '';
    await trustedClick(document.querySelector('[data-save-desktop]'));
    await until(() => hostState?.dockHideDelayMs === 350, '空收起等待使用默认值');
    expect(finalDelay.value === '350', '空值不误保存成0ms');
    finalDelay.value = '9999';
    await trustedClick(document.querySelector('[data-save-desktop]'));
    await until(() => hostState?.dockHideDelayMs === 3000, '收起等待上限生效');
    expect(finalDelay.value === '3000', '收起等待超出范围时纠正为 3000ms');
    finalDelay.value = '350';
    await trustedClick(document.querySelector('[data-save-desktop]'));
    await until(() => hostState?.dockHideDelayMs === 350, '恢复 350ms 默认收起等待');
    await closeSettingsChildToChat('desktop');
    window.dispatchEvent(new Event('shiye-open-settings'));
    await until(() => document.querySelector('[data-messages]'), '消息设置入口');
    await trustedClick(document.querySelector('[data-messages]'));
    const gap = document.querySelector('#shiyeTimeGap');
    const oldGap = localStorage.getItem('shiye-time-gap-minutes');
    if (!oldGap) expect(gap.value === '15', '未设置时默认十五分钟时间分隔');
    gap.value = '17';
    gap.dispatchEvent(new Event('change', { bubbles: true }));
    expect(localStorage.getItem('shiye-time-gap-minutes') === '17', '时间分隔可调并持久保存');
    if (oldGap) localStorage.setItem('shiye-time-gap-minutes', oldGap);
    else localStorage.removeItem('shiye-time-gap-minutes');
    window.dispatchEvent(new Event('shiye-time-gap-changed'));
    await closeSettingsChildToChat('messages');
    expect(
      Boolean(input()) && window.shiyeRoomUi.currentId() === room,
      '消息设置 Esc 不进入空白页',
    );
    window.dispatchEvent(new Event('shiye-open-settings'));
    await until(() => document.querySelector('[data-appearance]'), '再次打开外观');
    await trustedClick(document.querySelector('[data-appearance]'));
    const align = document.querySelector('#shiyeMessageAlign');
    align.value = 'left';
    align.dispatchEvent(new Event('change', { bubbles: true }));
    await closeSettingsChildToChat('appearance');
    window.chrome.webview.postMessage({ kind: 'verify-viewport', width: 800, height: 700 });
    await until(() => innerWidth < 925, '真实原生窄窗口');
    await wait(300);
    expect(
      document.querySelector('#LeftColumn').getBoundingClientRect().right <= innerWidth + 2,
      '窄窗口右侧栏不越过屏幕',
    );
    async function waitForSidebarCollapsed() {
      const sidebar = document.querySelector('#LeftColumn');
      for (let attempt = 0; attempt < 60; attempt++) {
        if (getComputedStyle(sidebar).display === 'none' && !sidebar.getAnimations().length) return;
        await wait(25);
      }
      throw Error('侧栏收起在1500ms内完成并释放动画');
    }
    await trustedClick(document.querySelector('.shiye-sidebar-fallback'));
    await waitForSidebarCollapsed();
    expect(
      getComputedStyle(document.querySelector('#LeftColumn')).display === 'none',
      '窄窗口侧栏可以折叠',
    );
    expect(
      document.querySelector('#MiddleColumn').getBoundingClientRect().width >= innerWidth - 2,
      '窄窗口折叠后内容占满可用宽度',
    );
    await trustedClick(document.querySelector('.shiye-sidebar-fallback'));
    expect(
      document.querySelector('.shiye-sidebar-fallback').getBoundingClientRect().left >
        innerWidth / 2,
      '窄窗口展开后镜像入口仍在右侧',
    );
    await trustedClick(document.querySelector('.shiye-sidebar-fallback'));
    await waitForSidebarCollapsed();
    expect(!window.shiyeProgramPort.connected, '程序消息端口默认未连接');
    await window.shiyeVerifyComposer({
      input,
      replace,
      native,
      wait,
      expect,
      result,
      chooseRoom,
      nextRoomLabel,
    });
    let disconnected = false;
    try {
      await window.shiyeProgramPort.send({ roomId: room, text: '合成程序请求' });
    } catch {
      disconnected = true;
    }
    expect(disconnected, '未连接后端时不会伪造程序收发成功');
    let dockResult;
    window.chrome.webview.addEventListener('message', ({ data }) => {
      if (data.kind === 'dock-verification') dockResult = data.result;
    });
    window.chrome.webview.postMessage({ kind: 'verify-dock' });
    await until(() => dockResult, '原生吸附动画验收');
    result.dock = dockResult;
    expect(dockResult.corrected && dockResult.horizontal, '越界拉回并优先左右吸附');
    expect(dockResult.visibleStrip, '动画收起后保留 6 DIP 可见边');
    expect(dockResult.restored, '反向动画恢复展开位置');
    expect(dockResult.repeatedDisplayFont, '重复显示适配后字体仍可测量和绘制');
    expect(dockResult.continuousReversal, '动画中反向展开保持位置连续');
    expect(dockResult.allPumpsStopped, '四边动画完成后均停止高频计时');
    expect(dockResult.frameSamples?.length === 10, '记录旧调度和四边新调度实际帧间隔');
    expect(dockResult.previousPersistedHideDelayMs === 350, '零延迟夹具前回读已恢复350ms默认设置');
    expect(dockResult.persistedHideDelayMs === 0, '0ms实际收起后从原生设置文件回读仍为0ms');
    expect(dockResult.zeroDelayStarts, '0ms在首次离开检测即开始收起，不额外等待');
    expect(dockResult.hoverActivationOptIn, '原生悬停展开仅在选择开启时请求激活输入');
    expect(
      dockResult.delayHonored && dockResult.busyPauses,
      '原生收起策略遵守等待时间并在忙碌时重置',
    );
    expect(dockResult.savesConcurrently, '收起动画开始时草稿保存仍并行进行');
    expect(dockResult.hoverWhileSaving, '保存期间鼠标回到露边仍可立即展开');
    await replace('');
    const oldTypography = typography();
    for (let step = 0; step < 25; step++)
      window.chrome.webview.postMessage({ kind: 'zoom-step', step: 1 });
    await wait(500);
    expect(typography().message >= oldTypography.message * 1.95, '200% 消息字号实际生效');
    expect(
      Math.abs(
        document.querySelector('.shiye-symbol-button').getBoundingClientRect().width - iconSize,
      ) < 1,
      '200% 字号下图标仍保持合理尺寸',
    );
    const largeTypography = typography();
    expect(largeTypography.messageId === oldTypography.messageId, '200%字号前后测量同一确认消息ID');
    expect(Math.abs(largeTypography.input - oldTypography.input) < 0.1, '200%消息字号不放大输入');
    expect(
      Math.abs(largeTypography.placeholder - oldTypography.placeholder) < 0.1,
      '200%消息字号不放大空提示',
    );
    expect(
      JSON.stringify(largeTypography.padding) === JSON.stringify(oldTypography.padding),
      '200%消息字号不改变气泡CSS留白',
    );
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 640;
    const context = canvas.getContext('2d');
    context.fillStyle = '#284d55';
    context.fillRect(0, 0, 960, 640);
    context.fillStyle = '#e6f1ef';
    context.font = '42px sans-serif';
    context.fillText('Shiye UI · 960 × 640', 80, 180);
    context.strokeStyle = '#84bcb4';
    for (let x = 0; x < 960; x += 80) {
      context.beginPath();
      context.moveTo(x, 240);
      context.lineTo(x, 640);
      context.stroke();
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    await window.shiyeVerifyMediaInput({
      blob,
      input,
      replace,
      key,
      wait,
      until,
      expect,
      result,
    });
    const stickerId = 'sticker:' + crypto.randomUUID();
    const stickerName = '排行验收' + Date.now() + '.png';
    await window.shiyeLocalAssets.put({ id: stickerId, name: stickerName, blob });
    await replace('图片之前已有文字');
    await trustedClick(document.querySelector('.shiye-symbol-button'));
    await trustedClick(document.querySelector('[data-tab=sticker]'));
    await until(
      () => document.querySelector(`.shiye-sticker-grid button[title="${stickerName}"]`),
      '表情包网格',
    );
    await trustedClick(
      document.querySelector(`.shiye-sticker-grid button[title="${stickerName}"]`),
    );
    await until(() => document.querySelector('.Modal.open .shiye-media-cancel'), '表情包确认预览');
    await key('Escape', 'Escape', 27);
    await until(() => !document.querySelector('.Modal.open'), '取消表情包预览');
    await wait(250);
    expect(
      !JSON.parse(localStorage.getItem('shiye-symbol-usage-v1') || '{}')[stickerId],
      '取消表情包不增加使用次数',
    );
    expect(window.shiyeRoomUi.currentId() === room, '图片确认 Esc 不穿透切换对话');
    let editor;
    await until(() => {
      window.dispatchEvent(
        new CustomEvent('shiye-editor-request', {
          detail: {
            receive(value) {
              editor = value;
            },
          },
        }),
      );
      return editor;
    }, '图片取消后主编辑器恢复');
    await wait(800);
    expect(input().textContent.includes('图片之前已有文字'), '图片取消保留已有文字');
    expect(
      input().editor.state.selection.to === input().editor.state.doc.content.size - 1,
      '图片取消恢复光标到已有文字末尾',
    );
    editor.files([new File([blob], '合成图片验收.png', { type: 'image/png' })]);
    await until(() => document.querySelector('[aria-label="确认发送"]'), '图片确认弹窗');
    await wait(700);
    const confirm = document.querySelector('[aria-label="确认发送"]');
    const cancel = document.querySelector('.shiye-media-cancel');
    const attachmentDialog = confirm.closest('.Modal').querySelector('.modal-dialog');
    const caption = document.querySelector('#editable-message-text-modal');
    caption.focus();
    document.execCommand('insertText', false, '说明文字保持可编辑，按钮不随文字膨胀。\n'.repeat(5));
    const geometry = [];
    const captionFontBeforeZoom = parseFloat(getComputedStyle(caption).fontSize);
    result.attachmentGeometry = geometry;
    for (const steps of [0, 13, 25]) {
      window.chrome.webview.postMessage({ kind: 'zoom-step', step: 0 });
      for (let step = 0; step < steps; step++)
        window.chrome.webview.postMessage({ kind: 'zoom-step', step: 1 });
      await wait(250);
      for (const width of [420, 320]) {
        attachmentDialog.style.setProperty('width', `${width}px`, 'important');
        await wait(120);
        const sendBox = confirm.getBoundingClientRect();
        const cancelBox = cancel.getBoundingClientRect();
        const dialogBox = attachmentDialog.getBoundingClientRect();
        const emoji = confirm
          .closest('.Modal')
          .querySelector('.shiye-symbol-button, .symbol-menu-button, .mobile-symbol-menu-button');
        const range = document.createRange();
        range.selectNodeContents(cancel);
        const scale = Math.round((1 + steps * 0.04) * 100);
        result.attachmentLayout = {
          sendClass: confirm.className,
          cancelClass: cancel.className,
          sendWidth: sendBox.width,
          cancelWidth: cancelBox.width,
          sendRight: sendBox.right,
          dialogRight: dialogBox.right,
          sendLeft: sendBox.left,
          cancelRight: cancelBox.right,
          iconClass: confirm.querySelector('.icon')?.className,
          sendStyle: {
            width: getComputedStyle(confirm).width,
            flex: getComputedStyle(confirm).flex,
            padding: getComputedStyle(confirm).padding,
          },
        };
        expect(
          cancelBox.width >= 64 && range.getBoundingClientRect().height < 22,
          `${scale}%／${width}px：取消文字单行且宽度充足`,
        );
        expect(
          sendBox.width <= 48 &&
            sendBox.right <= dialogBox.right &&
            cancelBox.right <= sendBox.left,
          `${scale}%／${width}px：发送按钮不膨胀、不越界或重叠`,
        );
        expect(
          Math.abs(sendBox.top - cancelBox.top) < 2,
          `${scale}%／${width}px：动作按钮垂直对齐`,
        );
        expect(
          getComputedStyle(confirm.querySelector('.icon')).fontSize === '20px' &&
            getComputedStyle(emoji.querySelector('.icon')).fontSize === '20px',
          `${scale}%／${width}px：发送和表情图标均为 20px`,
        );
        expect(
          attachmentDialog.scrollWidth <= attachmentDialog.clientWidth + 1,
          `${scale}%／${width}px：弹窗没有横向溢出`,
        );
        const captionStyle = getComputedStyle(caption);
        expect(
          Math.abs(parseFloat(captionStyle.fontSize) - captionFontBeforeZoom) < 0.1,
          `${scale}%／${width}px：消息缩放不改变说明字号`,
        );
        const textWidth =
          caption.clientWidth -
          parseFloat(captionStyle.paddingLeft) -
          parseFloat(captionStyle.paddingRight);
        expect(
          textWidth >= parseFloat(captionStyle.fontSize) * 3,
          `${scale}%／${width}px：说明至少容纳三个汉字而非竖排`,
        );
        geometry.push({
          scale,
          width,
          sendWidth: sendBox.width,
          cancelWidth: cancelBox.width,
          captionFontSize: getComputedStyle(caption).fontSize,
          captionTextWidth: textWidth,
        });
      }
    }
    result.attachmentGeometry = geometry;
    const oldInputFont = document.body.style.getPropertyValue('--shiye-input-size');
    const messageBeforeInputChange = typography().message;
    result.captionInputFonts = [];
    for (const font of [16, 22, 32]) {
      document.body.style.setProperty('--shiye-input-size', font + 'px');
      await wait(100);
      const actual = parseFloat(getComputedStyle(caption).fontSize);
      result.captionInputFonts.push({ requested: font, actual });
      expect(Math.abs(actual - font) < 0.1, font + 'px独立输入字号实际应用到附件说明');
      expect(
        Math.abs(parseFloat(getComputedStyle(input()).fontSize) - font) < 0.1,
        font + 'px独立输入字号实际应用到主输入',
      );
      expect(
        Math.abs(typography().message - messageBeforeInputChange) < 0.1,
        '输入字号不改变消息字号',
      );
    }
    document.body.style.setProperty('--shiye-input-size', oldInputFont);
    await wait(100);
    let attachmentCaptured = false;
    const captionScroller = caption.closest('.input-scroller');
    captionScroller.scrollTop = captionScroller.scrollHeight;
    const captionBottom = captionScroller.scrollTop;
    const captionArea = captionScroller.getBoundingClientRect();
    await native('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: captionArea.left + captionArea.width / 2,
      y: captionArea.top + captionArea.height / 2,
      deltaX: 0,
      deltaY: -10000,
    });
    await wait(200);
    expect(
      captionBottom > 0 && captionScroller.scrollTop < captionBottom,
      '图片多行说明可用实际滚轮向上回看',
    );
    await native('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: captionArea.left + captionArea.width / 2,
      y: captionArea.top + captionArea.height / 2,
      deltaX: 0,
      deltaY: 10000,
    });
    await wait(200);
    expect(
      captionScroller.scrollHeight - captionScroller.clientHeight - captionScroller.scrollTop < 3,
      '图片说明实际滚轮可到末尾',
    );
    window.chrome.webview.addEventListener('message', ({ data }) => {
      if (data.kind === 'attachment-screenshot-ready') attachmentCaptured = true;
    });
    window.chrome.webview.postMessage({ kind: 'verify-attachment-screenshot' });
    await until(() => attachmentCaptured, '保存 200% 字号窄弹窗截图');
    caption.focus();
    document.execCommand('selectAll');
    document.execCommand('delete');
    attachmentDialog.style.removeProperty('width');
    expect(confirm.getBoundingClientRect().height <= 44, '图片确认发送按钮尺寸克制');
    expect(
      Math.abs(confirm.getBoundingClientRect().top - cancel.getBoundingClientRect().top) < 5,
      '图片确认和取消同排',
    );
    await trustedClick(confirm);
    await until(() => !document.querySelector('.Modal.open'), '图片已发送');
    expect(
      !JSON.parse(localStorage.getItem('shiye-symbol-usage-v1') || '{}')[stickerId],
      '取消表情包后发送普通图片不误计排行',
    );
    window.chrome.webview.postMessage({ kind: 'zoom-step', step: 0 });
    await wait(250);
    await trustedClick(document.querySelector('.shiye-symbol-button'));
    await trustedClick(document.querySelector('[data-tab=sticker]'));
    await until(
      () => document.querySelector(`.shiye-sticker-grid button[title="${stickerName}"]`),
      '重新选择表情包',
    );
    await trustedClick(
      document.querySelector(`.shiye-sticker-grid button[title="${stickerName}"]`),
    );
    await until(() => document.querySelector('[aria-label="确认发送"]'), '表情包发送确认');
    await trustedClick(document.querySelector('[aria-label="确认发送"]'));
    await until(() => !document.querySelector('.Modal.open'), '表情包已发送');
    expect(
      JSON.parse(localStorage.getItem('shiye-symbol-usage-v1') || '{}')[stickerId] === 1,
      '确认发送表情包后记录一次使用',
    );
    await wait(1000);
    const photo = [...document.querySelectorAll('.Message .media-inner img')]
      .filter((img) => img.naturalWidth > 100)
      .at(-1);
    expect(Boolean(photo), '合成图片显示在消息内');
    let imageOpened = false;
    let imageClosed = false;
    let embeddedImageOpened = false;
    const embeddedObserver = new MutationObserver(() => {
      if (document.querySelector('#MediaViewer[open]')) embeddedImageOpened = true;
    });
    embeddedObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    result.imageWindowStates = [];
    const originalViewport = { width: innerWidth, height: innerHeight };
    window.chrome.webview.addEventListener('message', ({ data }) => {
      if (data.kind === 'image-result' && !data.error) imageOpened = true;
      if (data.kind === 'image-closed') imageClosed = true;
      if (data.kind === 'image-verification') result.imageViewer = data;
      if (data.kind === 'image-window-state') result.imageWindowStates.push(data);
    });
    await trustedClick(photo);
    await until(() => imageOpened, '独立图片查看器打开');
    expect(imageOpened, '原图通过本机桥打开独立窗口');
    await until(() => result.imageViewer, '独立窗口滚轮和拖动验收');
    expect(!result.imageViewer.errors.length, '图片查看交互检查通过');
    await until(() => imageClosed, '图片 Esc 关闭独立窗口');
    await wait(250);
    expect(Boolean(input()) && window.shiyeRoomUi.currentId() === room, '图片关闭回原对话');
    expect(!embeddedImageOpened, '图片直达独立窗口不先打开再缩回内嵌查看器');
    expect(
      innerWidth === originalViewport.width && innerHeight === originalViewport.height,
      '打开图片不改变主窗口尺寸',
    );
    imageOpened = false;
    imageClosed = false;
    await trustedClick(photo);
    await until(() => result.imageWindowStates.length >= 2, '再次打开图片窗口并回读尺寸');
    const reopened = result.imageWindowStates[1];
    expect(
      reopened.restored && reopened.width === 720 && reopened.height === 520,
      '再次打开图片恢复上次720×520尺寸',
    );
    await until(() => imageClosed, '第二次图片窗口关闭');
    embeddedObserver.disconnect();
    await window.shiyeVerifyResponsive({
      input,
      replace,
      native,
      wait,
      until,
      expect,
      result,
      trustedClick,
      key,
    });
    localStorage.removeItem('shiye-switch-delay');
    await window.shiyeVerifyConversationSettings({
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
    });
    expect(result.runtimeErrors.length === 0, '整体无运行时异常');
    result.finishedAt = new Date().toISOString();
  } catch (error) {
    result.blockingLayers = [
      ...document.querySelectorAll(
        'dialog[open], .Modal.open, #MediaViewer, #shiye-commands, .Menu .bubble.open',
      ),
    ].map((node) => ({ tag: node.tagName, id: node.id, className: node.className }));
    result.errors.push(error.stack || error.message);
  }
  window.chrome.webview.postMessage(result);
})();
