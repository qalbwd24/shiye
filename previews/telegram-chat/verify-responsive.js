/* Isolated real native widths and media messages, without touching ordinary drafts. */
window.shiyeVerifyEmoji = async ({ input, replace, key, wait, until, expect, result }) => {
  const messageRoots = () => [...document.querySelectorAll('#MiddleColumn .MessageList .Message')];
  const originalId = (message) => String(message.previousLocalId || message.id);
  const messageForRoot = (byId, root) =>
    byId[root.dataset.messageId] ||
    Object.values(byId).find(
      (message) => String(message.previousLocalId) === root.dataset.messageId,
    );
  function readIdentityModel(roots, chatId) {
    const global = window.getGlobal?.();
    if (!global?.messages?.byChatId) throw Error('DOM身份回归需要真实mock消息模型');
    const lists = Object.values(global.byTabId || {})
      .map((tab) => tab.messageLists?.at(-1))
      .filter((list) => list && (!chatId || list.chatId === chatId));
    const candidates = lists.filter((list) => {
      const byId = global.messages.byChatId[list.chatId]?.byId;
      return byId && roots.every((root) => messageForRoot(byId, root));
    });
    const list = candidates[0];
    if (!list || candidates.some((item) => item.chatId !== list.chatId))
      throw Error('无法唯一定位当前可见消息对应的模型');
    const chat = global.messages.byChatId[list.chatId];
    return {
      chatId: list.chatId,
      byId: chat.byId,
      viewportIds: chat.threadsById?.[list.threadId]?.localState?.lastViewportIds,
    };
  }
  let sameGroupAppends = 0;
  result.identityDiagnostics = [];
  function compareIdentity(snapshot, target, stage) {
    const roots = messageRoots();
    const model = readIdentityModel(roots, snapshot.chatId);
    const currentByOriginalId = new Map(
      roots.map((root) => [originalId(messageForRoot(model.byId, root)), root]),
    );
    const modelByOriginalId = new Map(
      Object.values(model.byId).map((message) => [originalId(message), message]),
    );
    const preserved = [],
      failures = [],
      failureDetails = [],
      pruned = [],
      confirmed = [];
    for (const old of snapshot.roots) {
      const message = modelByOriginalId.get(old.originalId);
      const current = currentByOriginalId.get(old.originalId);
      // A missing node is exempt only when the real viewport model explicitly removed it.
      // Retaining byId alone is insufficient: history virtualization keeps cached messages.
      const outsideViewport =
        message &&
        Array.isArray(snapshot.viewportIds) &&
        snapshot.viewportIds.some((id) => String(id) === old.id) &&
        Array.isArray(model.viewportIds) &&
        !model.viewportIds.some((id) => String(id) === String(message.id));
      if (!current && !old.root.isConnected && outsideViewport) {
        pruned.push({ originalId: old.originalId, reason: 'model-viewport-prune' });
      } else if (
        !message ||
        current !== old.root ||
        !old.root.isConnected ||
        current.closest('.sender-group-container') !== old.group
      ) {
        failures.push(old.originalId);
        failureDetails.push({
          originalId: old.originalId,
          oldDOMid: old.domId,
          oldMessageId: old.id,
          canonicalId: message ? String(message.id) : null,
          rootConnected: old.root.isConnected,
          currentExists: Boolean(current),
          sameRoot: current === old.root,
          sameGroup: Boolean(current && current.closest('.sender-group-container') === old.group),
        });
      } else {
        preserved.push(old.originalId);
        if (String(message.id) !== old.id)
          confirmed.push({ originalId: old.originalId, beforeId: old.id, id: String(message.id) });
      }
    }
    const targetGroup = target.closest('.sender-group-container');
    const sameGroup = Boolean(snapshot.tail.group && targetGroup === snapshot.tail.group);
    const tailClasses = sameGroup && {
      oldLastInGroup: snapshot.tail.root.classList.contains('last-in-group'),
      oldLastInList: snapshot.tail.root.classList.contains('last-in-list'),
      newLastInGroup: target.classList.contains('last-in-group'),
      newLastInList: target.classList.contains('last-in-list'),
    };
    // Store diagnostics before an assertion throws; keep message content out of this record.
    result.identityDiagnostics.push({
      attempt: result.emojiSend.length,
      stage: stage.split(':')[0],
      oldRootCount: snapshot.roots.length,
      preserved: [...preserved],
      failures: [...failures],
      failureDetails,
      snapshotViewportIds: snapshot.viewportIds?.slice() ?? null,
      currentViewportIds: model.viewportIds?.slice() ?? null,
    });
    expect(preserved.length > 0, '真实旧根身份非空采样：' + stage);
    expect(!failures.length, '旧根及发送组DOM身份保持：' + stage);
    if (sameGroup) {
      expect(
        !tailClasses.oldLastInGroup &&
          !tailClasses.oldLastInList &&
          tailClasses.newLastInGroup &&
          tailClasses.newLastInList,
        '同组追加更新旧尾与新尾样式：' + stage,
      );
      expect(
        targetGroup.querySelectorAll('.Avatar').length === snapshot.tail.avatarCount,
        '本机own组追加不误增头像：' + stage,
      );
    }
    return {
      stage,
      oldRootCount: snapshot.roots.length,
      preserved,
      failures,
      pruned,
      confirmed,
      sameGroup,
      tailClasses,
      groupId: targetGroup?.id,
    };
  }
  async function captureNative(stage) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('原生发送绘制截图超时：' + stage)), 6000);
      const receive = ({ data }) => {
        if (data.kind !== 'composer-capture-ready' || data.stage !== stage) return;
        clearTimeout(timer);
        window.chrome.webview.removeEventListener('message', receive);
        resolve();
      };
      window.chrome.webview.addEventListener('message', receive);
      window.chrome.webview.postMessage({ kind: 'verify-composer-capture', stage });
    });
  }
  result.emojiSend = [];
  for (const text of [
    '😊',
    '😂',
    '👨‍👩‍👧‍👦',
    '😂',
    '😊',
    '非线性消息过渡',
    '长草稿收回逐帧检查\n'.repeat(14),
  ]) {
    await replace(text);
    const probe = text.trim().split('\n')[0];
    const known = new Set(
      [...document.querySelectorAll('.Message')].map((el) => el.dataset.messageId),
    );
    let target;
    const frames = [];
    const ticks = [];
    const oldIds = [...document.querySelectorAll('.Message')]
      .slice(-5)
      .map((message) => message.dataset.messageId);
    const identityRoots = messageRoots();
    expect(identityRoots.length > 0, '发送前真实旧根非空：' + probe);
    const identityModel = readIdentityModel(identityRoots);
    const roots = identityRoots.map((root) => ({
      root,
      id: root.dataset.messageId,
      domId: root.id,
      originalId: originalId(messageForRoot(identityModel.byId, root)),
      group: root.closest('.sender-group-container'),
    }));
    const tail = roots.at(-1);
    const identitySnapshot = {
      chatId: identityModel.chatId,
      viewportIds: identityModel.viewportIds?.slice(),
      roots,
      tail: { ...tail, avatarCount: tail.group?.querySelectorAll('.Avatar').length },
    };
    const identitySamples = [];
    const knownOriginalIds = new Set(roots.map((message) => message.originalId));
    let identityError;
    const started = performance.now();
    let stop = false;
    function sample(now) {
      if (stop) return;
      ticks.push(now - started);
      if (!target?.isConnected) {
        const byId = window.getGlobal().messages.byChatId[identitySnapshot.chatId].byId;
        target = messageRoots().find((el) => {
          if (known.has(el.dataset.messageId) || !el.textContent.includes(probe)) return false;
          const message = messageForRoot(byId, el);
          return message && !knownOriginalIds.has(originalId(message));
        });
      }
      if (target && !identitySamples.length) {
        try {
          identitySamples.push(compareIdentity(identitySnapshot, target, 'first-dom:' + probe));
        } catch (error) {
          identityError = error;
          stop = true;
          return;
        }
      }
      {
        const box = target?.getBoundingClientRect();
        const content = target?.querySelector(
          ':scope > .message-content-wrapper > .message-content',
        );
        frames.push({
          t: now - started,
          y: box?.y,
          h: box?.height,
          bottom: box?.bottom,
          footerTop: document.querySelector('.middle-column-footer')?.getBoundingClientRect().top,
          visualY: content?.getBoundingClientRect().y,
          opacity: content
            ? Number(getComputedStyle(content).opacity) * Number(getComputedStyle(target).opacity)
            : 0,
          oldY: oldIds.map((id) => {
            const node = [...document.querySelectorAll('.Message')]
              .find((e) => e.dataset.messageId === id)
              ?.querySelector(':scope > .message-content-wrapper > .message-content');
            return node ? node.getBoundingClientRect().y : null;
          }),
          scrollTop: document.querySelector('#MiddleColumn .MessageList').scrollTop,
        });
      }
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
    let paintCapture;
    if (text === '非线性消息过渡') {
      result.nativePaints = [];
      await captureNative('compact');
      result.nativePaints.push({
        stage: 'before',
        t: performance.now() - started,
        file: 'composer-compact.png',
      });
    }
    let inputAt;
    const recordInput = (event) => {
      if (event.key === 'Enter' && event.target.closest?.('#editable-message-text'))
        inputAt = performance.now() - started;
    };
    document.addEventListener('keydown', recordInput, true);
    await key('Enter', 'Enter', 13);
    document.removeEventListener('keydown', recordInput, true);
    if (text === '非线性消息过渡')
      paintCapture = (async () => {
        for (const stage of ['capped', 'manual', 'narrow', 'thumbnails', 'room-settings']) {
          const at = performance.now() - started;
          await captureNative(stage);
          result.nativePaints.push({
            stage,
            t: at,
            completedAt: performance.now() - started,
            file: 'composer-' + stage + '.png',
          });
          await wait(16);
        }
      })();
    await until(() => target || identityError, '纯表情实际消息出现');
    if (identityError) throw identityError;
    await wait(1800);
    await paintCapture;
    stop = true;
    identitySamples.push(compareIdentity(identitySnapshot, target, 'settled:' + probe));
    if (identitySamples.every((sample) => sample.sameGroup)) sameGroupAppends++;
    const visible = frames.filter((frame) => frame.y !== undefined);
    const settled = visible.filter((frame) => frame.t > visible[0].t + 400);
    const sizes = settled.map((frame) => frame.h);
    const heightRange = Math.max(...sizes) - Math.min(...sizes);
    const positions = settled.map((frame) => frame.y);
    const latePositionRange = Math.max(...positions) - Math.min(...positions);
    const gaps = frames
      .slice(1)
      .map((frame, index) => frame.t - frames[index].t)
      .sort((a, b) => a - b);
    const sampleResult = {
      text,
      firstFrameMs: visible[0].t,
      heightRange,
      latePositionRange,
      medianFrameMs: gaps[Math.floor(gaps.length / 2)],
      maxFrameMs: Math.max(...gaps),
      scrollSnapType: getComputedStyle(document.querySelector('#MiddleColumn .MessageList'))
        .scrollSnapType,
      frames,
      ticks,
      groupIdentity: identitySamples,
    };
    const afterInput = frames.filter((frame) => frame.t >= inputAt);
    const firstVisible = (opacity) =>
      afterInput.find(
        (frame) =>
          frame.opacity >= opacity &&
          frame.h >= 12 &&
          Math.min(frame.bottom, frame.footerTop) - Math.max(frame.y, 0) >= 12,
      );
    sampleResult.inputLatency = {
      inputAt,
      firstDomMs: afterInput.find((frame) => frame.y !== undefined)?.t - inputAt,
      visible10Ms: firstVisible(0.1)?.t - inputAt,
      visible90Ms: firstVisible(0.9)?.t - inputAt,
      includesNativeCapture: text === '非线性消息过渡',
    };
    expect(
      Number.isFinite(sampleResult.inputLatency.firstDomMs),
      '原生发送事件至DOM有效采样：' + probe,
    );
    expect(
      Number.isFinite(sampleResult.inputLatency.visible90Ms),
      '原生有效透明度与页脚可见范围采样：' + probe,
    );
    const early = frames.filter((frame) => frame.t < visible[0].t + 600);
    const reversals = [];
    for (let i = 1; i < early.length; i++)
      for (let j = 0; j < oldIds.length; j++) {
        const previous = early[i - 1].oldY[j],
          current = early[i].oldY[j];
        if (previous !== null && current !== null && current - previous > 0.75)
          reversals.push({ t: early[i].t, message: j, delta: current - previous });
      }
    sampleResult.earlyOldMessageReversals = reversals;
    sampleResult.oldIds = oldIds;
    expect(
      frames.some((f) => f.y === undefined && f.oldY.some((y) => y !== null)),
      '发送前已有消息基准确实被采样：' + probe,
    );
    expect(
      visible.some((f) => f.oldY.some((y) => y !== null)),
      '旧消息节点重建后仍按编号追踪，禁止空样本通过：' + probe,
    );
    const opacityRegressions = frames
      .slice(1)
      .filter((frame, index) => frame.opacity + 0.03 < frames[index].opacity);
    sampleResult.opacityRegressions = opacityRegressions.length;
    result.emojiSend.push(sampleResult);
    expect(Boolean(target) && !input().textContent, '纯表情发送成功且清空输入：' + text);
    expect(heightRange < 2, '纯表情发送后高度稳定：' + text);
    expect(latePositionRange < 3, '纯表情发送后不再二次来回位移：' + text);
    expect(!reversals.length, '发送前600ms已有消息不反向抖动：' + text);
    expect(!opacityRegressions.length, '新气泡淡入不回退闪烁：' + text);
  }
  expect(sameGroupAppends >= 2, '至少两次真实同组尾追加覆盖稳定组身份与尾条样式');
  const mixed = '中文😂行内表情' + Date.now();
  await replace(mixed);
  await key('Enter', 'Enter', 13);
  await until(
    () =>
      [...document.querySelectorAll('.Message')].some((node) => node.textContent.includes(mixed)),
    '混排表情发送',
  );
  const message = [...document.querySelectorAll('.Message')].find((node) =>
    node.textContent.includes(mixed),
  );
  expect(!message.querySelector('.shiye-emoji-message'), '文字混排的表情继续行内显示');
};
window.shiyeVerifyResponsive = async ({
  input,
  replace,
  wait,
  until,
  expect,
  result,
  trustedClick,
  key,
  native,
}) => {
  let nativeState;
  const readNativeState = ({ data }) => {
    if (data.kind === 'window-state') nativeState = data;
  };
  window.chrome.webview.addEventListener('message', readNativeState);
  result.workspaceHeaders = [];
  async function resize(width) {
    window.chrome.webview.postMessage({ kind: 'verify-viewport', width, height: 700 });
    await wait(350);
    nativeState = undefined;
    window.chrome.webview.postMessage({ kind: 'get-window-state' });
    await until(() => nativeState?.workspaces, '原生窄窗工作区入口布局');
    const header = nativeState.workspaces;
    expect(
      header.noOverlap &&
        header.buttons.every(
          (button) => button.x >= 0 && button.x + button.width <= nativeState.width,
        ),
      width + 'DIP原生写作入口不重叠或越界',
    );
    expect(width >= 440 || header.compact, width + 'DIP窄窗入口使用固定尺寸图标');
    result.workspaceHeaders.push({ width, header });
  }
  async function capture(stage) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('窄窗截图超时')), 4000);
      const receive = ({ data }) => {
        if (data.kind !== 'composer-capture-ready' || data.stage !== stage) return;
        clearTimeout(timer);
        window.chrome.webview.removeEventListener('message', receive);
        resolve();
      };
      window.chrome.webview.addEventListener('message', receive);
      window.chrome.webview.postMessage({ kind: 'verify-composer-capture', stage });
    });
  }
  const oldFont = document.body.style.getPropertyValue('--shiye-input-size');
  const startWidth = innerWidth,
    startHeight = innerHeight;
  if (document.body.dataset.shiyeSidebar === 'expanded')
    await trustedClick(document.querySelector('.shiye-sidebar-fallback'));
  await replace('');
  let editor;
  window.dispatchEvent(
    new CustomEvent('shiye-editor-request', {
      detail: {
        receive: (value) => {
          editor = value;
        },
      },
    }),
  );
  async function file(width, height, label) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#284d55';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#e6f1ef';
    context.font = '32px sans-serif';
    context.fillText(label, 16, 45);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return new File([blob], label + '.png', { type: 'image/png' });
  }
  async function send(files) {
    editor.files(files);
    await until(
      () => document.querySelector('.Modal.open [aria-label="确认发送"]'),
      '缩略图样本预览',
    );
    await wait(600);
    await until(
      () => !document.querySelector('.Modal.open [aria-label="确认发送"]').disabled,
      '图片样本就绪后允许发送',
    );
    await trustedClick(document.querySelector('.Modal.open [aria-label="确认发送"]'));
    await until(() => !document.querySelector('.Modal.open'), '缩略图样本发送');
    await wait(1000);
  }
  await replace('剪切板贴图前已有文字');
  await window.shiyeVerifyClipboardFocus({
    openImage: async () => editor.files([await file(480, 320, '剪切板焦点样本')]),
    input,
    native,
    trustedClick,
    wait,
    until,
    expect,
  });
  result.clipboardFocus = true;
  await replace('');
  result.thumbnails = [];
  for (const [width, height, label] of [
    [960, 640, '横向缩略图'],
    [400, 1200, '竖向缩略图'],
    [640, 640, '方形缩略图'],
  ]) {
    await send([await file(width, height, label)]);
    const image = [...document.querySelectorAll('.Message .media-inner img')]
      .filter((el) => el.naturalWidth === width && el.naturalHeight === height)
      .at(-1);
    expect(Boolean(image), label + '加载原始像素');
    const frame = image.closest('.media-inner');
    const box = frame.getBoundingClientRect();
    expect(box.width <= 241 && box.height <= 221, label + '限制240×220');
    expect(Math.abs(box.width / box.height - width / height) < 0.02, label + '保持原始比例');
    result.thumbnails.push({ label, width: box.width, height: box.height });
  }
  await send([await file(600, 400, '图组一'), await file(400, 600, '图组二')]);
  const album = [...document.querySelectorAll('.Message .Album')].at(-1);
  expect(Boolean(album), '多图仍正常组合');
  const albumBox = album.getBoundingClientRect();
  expect(albumBox.width <= 281 && albumBox.height <= 261, '多图整体限制280×260且不逐格破坏布局');
  await capture('thumbnails');
  result.narrowWindows = [];
  for (const width of [520, 400, 360, 200]) {
    await resize(width);
    expect(
      innerWidth <= Math.max(360, width) && innerWidth >= Math.max(360, width) - 24,
      width + 'DIP请求实际原生窄宽度',
    );
    const actualWidth = innerWidth;
    result.narrowWindows.push({ requestedDip: width, clientWidth: actualWidth });
    for (const font of [16, 19.84, 32]) {
      document.body.style.setProperty('--shiye-input-size', font + 'px');
      await replace('窄窗口文字编辑');
      expect(
        Math.abs(parseFloat(getComputedStyle(input()).fontSize) - font) < 0.1,
        font + 'px输入矩阵实际字号生效',
      );
      const fontPlaceholder = input().parentElement.querySelector('.placeholder-text');
      expect(
        Math.abs(parseFloat(getComputedStyle(fontPlaceholder).fontSize) - font) < 0.1,
        font + 'px输入矩阵空提示字号一致',
      );
      expect(
        getComputedStyle(fontPlaceholder).lineHeight === getComputedStyle(input()).lineHeight,
        font + 'px输入矩阵空提示行高一致',
      );
      const pill = input().closest('.Composer').getBoundingClientRect();
      const text = input().getBoundingClientRect();
      const symbol = document.querySelector('.Composer.is-chat-composer .shiye-symbol-button');
      const action = document.querySelector('.Composer.is-chat-composer > .main-button');
      const sb = symbol.getBoundingClientRect(),
        ab = action.getBoundingClientRect();
      const label = width + 'DIP／' + font + 'px：';
      expect(
        pill.left >= 0 && pill.right <= innerWidth + 1 && text.width > 80,
        label + '输入框在视口内且保留文字宽度',
      );
      expect(
        sb.right <= ab.left + 1 && ab.right <= innerWidth && sb.width <= 40 && ab.width <= 48,
        label + '表情与发送不重叠、不膨胀',
      );
      expect(document.documentElement.scrollWidth <= innerWidth + 1, label + '无页面水平溢出');
      const media = document.querySelector(
        '.Message .media-inner[style*="--media-width"]:not(.Album .media-inner)',
      );
      const mb = media.getBoundingClientRect();
      expect(mb.width <= 241 && mb.height <= 221, label + '缩略图不跟随文字放大');
    }
    await replace('');
    const voice = document.querySelector('.Composer.is-chat-composer > .main-button.record');
    expect(!voice || !voice.getClientRects().length, width + 'DIP空输入无语音按钮或焦点占位');
    if (width === 360) {
      await capture('narrow');
      await replace('窄窗添加图片前的文字');
      editor.files([await file(640, 640, '窄窗确认图片')]);
      await until(
        () => document.querySelector('.Modal.open [aria-label="确认发送"]'),
        '最窄窗口图片确认',
      );
      const confirm = document.querySelector('.Modal.open [aria-label="确认发送"]');
      const dialog = confirm
        .closest('.Modal')
        .querySelector('.modal-dialog')
        .getBoundingClientRect();
      const cancel = document.querySelector('.shiye-media-cancel').getBoundingClientRect();
      const sendBox = confirm.getBoundingClientRect();
      expect(
        dialog.left >= 0 && dialog.right <= innerWidth + 1 && cancel.right <= sendBox.left + 1,
        '360DIP大字号图片确认与取消均在视口内且不重叠',
      );
      await key('Escape', 'Escape', 27);
      await until(() => !document.querySelector('.Modal.open'), '关闭最窄图片确认');
      const cancelStarted = performance.now();
      result.narrowDraftImmediately = input().textContent;
      await until(
        () => input()?.textContent.includes('窄窗添加图片前的文字'),
        '取消图片后恢复原草稿',
      );
      result.narrowDraftRestoreMs = performance.now() - cancelStarted;
      expect(input().textContent.includes('窄窗添加图片前的文字'), '最窄窗口取消图片保留原草稿');
      await replace('');
      await trustedClick(document.querySelector('.shiye-sidebar-fallback'));
      const sidebar = document.querySelector('#LeftColumn').getBoundingClientRect();
      expect(sidebar.left >= -1 && sidebar.right <= innerWidth + 1, '360DIP展开侧栏仍在屏幕内');
      await trustedClick(document.querySelector('.shiye-sidebar-fallback'));
      await key('Escape', 'Escape', 27);
      expect(
        Boolean(document.querySelector('.shiye-room-switcher[open]')),
        '最窄窗口Esc切换仍可打开',
      );
      await key('Enter', 'Enter', 13);
      await wait(500);
    }
  }
  document.body.style.setProperty('--shiye-input-size', oldFont);
  window.chrome.webview.postMessage({
    kind: 'verify-viewport',
    width: startWidth + 16,
    height: startHeight + 80,
  });
  await wait(350);
  await replace('');
  window.chrome.webview.removeEventListener('message', readNativeState);
};
