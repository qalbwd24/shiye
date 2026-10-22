/* Isolated synthetic-library acceptance; no formal diary access. */
(async () => {
  const result = { kind: 'verify-result', checks: [], errors: [] };
  window.addEventListener(
    'error',
    (event) => {
      result.runtimeErrors ||= [];
      result.runtimeErrors.push(event.error?.stack || event.message);
    },
    true,
  );
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const expect = (condition, name) => {
    if (!condition) throw Error(name);
    result.checks.push(name);
  };
  const click = (element) => {
    element.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }),
    );
    element.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }),
    );
    element.click();
  };
  async function until(read, name) {
    for (let i = 0; i < 60; i++) {
      if (read()) return;
      await wait(200);
    }
    throw Error(name);
  }
  const { trustedClick, verifyLocalInput } = await window.shiyeVerifyInput({
    expect,
    until,
    wait,
    result,
  });
  try {
    await until(() => document.querySelectorAll('.ListItem.Chat').length >= 3, '会话加载');
    expect(document.documentElement.lang.startsWith('zh'), '中文界面语言');
    if (document.body.dataset.shiyeSidebar === 'collapsed') {
      expect(
        JSON.parse(localStorage.getItem('shiye-preview-appearance-v1')).sidebarCollapsed,
        '话题栏关闭重开保留折叠状态',
      );
      const toggle = [
        ...document.querySelectorAll('.shiye-toggle-topics, .shiye-sidebar-fallback'),
      ].find((button) => button.getBoundingClientRect().width > 0);
      await trustedClick(toggle);
      expect(
        getComputedStyle(document.querySelector('#LeftColumn')).display !== 'none',
        '重开后仍可展开话题栏',
      );
    }

    const chat = [...document.querySelectorAll('.ListItem.Chat')].find((el) =>
      el.innerText.includes('随手记'),
    );
    click(chat.querySelector('.ListItem-button'));
    await until(() => document.querySelector('#editable-message-text'), '编辑器加载');
    await wait(1200);
    const input = document.querySelector('#editable-message-text');
    const marker = '中文验收：你好，拾页！English 123，标点与换行。';
    input.focus();
    await wait(250);
    document.execCommand('selectAll');
    document.execCommand('insertText', false, marker);
    expect(input.innerText.includes(marker), '中文输入写入编辑器');
    await wait(400);
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        isComposing: true,
      }),
    );
    await wait(250);
    expect(input.innerText.includes(marker), '中文组词 Enter 保留输入');
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true }),
    );
    await wait(250);
    expect(input.innerText.includes(marker), 'IME 229 不误发');
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await until(() => !input.innerText.includes(marker), '正常 Enter 发送');
    await until(
      () =>
        [...document.querySelectorAll('.Message .text-content')].some((el) =>
          el.innerText.includes(marker),
        ),
      '消息回显',
    );
    result.checks.push('中文消息发送与回显');
    const library = await new Promise((resolve, reject) => {
      const request = indexedDB.open('shiye-telegram-preview-v1');
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction('preview').objectStore('preview').get('library');
        read.onsuccess = () => {
          resolve(read.result);
          db.close();
        };
        read.onerror = () => {
          reject(read.error);
          db.close();
        };
      };
      request.onerror = () => reject(request.error);
    });
    expect(
      Object.values(library.messages)
        .flat()
        .some((message) => message.message === marker),
      '发送后已写入隔离 IndexedDB',
    );
    expect(
      !library.dialogs.active.find((dialog) => dialog.id === '-10')?.draft?.message,
      '发送后清除已发送草稿',
    );
    let blocked = false;
    try {
      await fetch('https://telegram.org/');
    } catch {
      blocked = true;
    }
    expect(blocked, '远程 fetch 被本地边界阻止');
    blocked = false;
    try {
      new WebSocket('wss://telegram.org/');
    } catch {
      blocked = true;
    }
    expect(blocked, 'WebSocket 连接被禁止');
    result.font = {
      family: getComputedStyle(input).fontFamily,
      size: getComputedStyle(input).fontSize,
      dpr: devicePixelRatio,
      viewport: [innerWidth, innerHeight],
    };
    result.inputs = [...document.querySelectorAll('input')].map((el) => ({
      type: el.type,
      accept: el.accept,
      id: el.id,
    }));
    result.time = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(new Date());
    const state = () =>
      new Promise((resolve) => {
        const handler = (event) => {
          if (event.data.kind !== 'window-state') return;
          chrome.webview.removeEventListener('message', handler);
          resolve(event.data);
        };
        chrome.webview.addEventListener('message', handler);
        chrome.webview.postMessage({ kind: 'get-window-state' });
      });
    let before = await state();
    const expected = JSON.parse(localStorage.getItem('shiye-verify-reopen') || 'null');
    if (expected) {
      expect(Math.abs(before.zoom - expected.zoom) < 0.001, '关闭重开后缩放比例保留');
      expect(
        ['x', 'y', 'width', 'height'].every((key) => before[key] === expected[key]),
        '关闭重开后窗口位置尺寸保留',
      );
      localStorage.removeItem('shiye-verify-reopen');
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true, cancelable: true }),
      );
      await wait(200);
      before = await state();
    }
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: '+', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await wait(200);
    const after = await state();
    expect(Math.abs(after.zoom - before.zoom - 0.04) < 0.001, 'Ctrl 加号每步 4%');
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await wait(200);
    expect(Math.abs((await state()).zoom - before.zoom) < 0.001, 'Ctrl 减号恢复原比例');
    input.focus();
    result.editorApi = !!input.editor;
    const formatMarker = '中文加粗验收' + Date.now();
    document.execCommand(
      'insertText',
      false,
      `**${formatMarker}** __一致加粗__ *斜体验收* _另一斜体_ 和 \`localCode\``,
    );
    await wait(400);
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await until(
      () =>
        [
          ...document.querySelectorAll('.Message .text-content b, .Message .text-content strong'),
        ].some((el) => el.textContent.includes(formatMarker)),
      'Markdown 加粗渲染',
    );
    expect(
      [...document.querySelectorAll('.Message code')].some((el) =>
        el.textContent.includes('localCode'),
      ),
      'Markdown 行内代码渲染',
    );
    result.checks.push('Markdown 手输发送后显示格式');
    expect(
      [...document.querySelectorAll('.Message b, .Message strong')].some((el) =>
        el.textContent.includes('一致加粗'),
      ),
      '双下划线与拾页统一为加粗',
    );
    expect(
      [...document.querySelectorAll('.Message i, .Message em')].some((el) =>
        el.textContent.includes('斜体验收'),
      ) &&
        [...document.querySelectorAll('.Message i, .Message em')].some((el) =>
          el.textContent.includes('另一斜体'),
        ),
      '星号与单下划线斜体',
    );
    const canvas = document.createElement('canvas');
    canvas.width = 2800;
    canvas.height = 1800;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#294d4a';
    ctx.fillRect(0, 0, 2800, 1800);
    ctx.fillStyle = '#ecf4f0';
    ctx.font = '22px Microsoft YaHei UI';
    ctx.fillText('拾页 · 本地图片验收', 30, 95);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], '本地图片验收.png', { type: 'image/png' }));
    input.focus();
    input.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
    await until(() => document.querySelector('#editable-message-text-modal'), '图片粘贴预览');
    await wait(800);
    await until(() => {
      const button = document.querySelector('[aria-label="确认发送"]');
      return button && !button.disabled;
    }, '等待图片准备');
    const send =
      document.querySelector('[aria-label="确认发送"]') ||
      document.querySelector('[class*=AttachmentModal-module__send-wrapper] button');
    expect(send && !send.disabled, '图片确认按钮就绪');
    await until(() => document.activeElement === send, '图片默认聚焦确认');
    send.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
    );
    expect(document.activeElement.classList.contains('shiye-media-cancel'), '图片左方向键选择取消');
    document.activeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    expect(document.activeElement === send, '图片右方向键选择确认');
    send.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await until(() => !document.querySelector('#editable-message-text-modal'), '图片确认关闭');
    await wait(1400);
    expect(
      !!document.querySelector(
        '.Message .Photo, .Message .media-inner img, .Message .message-content img',
      ),
      '图片消息呈现',
    );
    const savedMedia = await new Promise((resolve, reject) => {
      const request = indexedDB.open('shiye-telegram-preview-v1');
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction('preview').objectStore('preview').get('library');
        read.onsuccess = () => {
          resolve(read.result.documents.at(-1));
          db.close();
        };
        read.onerror = () => reject(read.error);
      };
      request.onerror = () => reject(request.error);
    });
    const originalBytes = new Uint8Array(await blob.arrayBuffer());
    expect(
      savedMedia.photoWidth === 2800 && savedMedia.photoHeight === 1800,
      '原图保存完整尺寸，超过 Telegram 默认长边',
    );
    expect(
      savedMedia.bytes.length === originalBytes.length &&
        savedMedia.bytes.every((byte, i) => byte === originalBytes[i]),
      '原图保存字节完全一致',
    );
    const photo = [...document.querySelectorAll('.Message .media-inner')].at(-1);
    expect(!!photo, '图片可点击入口');
    click(photo);
    await until(
      () => document.querySelector('#MediaViewer button[aria-label="放大图片"]'),
      '打开图片查看器并等待工具栏就绪',
    );
    const nativeBeforeImage = await state();
    const zoomIn = document.querySelector('#MediaViewer button[aria-label="放大图片"]');
    expect(!!zoomIn, '图片查看器中文放大按钮');
    click(zoomIn);
    await wait(700);
    const viewer = document.querySelector('#MediaViewer');
    viewer.dispatchEvent(
      new KeyboardEvent('keydown', { key: '+', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await wait(700);
    expect(
      Math.abs((await state()).zoom - nativeBeforeImage.zoom) < 0.001,
      '图片按钮及 Ctrl 加号不改变窗口缩放',
    );
    const transforms = [...viewer.querySelectorAll('[style]')]
      .map((el) => el.style.transform)
      .filter(Boolean);
    result.imageTransforms = transforms;
    expect(
      transforms.some((value) => /scale\([2-9]|scale\(1\.[1-9]/.test(value)),
      '图片自身已放大',
    );
    click(viewer.querySelector('button[aria-label="关闭"]'));
    await until(() => !document.querySelector('#MediaViewer'), '关闭图片查看器');
    await trustedClick(document.querySelector('#LeftMainHeader button[aria-label="新建话题"]'));
    await until(() => document.querySelector('.shiye-dialog form'), '新建会话设置');
    const form = document.querySelector('.shiye-dialog form');
    const roomTitle = '验收话题' + Date.now();
    form.elements.title.value = roomTitle;
    form.elements.kind.value = 'group';
    form.elements.category.value = '隔离分类';
    form.elements.description.value = '机器人入口预留，未启用';
    form.elements.servicePlan.value = '计划接入往日回顾';
    form.elements.idleHours.value = '2.5';
    form.requestSubmit();
    await until(() => !document.querySelector('.shiye-dialog'), '创建会话保存');
    await until(
      () =>
        [...document.querySelectorAll('.ListItem.Chat')].some((el) =>
          el.innerText.includes(roomTitle),
        ),
      '新会话进入左栏',
    );
    await until(
      () =>
        document.querySelector('#editable-message-text')?.getAttribute('aria-label') ===
          roomTitle ||
        document.querySelector('.message-input-placeholder')?.textContent === roomTitle,
      '新建话题已打开',
    );
    await trustedClick(document.querySelector('#LeftMainHeader button[aria-label="设置"]'));
    document.querySelector('[data-edit-room]').click();
    await until(() => document.querySelector('.shiye-dialog form'), '会话信息重开');
    const savedForm = document.querySelector('.shiye-dialog form');
    expect(
      savedForm.elements.title.value === roomTitle &&
        savedForm.elements.kind.value === 'group' &&
        savedForm.elements.idleHours.value === '2.5' &&
        savedForm.elements.category.value === '隔离分类' &&
        savedForm.elements.servicePlan.value === '计划接入往日回顾',
      '会话名称、形式、分类、归篇间隔已保存',
    );
    document.querySelector('.shiye-dialog header button[aria-label="关闭"]').click();
    await until(() => !document.querySelector('.shiye-dialog'), '话题设置关闭完成');
    await wait(150);
    await trustedClick(document.querySelector('#LeftMainHeader button[aria-label="搜索聊天记录"]'));
    await until(() => document.querySelector('.shiye-search-dialog[open]'), '文字搜索弹窗入口');
    const searchForm = document.querySelector('.shiye-search-form');
    searchForm.elements.query.value = '中文验收：你好';
    searchForm.requestSubmit();
    await until(
      () => document.querySelectorAll('.shiye-search-result').length > 0,
      '全文消息搜索结果',
    );
    expect(
      [...document.querySelectorAll('.shiye-search-result p')].every((el) =>
        el.textContent.includes('中文验收：你好'),
      ),
      '搜索返回匹配文字片段',
    );
    searchForm.elements.scope.value = 'current';
    searchForm.elements.scope.dispatchEvent(new Event('change'));
    await until(
      () =>
        document
          .querySelector('.shiye-search-dialog [role=status]')
          .textContent.includes('没有找到'),
      '当前空会话无结果',
    );
    searchForm.elements.scope.value = 'all';
    searchForm.elements.scope.dispatchEvent(new Event('change'));
    await until(
      () => document.querySelectorAll('.shiye-search-result').length > 0,
      '全部会话搜索恢复',
    );
    document.querySelector('.shiye-search-result').click();
    await until(() => !document.querySelector('.shiye-search-dialog'), '搜索结果关闭弹窗');
    await until(() => window.shiyeRoomUi.currentId() === '-10', '搜索结果跳到所属会话');
    result.checks.push('全部／当前会话搜索与点击跳转');
    expect(
      !document.querySelector('.MiddleHeader .header-tools button:not(.shiye-pin)'),
      '组件层移除重复搜索和 Telegram 菜单',
    );
    expect(
      !document.querySelector('.shiye-preview-tools, .shiye-room-tools, #telegram-search-input'),
      '浮动设置和重复工具条已移除',
    );
    await trustedClick(document.querySelector('#LeftMainHeader button[aria-label="设置"]'));
    expect(
      document.querySelector('.shiye-dialog[open]').textContent.includes('消息与图片'),
      '齿轮统一打开中文设置',
    );
    document.querySelector('.shiye-dialog[open] header button[aria-label="关闭"]').click();
    await wait(200);
    await verifyLocalInput();
    await window.shiyeVerifyMappings({ expect, until, wait, result });
    if (window.shiyeVerifyWorkspace)
      await window.shiyeVerifyWorkspace({ expect, until, wait, result });
    expect(!result.runtimeErrors?.length, '全程无编辑器运行异常');
    result.stage = expected ? 'reopen' : 'initial';
    if (!expected) {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: '+', ctrlKey: true, bubbles: true, cancelable: true }),
      );
      await wait(200);
      localStorage.setItem('shiye-verify-reopen', JSON.stringify(await state()));
    }
  } catch (error) {
    result.errors.push(error.stack || String(error));
  }
  chrome.webview.postMessage(result);
})();
